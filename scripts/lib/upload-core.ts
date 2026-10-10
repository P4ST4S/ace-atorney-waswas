/**
 * Release upload logic, independent of the S3 client so that it can be tested with an in-memory store.
 *
 * Invariants:
 * - a published object is immutable: an existing key is never overwritten (conditional create + HEAD check);
 * - an object is skipped only when its size and explicit SHA-256 metadata match (an ETag is not always an MD5);
 * - the release index (`release.json`) is uploaded last, after a full completeness check: its presence on the
 *   bucket means "this release is complete" (the frontend build checks it);
 * - nothing is ever deleted, so older releases stay available for rollbacks.
 */
import type { ReleaseFile, ReleaseIndex } from '../../asset-meta/manifest-types.ts';
import { IMMUTABLE_CACHE_CONTROL, RELEASES_PREFIX, RELEASE_INDEX_FILE, releaseKey } from '../../asset-meta/release-layout.ts';
import { md5Base64, sha256Hex } from './release.ts';

export interface RemoteObject {
  readonly size: number;
  /** Value of the `sha256` user metadata (x-amz-meta-sha256), if any. */
  readonly sha256: string | undefined;
  readonly contentType: string | undefined;
  readonly cacheControl: string | undefined;
}

export interface PutRequest {
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly sha256: string;
  readonly md5Base64: string;
}

/** Minimal object storage used by the upload (implemented over S3 for R2, in memory for tests). */
export interface ObjectStore {
  head(key: string): Promise<RemoteObject | null>;
  /** Creates the object only if the key does not exist yet; 'exists' when another writer got there first. */
  putIfAbsent(request: PutRequest): Promise<'created' | 'exists'>;
  list(prefix: string): Promise<readonly { readonly key: string; readonly size: number }[]>;
}

// ---------------------------------------------------------------------------
// Retries and bounded concurrency
// ---------------------------------------------------------------------------

export class ImmutableObjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImmutableObjectError';
  }
}

const TRANSIENT_NAMES = new Set([
  'TimeoutError', 'RequestTimeout', 'RequestTimeoutException', 'ThrottlingException', 'Throttling', 'SlowDown',
  'TooManyRequests', 'InternalError', 'ServiceUnavailable', 'NetworkingError',
]);
const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
]);

function field(error: unknown, name: string): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, name) : undefined;
}

export function httpStatus(error: unknown): number | undefined {
  const status = field(field(error, '$metadata'), 'httpStatusCode');
  return typeof status === 'number' ? status : undefined;
}

/** Network failures, throttling (429) and server errors (5xx) are worth retrying; 4xx client errors are not. */
export function isTransient(error: unknown): boolean {
  if (error instanceof ImmutableObjectError) return false;
  if (field(error, '$retryable') !== undefined) return true;
  const status = httpStatus(error);
  if (status !== undefined) return status === 429 || status >= 500;
  const name = field(error, 'name');
  const code = field(error, 'code') ?? field(field(error, 'cause'), 'code');
  return (typeof name === 'string' && TRANSIENT_NAMES.has(name)) || (typeof code === 'string' && TRANSIENT_CODES.has(code));
}

export function describeError(error: unknown): string {
  const status = httpStatus(error);
  const name = field(error, 'name');
  const message = error instanceof Error ? error.message : String(error);
  return `${typeof name === 'string' ? name : 'Error'}${status === undefined ? '' : ` (HTTP ${status})`}: ${message}`;
}

export interface RetryOptions {
  readonly attempts: number;
  readonly baseMs: number;
  readonly maxMs: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export const DEFAULT_RETRY: RetryOptions = { attempts: 5, baseMs: 300, maxMs: 8000 };

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries transient failures with exponential backoff and full jitter. */
export async function withRetry<T>(task: () => Promise<T>, options: RetryOptions = DEFAULT_RETRY): Promise<T> {
  const sleep = options.sleep ?? realSleep;
  const random = options.random ?? Math.random;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= options.attempts || !isTransient(error)) throw error;
      const delayMs = Math.round(random() * Math.min(options.maxMs, options.baseMs * 2 ** (attempt - 1)));
      options.onRetry?.(attempt, delayMs, error);
      await sleep(delayMs);
    }
  }
}

