/**
 * Checks a published release through its public URL only (no credentials): what browsers will actually get.
 * Used by `pnpm assets:verify` and at the end of `pnpm assets:upload`. Node's fetch has no HTTP cache, so
 * every request reaches the server.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ReleaseIndex } from '../../asset-meta/manifest-types.ts';
import {
  IMMUTABLE_CACHE_CONTROL, MANIFEST_FILE, RELEASE_INDEX_FILE, assetRoot, resolveAssetUrl,
} from '../../asset-meta/release-layout.ts';
import { DEFAULT_RETRY, runPool, withRetry, type RetryOptions } from './upload-core.ts';
import { parseReleaseIndex } from './release.ts';

/** Bucket CORS policy in the dashboard / S3 PutBucketCors format (deploy/r2/cors.json). */
export const corsPolicySchema = z.array(z.object({
  AllowedOrigins: z.array(z.string()).min(1),
  AllowedMethods: z.array(z.enum(['GET', 'HEAD', 'PUT', 'POST', 'DELETE'])).min(1),
  AllowedHeaders: z.array(z.string()).optional(),
  ExposeHeaders: z.array(z.string()).optional(),
  MaxAgeSeconds: z.number().int().nonnegative().optional(),
})).min(1);

export type CorsPolicy = z.infer<typeof corsPolicySchema>;

export function readCorsPolicy(path: string): CorsPolicy {
  return corsPolicySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function corsOrigins(policy: CorsPolicy): string[] {
  return [...new Set(policy.flatMap((rule) => rule.AllowedOrigins))];
}

/** An origin that no policy should allow, used to check that CORS is not wide open. */
export const UNLISTED_ORIGIN = 'https://unlisted-origin.invalid';

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * fetch with a 15 s timeout that retries network errors, throttling (429) and server errors: the r2.dev URL is
 * rate-limited, so a burst of checks may legitimately be throttled.
 */
export function resilientFetch(fetchFn: HttpFetch, retry: RetryOptions = DEFAULT_RETRY): HttpFetch {
  return (url, init) => withRetry(async () => {
    const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(15_000) });
    if (response.status === 429 || response.status >= 500) {
      await response.arrayBuffer();
      throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), { $metadata: { httpStatusCode: response.status } });
    }
    return response;
  }, retry);
}

export function releaseUrl(base: string, release: string, path: string): string {
  return resolveAssetUrl(assetRoot({ kind: 'remote', base }, '', release), path);
}

export async function fetchPublishedIndex(base: string, release: string, fetchFn: HttpFetch): Promise<ReleaseIndex | null> {
  const response = await fetchFn(releaseUrl(base, release, RELEASE_INDEX_FILE));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${RELEASE_INDEX_FILE} -> HTTP ${response.status}`);
  return parseReleaseIndex(await response.text());
}

/** HEAD of every file of the release: status, size, Content-Type and Cache-Control. */
export async function checkPublicFiles(base: string, index: ReleaseIndex, fetchFn: HttpFetch, concurrency = 8): Promise<string[]> {
  const results = await runPool(index.files, concurrency, async (file) => {
    const url = releaseUrl(base, index.release, file.path);
    const response = await fetchFn(url, { method: 'HEAD' });
    if (response.status !== 200) return [`${url}: HTTP ${response.status}`];
    const problems: string[] = [];
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== file.size) problems.push(`${url}: ${length} B instead of ${file.size}`);
    if (response.headers.get('content-type') !== file.contentType) problems.push(`${url}: Content-Type ${response.headers.get('content-type') ?? 'none'}`);
    if (response.headers.get('cache-control') !== IMMUTABLE_CACHE_CONTROL) problems.push(`${url}: Cache-Control ${response.headers.get('cache-control') ?? 'none'}`);
    return problems;
  });
  return results.flat();
}

function allows(header: string | null, value: string): boolean {
  if (header === null) return false;
  return header.split(',').map((v) => v.trim().toLowerCase()).some((v) => v === '*' || v === value.toLowerCase());
}

/**
 * CORS as Howler's Web Audio XHR sees it: a GET with the page's Origin must get a matching
 * Access-Control-Allow-Origin. Also checks a preflight with Range and that an unlisted origin is refused.
 */
export async function checkCors(base: string, index: ReleaseIndex, origins: readonly string[], fetchFn: HttpFetch): Promise<string[]> {
  const sound = index.files.find((f) => f.contentType.startsWith('audio/') && f.path.endsWith('.wav'))
    ?? index.files.find((f) => f.contentType.startsWith('audio/'));
  const samples = [...(sound === undefined ? [] : [sound.path]), MANIFEST_FILE];
  const problems: string[] = [];
  for (const path of samples) {
    const url = releaseUrl(base, index.release, path);
    for (const origin of origins) {
      const get = await fetchFn(url, { headers: { Origin: origin } });
      await get.arrayBuffer();
      const acao = get.headers.get('access-control-allow-origin');
      if (!get.ok) problems.push(`GET ${url} (Origin ${origin}): HTTP ${get.status}`);
      else if (acao !== origin && acao !== '*') problems.push(`GET ${url} (Origin ${origin}): Access-Control-Allow-Origin ${acao ?? 'absent'}`);

      const preflight = await fetchFn(url, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' },
      });
      await preflight.arrayBuffer();
      const preflightOrigin = preflight.headers.get('access-control-allow-origin');
      if (!preflight.ok) problems.push(`OPTIONS ${url} (Origin ${origin}, Range): HTTP ${preflight.status}`);
      else if (preflightOrigin !== origin && preflightOrigin !== '*') problems.push(`OPTIONS ${url} (Origin ${origin}): Access-Control-Allow-Origin ${preflightOrigin ?? 'absent'}`);
      else if (!allows(preflight.headers.get('access-control-allow-methods'), 'GET')) problems.push(`OPTIONS ${url} (Origin ${origin}): GET not allowed`);
      else if (!allows(preflight.headers.get('access-control-allow-headers'), 'range')) problems.push(`OPTIONS ${url} (Origin ${origin}): Range header not allowed`);
    }
    const denied = await fetchFn(url, { headers: { Origin: UNLISTED_ORIGIN } });
    await denied.arrayBuffer();
    const deniedAcao = denied.headers.get('access-control-allow-origin');
    if (deniedAcao !== null) problems.push(`GET ${url} (Origin ${UNLISTED_ORIGIN}): an unlisted origin is allowed (${deniedAcao})`);
  }
  return problems;
}
