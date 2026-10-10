import { describe, expect, it } from 'vitest';
import type { ReleaseFile, ReleaseIndex } from '../asset-meta/manifest-types.ts';
import { IMMUTABLE_CACHE_CONTROL, contentTypeFor, releaseKey } from '../asset-meta/release-layout.ts';
import { sha256Hex } from './lib/release.ts';
import {
  ImmutableObjectError, isTransient, runPool, uploadRelease, withRetry, type ObjectStore, type PutRequest, type RemoteObject, type UploadOptions,
} from './lib/upload-core.ts';

const RELEASE = '0123456789abcdef';
const CONTENT: Readonly<Record<string, string>> = { 'img/a.webp': 'aaaa', 'audio/b.wav': 'bb', 'manifest.json': '{"version":2}' };

function file(path: string): ReleaseFile {
  const body = CONTENT[path] ?? '';
  return { path, size: body.length, sha256: sha256Hex(body), contentType: contentTypeFor(path) };
}

const INDEX: ReleaseIndex = { schema: 1, release: RELEASE, files: Object.keys(CONTENT).sort().map(file) };
const INDEX_TEXT = `${JSON.stringify(INDEX)}\n`;

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { $metadata: { httpStatusCode: status } });
}

/** In-memory bucket with conditional creates, request log and optional injected failures. */
class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, RemoteObject & { readonly body: Uint8Array }>();
  readonly writes: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  failures: ((op: string, key: string) => Error | null) | null = null;

  private async enter<T>(op: string, key: string, run: () => T): Promise<T> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.inFlight -= 1;
    const failure = this.failures?.(op, key) ?? null;
    if (failure !== null) throw failure;
    return run();
  }

  head(key: string): Promise<RemoteObject | null> {
    return this.enter('head', key, () => this.objects.get(key) ?? null);
  }

  putIfAbsent(request: PutRequest): Promise<'created' | 'exists'> {
    return this.enter('put', request.key, () => {
      if (this.objects.has(request.key)) return 'exists';
      this.writes.push(request.key);
      this.objects.set(request.key, { size: request.body.byteLength, sha256: request.sha256, contentType: request.contentType, cacheControl: request.cacheControl, body: request.body });
      return 'created';
    });
  }

  list(prefix: string): Promise<{ key: string; size: number }[]> {
    return this.enter('list', prefix, () => [...this.objects].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({ key, size: o.size })));
  }

  seed(path: string, body: string, sha256 = sha256Hex(body)): void {
    this.objects.set(releaseKey(RELEASE, path), { size: body.length, sha256, contentType: contentTypeFor(path), cacheControl: IMMUTABLE_CACHE_CONTROL, body: new TextEncoder().encode(body) });
  }
}

function options(overrides: Partial<UploadOptions> = {}): UploadOptions & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    dryRun: false,
    concurrency: 2,
    retry: { attempts: 4, baseMs: 1, maxMs: 2, sleep: () => Promise.resolve(), random: () => 0.5 },
    indexText: INDEX_TEXT,
    readFile: (f) => Promise.resolve(new TextEncoder().encode(CONTENT[f.path] ?? '')),
    log: (line) => { lines.push(line); },
    ...overrides,
    lines,
  };
}

const MARKER = releaseKey(RELEASE, 'release.json');