/** Runs `task` over `items` with at most `limit` tasks in flight; stops starting new ones after a failure. */
export async function runPool<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const errors: unknown[] = [];
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await task(items[index] as T);
      } catch (error) {
        failed = true;
        errors.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (errors.length > 0) throw errors[0];
  return results;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export type FileOutcome = 'uploaded' | 'skipped' | 'missing';

export interface UploadOptions {
  readonly dryRun: boolean;
  readonly concurrency: number;
  readonly retry?: RetryOptions;
  readonly readFile: (file: ReleaseFile) => Promise<Uint8Array>;
  readonly indexText: string;
  readonly log: (line: string) => void;
}

export interface UploadReport {
  readonly release: string;
  readonly uploaded: readonly string[];
  readonly skipped: readonly string[];
  /** Dry run only: keys that a real run would upload. */
  readonly pending: readonly string[];
  /** 'uploaded' (now complete), 'present' (was already complete), 'pending' (dry run, not yet published). */
  readonly marker: 'uploaded' | 'present' | 'pending';
}

function sameObject(remote: RemoteObject, file: ReleaseFile): boolean {
  return remote.size === file.size && remote.sha256 === file.sha256;
}

function conflict(key: string, remote: RemoteObject, file: ReleaseFile): ImmutableObjectError {
  return new ImmutableObjectError(
    `${key} already exists with different content (remote ${remote.size} B, sha256 ${remote.sha256 ?? 'none'}; local ${file.size} B, sha256 ${file.sha256}). `
    + 'Published releases are immutable: rebuild the assets to get a new release instead.',
  );
}

async function syncFile(store: ObjectStore, release: string, file: ReleaseFile, options: UploadOptions): Promise<FileOutcome> {
  const key = releaseKey(release, file.path);
  const existing = await store.head(key);
  if (existing !== null) {
    if (!sameObject(existing, file)) throw conflict(key, existing, file);
    return 'skipped';
  }
  if (options.dryRun) return 'missing';
  const body = await options.readFile(file);
  if (body.byteLength !== file.size || sha256Hex(body) !== file.sha256) throw new Error(`${file.path} changed since \`pnpm assets:build\`.`);
  const created = await store.putIfAbsent({
    key, body, contentType: file.contentType, cacheControl: IMMUTABLE_CACHE_CONTROL, sha256: file.sha256, md5Base64: md5Base64(body),
  });
  if (created === 'created') return 'uploaded';
  const raced = await store.head(key);
  if (raced === null || !sameObject(raced, file)) throw conflict(key, raced ?? { size: -1, sha256: undefined, contentType: undefined, cacheControl: undefined }, file);
  return 'skipped';
}

/** Checks that the bucket holds exactly the release files (plus, possibly, its index) with the right metadata. */
export async function verifyRemoteRelease(store: ObjectStore, index: ReleaseIndex, options: Pick<UploadOptions, 'concurrency' | 'retry'>): Promise<string[]> {
  const prefix = `${RELEASES_PREFIX}${index.release}/`;
  const problems: string[] = [];
  const listed = new Map((await withRetry(() => store.list(prefix), options.retry)).map((o) => [o.key, o.size]));
  const expected = new Map(index.files.map((f) => [releaseKey(index.release, f.path), f]));
  for (const key of expected.keys()) if (!listed.has(key)) problems.push(`missing ${key}`);
  for (const key of listed.keys()) if (!expected.has(key) && key !== `${prefix}${RELEASE_INDEX_FILE}`) problems.push(`unexpected ${key}`);
  const checks = await runPool([...expected], options.concurrency, ([key, file]) => withRetry(async () => {
    const remote = await store.head(key);
    if (remote === null) return `missing ${key}`;
    if (!sameObject(remote, file)) return `different content for ${key}`;
    if (remote.contentType !== file.contentType) return `wrong Content-Type for ${key}: ${remote.contentType ?? 'none'}`;
    if (remote.cacheControl !== IMMUTABLE_CACHE_CONTROL) return `wrong Cache-Control for ${key}: ${remote.cacheControl ?? 'none'}`;
    return null;
  }, options.retry));
  for (const check of checks) if (check !== null) problems.push(check);
  return problems;
}

/**
 * Publishes a release: every file missing from the bucket is uploaded (existing identical ones are skipped),
 * the release is checked for completeness, then its index is uploaded last.
 */
export async function uploadRelease(store: ObjectStore, index: ReleaseIndex, options: UploadOptions): Promise<UploadReport> {
  const { release } = index;
  const retry: RetryOptions = {
    ...(options.retry ?? DEFAULT_RETRY),
    onRetry: (attempt, delayMs, error) => {
      options.log(`  retry ${attempt} in ${delayMs} ms after ${describeError(error)}`);
    },
  };
  const uploaded: string[] = [];
  const skipped: string[] = [];
  const pending: string[] = [];
  await runPool(index.files, options.concurrency, async (file) => {
    const key = releaseKey(release, file.path);
    const outcome = await withRetry(() => syncFile(store, release, file, options), retry);
    if (outcome === 'uploaded') uploaded.push(key);
    else if (outcome === 'skipped') skipped.push(key);
    else pending.push(key);
    options.log(`  ${outcome === 'uploaded' ? 'uploaded' : outcome === 'skipped' ? 'unchanged' : 'to upload'}  ${key} (${file.size} B)`);
  });

  const indexKey = releaseKey(release, RELEASE_INDEX_FILE);
  const indexBytes = new TextEncoder().encode(options.indexText);
  const indexFile: ReleaseFile = { path: RELEASE_INDEX_FILE, size: indexBytes.byteLength, sha256: sha256Hex(indexBytes), contentType: 'application/json' };
  const existingIndex = await withRetry(() => store.head(indexKey), retry);
  if (existingIndex !== null && !sameObject(existingIndex, indexFile)) throw conflict(indexKey, existingIndex, indexFile);
  if (options.dryRun) return { release, uploaded, skipped, pending, marker: existingIndex === null ? 'pending' : 'present' };

  const problems = await verifyRemoteRelease(store, index, { concurrency: options.concurrency, retry });
  if (problems.length > 0) throw new Error(`Release ${release} is incomplete on the bucket, index not uploaded:\n  ${problems.join('\n  ')}`);
  if (existingIndex !== null) return { release, uploaded, skipped, pending, marker: 'present' };

  const created = await withRetry(() => store.putIfAbsent({
    key: indexKey, body: indexBytes, contentType: indexFile.contentType, cacheControl: IMMUTABLE_CACHE_CONTROL, sha256: indexFile.sha256, md5Base64: md5Base64(indexBytes),
  }), retry);
  if (created === 'exists') {
    const raced = await withRetry(() => store.head(indexKey), retry);
    if (raced === null || !sameObject(raced, indexFile)) throw new ImmutableObjectError(`${indexKey} was written concurrently with different content.`);
  }
  options.log(`  uploaded  ${indexKey} (release marker)`);
  return { release, uploaded, skipped, pending, marker: 'uploaded' };
}
