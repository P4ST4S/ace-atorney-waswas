import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReleaseIndex } from '../asset-meta/manifest-types.ts';
import { startR2Emulator, type RunningEmulator } from '../tests/support/r2-emulator.ts';
import { UNLISTED_ORIGIN, checkCors, checkPublicFiles, fetchPublishedIndex, readCorsPolicy, releaseUrl, type CorsPolicy } from './lib/public-check.ts';
import { prepareRelease } from './lib/release.ts';

const POLICY = readCorsPolicy(join(import.meta.dirname, '..', 'deploy', 'r2', 'cors.json'));
const ORIGIN = 'http://localhost:5198';

let dir: string;
let index: ReleaseIndex;
const emulators: RunningEmulator[] = [];

async function emulator(policy: CorsPolicy = POLICY): Promise<string> {
  const running = await startR2Emulator({ generatedDir: dir, policy });
  emulators.push(running);
  return running.url;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'waswas-emulator-'));
  const files = { 'img/bg.webp': 'webp-bytes', 'audio/sfx.gavel.wav': 'RIFF-wav-bytes', '.cache.json': '{}' };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const prepared = prepareRelease(dir, { version: 2, images: { bg: { path: 'img/bg.webp', w: 1, h: 1 } }, sprites: {}, audio: { 'sfx.gavel': 'audio/sfx.gavel.wav' } });
  writeFileSync(join(dir, 'manifest.json'), prepared.manifestText);
  writeFileSync(join(dir, 'release.json'), prepared.indexText);
  index = prepared.index;
});

afterAll(async () => {
  await Promise.all(emulators.map((e) => e.close()));
  rmSync(dir, { recursive: true, force: true });
});

describe('public checks against the R2 emulator', () => {
  it('finds the published index and every file with its headers', async () => {
    const base = await emulator();
    expect(await fetchPublishedIndex(base, index.release, fetch)).toEqual(index);
    expect(await fetchPublishedIndex(base, 'ffffffffffffffff', fetch)).toBeNull();
    expect(await checkPublicFiles(base, index, fetch)).toEqual([]);
  });

  it('only serves the keys of the release (no pipeline cache, no other release)', async () => {
    const base = await emulator();
    expect((await fetch(releaseUrl(base, index.release, '.cache.json'))).status).toBe(404);
    expect((await fetch(`${base}generated/img/bg.webp`)).status).toBe(404);
    const range = await fetch(releaseUrl(base, index.release, 'img/bg.webp'), { headers: { Range: 'bytes=0-3' } });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe('webp');
  });

  it('accepts the listed origins and refuses an unlisted one, as the bucket policy says', async () => {
    const base = await emulator();
    expect(await checkCors(base, index, [ORIGIN], fetch)).toEqual([]);
    const problems = await checkCors(base, index, [UNLISTED_ORIGIN.replace('unlisted', 'other')], fetch);
    expect(problems.some((p) => p.includes('Access-Control-Allow-Origin absent'))).toBe(true);
  });

  it('reports a policy that does not allow the Range header or that allows every origin', async () => {
    const noRange = await emulator(POLICY.map((rule) => ({ ...rule, AllowedHeaders: [] })));
    expect((await checkCors(noRange, index, [ORIGIN], fetch)).some((p) => p.includes('HTTP 403'))).toBe(true);
    const open = await emulator(POLICY.map((rule) => ({ ...rule, AllowedOrigins: ['*'] })));
    expect((await checkCors(open, index, [ORIGIN], fetch)).some((p) => p.includes('unlisted origin is allowed'))).toBe(true);
  });
});