describe('uploadRelease', () => {
  it('uploads every file with its metadata, then the release marker last', async () => {
    const store = new MemoryStore();
    const report = await uploadRelease(store, INDEX, options());
    expect(report.uploaded).toHaveLength(3);
    expect(report.marker).toBe('uploaded');
    expect(store.writes.at(-1)).toBe(MARKER);
    const image = store.objects.get(releaseKey(RELEASE, 'img/a.webp'));
    expect(image).toMatchObject({ size: 4, sha256: sha256Hex('aaaa'), contentType: 'image/webp', cacheControl: IMMUTABLE_CACHE_CONTROL });
    expect(new TextDecoder().decode(store.objects.get(MARKER)?.body)).toBe(INDEX_TEXT);
  });

  it('skips identical objects and is a no-op once published', async () => {
    const store = new MemoryStore();
    store.seed('img/a.webp', 'aaaa');
    const first = await uploadRelease(store, INDEX, options());
    expect(first.skipped).toEqual([releaseKey(RELEASE, 'img/a.webp')]);
    store.writes.length = 0;
    const second = await uploadRelease(store, INDEX, options());
    expect(second).toMatchObject({ uploaded: [], marker: 'present' });
    expect(store.writes).toEqual([]);
  });

  it('never overwrites an object whose content differs (immutable release)', async () => {
    const store = new MemoryStore();
    store.seed('audio/b.wav', 'BB');
    await expect(uploadRelease(store, INDEX, options())).rejects.toBeInstanceOf(ImmutableObjectError);
    expect(store.writes).not.toContain(MARKER);
    expect(new TextDecoder().decode(store.objects.get(releaseKey(RELEASE, 'audio/b.wav'))?.body)).toBe('BB');
  });

  it('does not trust a matching size without the explicit fingerprint', async () => {
    const store = new MemoryStore();
    store.seed('audio/b.wav', 'bb', 'f'.repeat(64));
    await expect(uploadRelease(store, INDEX, options())).rejects.toThrow(/different content/);
  });

  it('accepts losing a creation race to an identical object', async () => {
    const store = new MemoryStore();
    const original = store.putIfAbsent.bind(store);
    store.putIfAbsent = async (request) => {
      if (request.key === releaseKey(RELEASE, 'img/a.webp') && !store.objects.has(request.key)) {
        store.seed('img/a.webp', 'aaaa');
        return 'exists';
      }
      return original(request);
    };
    const report = await uploadRelease(store, INDEX, options());
    expect(report.skipped).toContain(releaseKey(RELEASE, 'img/a.webp'));
    expect(report.marker).toBe('uploaded');
  });

  it('retries transient errors (503, 429, network) but not client errors', async () => {
    const store = new MemoryStore();
    const failures = new Map<string, number>();
    store.failures = (op, key) => {
      const count = (failures.get(`${op}:${key}`) ?? 0) + 1;
      failures.set(`${op}:${key}`, count);
      if (op === 'put' && key.endsWith('a.webp') && count <= 2) return httpError(count === 1 ? 503 : 429);
      if (op === 'head' && key.endsWith('b.wav') && count === 1) return Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return null;
    };
    const run = options();
    const report = await uploadRelease(store, INDEX, run);
    expect(report.marker).toBe('uploaded');
    expect(run.lines.filter((l) => l.includes('retry'))).toHaveLength(3);

    const denied = new MemoryStore();
    denied.failures = (op) => (op === 'put' ? httpError(403) : null);
    await expect(uploadRelease(denied, INDEX, options())).rejects.toThrow(/403/);
    expect(denied.writes).toEqual([]);
  });

  it('respects the concurrency limit', async () => {
    const store = new MemoryStore();
    const many: ReleaseIndex = { ...INDEX, files: Array.from({ length: 12 }, (_, i) => ({ ...file('img/a.webp'), path: `img/${i}.webp` })) };
    await uploadRelease(store, many, options({ concurrency: 3, readFile: () => Promise.resolve(new TextEncoder().encode('aaaa')) }));
    expect(store.maxInFlight).toBeLessThanOrEqual(3);
    expect(store.maxInFlight).toBeGreaterThan(1);
  });

  it('dry run: reads only and reports what would be uploaded', async () => {
    const store = new MemoryStore();
    store.seed('img/a.webp', 'aaaa');
    const report = await uploadRelease(store, INDEX, options({ dryRun: true }));
    expect(store.writes).toEqual([]);
    expect(report).toMatchObject({ uploaded: [], skipped: [releaseKey(RELEASE, 'img/a.webp')], marker: 'pending' });
    expect(report.pending).toHaveLength(2);
  });

  it('refuses to publish the marker when the bucket holds unexpected objects for the release', async () => {
    const store = new MemoryStore();
    store.objects.set(releaseKey(RELEASE, 'img/stray.webp'), { size: 1, sha256: 'x', contentType: 'image/webp', cacheControl: IMMUTABLE_CACHE_CONTROL, body: new Uint8Array(1) });
    await expect(uploadRelease(store, INDEX, options())).rejects.toThrow(/unexpected .*stray/);
    expect(store.objects.has(MARKER)).toBe(false);
  });

  it('refuses a local file that changed after the build', async () => {
    const store = new MemoryStore();
    await expect(uploadRelease(store, INDEX, options({ readFile: () => Promise.resolve(new TextEncoder().encode('zzzz')) }))).rejects.toThrow(/changed since/);
  });

  it('logs keys and counters only', async () => {
    const run = options();
    await uploadRelease(new MemoryStore(), INDEX, run);
    expect(run.lines.join('\n')).toMatch(/uploaded {2}releases\/0123456789abcdef\/img\/a\.webp/);
    expect(run.lines.join('\n')).not.toMatch(/secret|access_key|R2_/i);
  });
});

describe('withRetry / isTransient / runPool', () => {
  it('classifies errors', () => {
    expect(isTransient(httpError(500))).toBe(true);
    expect(isTransient(httpError(429))).toBe(true);
    expect(isTransient(httpError(404))).toBe(false);
    expect(isTransient(Object.assign(new Error('x'), { $retryable: {} }))).toBe(true);
    expect(isTransient(Object.assign(new Error('x'), { cause: { code: 'ETIMEDOUT' } }))).toBe(true);
    expect(isTransient(new ImmutableObjectError('x'))).toBe(false);
  });

  it('backs off exponentially and gives up after the last attempt', async () => {
    const delays: number[] = [];
    let calls = 0;
    const task = () => { calls += 1; return Promise.reject(httpError(503)); };
    await expect(withRetry(task, { attempts: 4, baseMs: 100, maxMs: 250, random: () => 1, sleep: (ms) => { delays.push(ms); return Promise.resolve(); } })).rejects.toThrow(/503/);
    expect(calls).toBe(4);
    expect(delays).toEqual([100, 200, 250]);
  });

  it('keeps result order and stops scheduling after a failure', async () => {
    expect(await runPool([3, 1, 2], 2, (n) => Promise.resolve(n * 10))).toEqual([30, 10, 20]);
    const started: number[] = [];
    await expect(runPool([1, 2, 3, 4, 5], 1, (n) => { started.push(n); return n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(n); })).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });
});
