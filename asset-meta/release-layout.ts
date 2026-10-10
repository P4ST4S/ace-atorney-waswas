/**
 * Where generated assets live and how their URLs and storage keys are built.
 *
 * Pure module (no DOM, no Node API beyond `URL`): shared by the runtime, the pipeline and upload scripts,
 * the Vite plugin and the tests, so that browser URLs and R2 object keys cannot drift apart.
 *
 *   local:  <app base>generated/<path>                       served by Vite from public/generated/
 *   remote: <VITE_ASSET_BASE_URL>releases/<release>/<path>   R2 object key: releases/<release>/<path>
 *
 * `path` is a manifest path such as "sprites/ron-delite/normal.webp" (relative, `/`-separated, raw characters).
 */

export const RELEASES_PREFIX = 'releases/';
/** Local directory (under the app base) that holds the generated files and the manifest. */
export const LOCAL_ASSET_DIR = 'generated/';
export const MANIFEST_FILE = 'manifest.json';
export const RELEASE_INDEX_FILE = 'release.json';
/** A release is the first 16 hex characters of a SHA-256 (see scripts/lib/release.ts). */
export const RELEASE_PATTERN = /^[0-9a-f]{16}$/;
/** Release objects never change once published, so browsers may keep them for a year without revalidating. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type AssetSource =
  | { readonly kind: 'local' }
  | { readonly kind: 'remote'; readonly base: string };

/**
 * Parses the public `VITE_ASSET_BASE_URL` setting.
 * Unset or empty means local mode; otherwise it must be an absolute http(s) URL without query, fragment or
 * credentials. The result always ends with exactly one `/`. Nothing is appended (in particular no bucket name).
 */
export function parseAssetBaseUrl(raw: string | undefined): AssetSource {
  const value = raw?.trim() ?? '';
  if (value === '') return { kind: 'local' };
  const invalid = (why: string): Error => new Error(`VITE_ASSET_BASE_URL "${value}" is invalid: ${why}.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid('expected an absolute http(s) URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid('expected an absolute http(s) URL');
  // An https page cannot use http assets (mixed content); plain http is only for local test servers.
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) throw invalid('use https (http is only allowed for localhost)');
  if (value.includes('?') || value.includes('#')) throw invalid('query strings and fragments are not allowed');
  if (url.username !== '' || url.password !== '') throw invalid('credentials are not allowed');
  if (url.hostname.endsWith('.r2.cloudflarestorage.com')) throw invalid('this is the private S3 API endpoint, not the public bucket URL');
  if (url.hostname.endsWith('.r2.dev') && !/^\/+$/.test(url.pathname)) throw invalid('an r2.dev URL is already bound to its bucket, do not append a path (such as the bucket name)');
  return { kind: 'remote', base: url.href.replace(/\/*$/, '/') };
}

/**
 * Checks a manifest path and returns it unchanged. Rejects anything that could escape the release root or
 * produce an ambiguous key: empty paths, leading or trailing `/`, empty, `.` or `..` segments, backslashes and
 * control characters. Other characters (spaces, `#`, `?`, `%`, accents…) are allowed and percent-encoded in URLs.
 */
export function validateAssetPath(path: string): string {
  const invalid = (why: string): Error => new Error(`Invalid asset path "${path}": ${why}.`);
  if (path === '') throw invalid('empty');
  if (path.includes('\\')) throw invalid('use "/" as separator');
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected here.
  if (/[\u0000-\u001f\u007f]/.test(path)) throw invalid('control character');
  for (const segment of path.split('/')) {
    if (segment === '') throw invalid('empty segment (leading, trailing or double "/")');
    if (segment === '.' || segment === '..') throw invalid('relative segment');
  }
  return path;
}

/** Percent-encodes each segment of a validated path; `/` separators are kept. */
export function encodeAssetPath(path: string): string {
  return validateAssetPath(path).split('/').map(encodeURIComponent).join('/');
}

export function validateRelease(release: string): string {
  if (!RELEASE_PATTERN.test(release)) throw new Error(`Invalid asset release "${release}": expected 16 hex characters.`);
  return release;
}

/** Raw (not percent-encoded) object key of a release file in the bucket. */
export function releaseKey(release: string, path: string): string {
  return `${RELEASES_PREFIX}${validateRelease(release)}/${validateAssetPath(path)}`;
}

/** URL prefix of the generated files: `appBase` is Vite's `BASE_URL` (ends with "/"). */
export function assetRoot(source: AssetSource, appBase: string, release: string): string {
  if (source.kind === 'local') return `${appBase}${LOCAL_ASSET_DIR}`;
  return `${source.base}${RELEASES_PREFIX}${validateRelease(release)}/`;
}

export function resolveAssetUrl(root: string, path: string): string {
  return `${root}${encodeAssetPath(path)}`;
}

/** The manifest is always served by the frontend itself, in both modes. */
export function localManifestUrl(appBase: string): string {
  return `${appBase}${LOCAL_ASSET_DIR}${MANIFEST_FILE}`;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  webp: 'image/webp',
  png: 'image/png',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  json: 'application/json',
};

/** Content-Type of a release file; unknown extensions are an error rather than a guess. */
export function contentTypeFor(path: string): string {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  const type = ext === undefined ? undefined : CONTENT_TYPES[ext];
  if (type === undefined) throw new Error(`No Content-Type known for "${path}".`);
  return type;
}
