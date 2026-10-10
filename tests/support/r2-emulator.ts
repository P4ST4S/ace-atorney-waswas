/**
 * Local stand-in for the public R2 bucket, for tests without credentials or network.
 *
 * It serves the current generated release exactly where R2 would (`/releases/<release>/<key>`, percent-decoded
 * like R2 does), only for the keys listed in release.json, with the Content-Type and Cache-Control that
 * `pnpm assets:upload` sets, single byte ranges, and the bucket CORS policy of deploy/r2/cors.json: an
 * Access-Control-Allow-Origin only for listed origins, preflights answered or refused with 403.
 * `/__health` answers 200 (readiness probe for Playwright).
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { IMMUTABLE_CACHE_CONTROL, RELEASES_PREFIX, RELEASE_INDEX_FILE } from '../../asset-meta/release-layout.ts';
import type { CorsPolicy } from '../../scripts/lib/public-check.ts';
import { parseReleaseIndex } from '../../scripts/lib/release.ts';

export interface EmulatorOptions {
  /** Directory holding the generated files, manifest.json and release.json (public/generated/). */
  readonly generatedDir: string;
  readonly policy: CorsPolicy;
  /** 0 picks a free port. */
  readonly port?: number;
}

export interface RunningEmulator {
  /** Base URL, with a trailing slash. */
  readonly url: string;
  close(): Promise<void>;
}

type Rule = CorsPolicy[number];

function matchingRule(policy: CorsPolicy, origin: string | undefined, method: string): Rule | undefined {
  if (origin === undefined) return undefined;
  return policy.find((rule) => (rule.AllowedOrigins.includes(origin) || rule.AllowedOrigins.includes('*')) && rule.AllowedMethods.includes(method as Rule['AllowedMethods'][number]));
}

function headersAllowed(rule: Rule, requested: string | undefined): boolean {
  if (requested === undefined || requested.trim() === '') return true;
  const allowed = (rule.AllowedHeaders ?? []).map((h) => h.toLowerCase());
  return requested.split(',').map((h) => h.trim().toLowerCase()).every((h) => allowed.includes('*') || allowed.includes(h));
}

/** Resolves a request path to a release file, or null (404). Segments are percent-decoded, as R2 does. */
function resolveKey(generatedDir: string, pathname: string): { readonly file: string; readonly contentType: string } | null {
  let key: string;
  try {
    key = pathname.slice(1).split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  if (!key.startsWith(RELEASES_PREFIX)) return null;
  const [release, ...rest] = key.slice(RELEASES_PREFIX.length).split('/');
  const path = rest.join('/');
  // Read on every request: the release changes when `pnpm assets:build` runs.
  const index = parseReleaseIndex(readFileSync(join(generatedDir, RELEASE_INDEX_FILE), 'utf8'));
  if (release !== index.release) return null;
  if (path === RELEASE_INDEX_FILE) return { file: join(generatedDir, RELEASE_INDEX_FILE), contentType: 'application/json' };
  const entry = index.files.find((f) => f.path === path);
  return entry === undefined ? null : { file: join(generatedDir, ...entry.path.split('/')), contentType: entry.contentType };
}

function handle(options: EmulatorOptions, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://emulator');
  const method = req.method ?? 'GET';
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');

  if (url.pathname === '/__health') {
    res.end('ok');
    return;
  }

  if (method === 'OPTIONS') {
    const requestedMethod = req.headers['access-control-request-method'];
    const requestedHeaders = req.headers['access-control-request-headers'];
    const rule = typeof requestedMethod === 'string' ? matchingRule(options.policy, origin, requestedMethod) : undefined;
    if (rule === undefined || origin === undefined || !headersAllowed(rule, requestedHeaders)) {
      res.writeHead(403).end('CORS preflight refused');
      return;
    }
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': rule.AllowedMethods.join(', '),
      ...(requestedHeaders === undefined ? {} : { 'Access-Control-Allow-Headers': requestedHeaders }),
      ...(rule.MaxAgeSeconds === undefined ? {} : { 'Access-Control-Max-Age': String(rule.MaxAgeSeconds) }),
    }).end();
    return;
  }

  const rule = matchingRule(options.policy, origin, method);
  if (rule !== undefined && origin !== undefined) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (rule.ExposeHeaders !== undefined) res.setHeader('Access-Control-Expose-Headers', rule.ExposeHeaders.join(', '));
  }
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  const target = resolveKey(options.generatedDir, url.pathname);
  if (target === null) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end(method === 'HEAD' ? undefined : 'NoSuchKey');
    return;
  }
  const body = readFileSync(target.file);
  const headers = { 'Content-Type': target.contentType, 'Cache-Control': IMMUTABLE_CACHE_CONTROL, 'Accept-Ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range !== null) {
    const [, from = '', to = ''] = range;
    const start = from === '' ? Math.max(0, body.length - Number(to)) : Number(from);
    const end = from === '' || to === '' ? body.length - 1 : Math.min(Number(to), body.length - 1);
    if (start > end || start >= body.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${body.length}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${body.length}` });
    res.end(method === 'HEAD' ? undefined : body.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': body.length });
  res.end(method === 'HEAD' ? undefined : body);
}

export function startR2Emulator(options: EmulatorOptions): Promise<RunningEmulator> {
  const server = createServer((req, res) => {
    try {
      handle(options, req, res);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, 'localhost', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://localhost:${port}/`,
        close: () => new Promise((done) => { server.close(() => { done(); }); }),
      });
    });
  });
}
