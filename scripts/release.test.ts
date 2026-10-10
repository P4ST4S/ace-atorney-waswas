import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { contentTypeFor } from '../asset-meta/release-layout.ts';
import {
  assertPublicSafe, canonicalJson, computeRelease, manifestPaths, parseManifest, prepareRelease, readLocalRelease, type ManifestBody,
} from './lib/release.ts';

const BODY: ManifestBody = {
  version: 2,
  images: { 'court.defense': { path: 'img/court.defense.webp', w: 4, h: 2 }, 'evidence.demo-badge': { path: 'img/evidence.demo-badge.webp', w: 1, h: 1 } },
  sprites: { ron: { normal: { path: 'sprites/ron/normal.webp', sheet: { w: 1, h: 1 }, size: { w: 1, h: 1 }, anchor: { x: 0, y: 0 }, scale: 1, idle: [], blink: [], talk: [] } } },
  audio: { 'sfx.gavel': 'audio/sfx.gavel.wav', 'music.trial': 'audio/music.trial.mp3' },
};

const FILES = { 'img/court.defense.webp': 'bg', 'img/evidence.demo-badge.webp': 'badge', 'sprites/ron/normal.webp': 'ron', 'audio/sfx.gavel.wav': 'gavel', 'audio/music.trial.mp3': 'music' };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function generatedDir(files: Readonly<Record<string, string>> = FILES): string {
  const dir = mkdtempSync(join(tmpdir(), 'waswas-release-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

function writeRelease(dir: string, body: ManifestBody = BODY): string {
  const prepared = prepareRelease(dir, body);
  writeFileSync(join(dir, 'manifest.json'), prepared.manifestText);
  writeFileSync(join(dir, 'release.json'), prepared.indexText);
  return prepared.manifest.release;
}

describe('release version', () => {
  const b = { path: 'b.webp', size: 2, sha256: 'b'.repeat(64) };
  const a = { path: 'a.webp', size: 1, sha256: 'a'.repeat(64) };
  const digests = [b, a];

  it('is 16 hex characters, independent of file order and object key order', () => {
    const release = computeRelease(BODY, digests);
    expect(release).toMatch(/^[0-9a-f]{16}$/);
    expect(computeRelease(BODY, [...digests].reverse())).toBe(release);
    const reordered = JSON.parse(canonicalJson(BODY)) as ManifestBody;
    expect(computeRelease({ audio: reordered.audio, sprites: reordered.sprites, images: reordered.images, version: 2 }, digests)).toBe(release);
  });

  it('changes with any content, size, path or manifest change', () => {
    const release = computeRelease(BODY, digests);
    expect(computeRelease(BODY, [{ ...b, sha256: 'c'.repeat(64) }, a])).not.toBe(release);
    expect(computeRelease(BODY, [{ ...b, size: 3 }, a])).not.toBe(release);
    expect(computeRelease(BODY, [{ ...b, path: 'c.webp' }, a])).not.toBe(release);
    expect(computeRelease({ ...BODY, images: { ...BODY.images, 'court.defense': { path: 'img/court.defense.webp', w: 5, h: 2 } } }, digests)).not.toBe(release);
  });
});

describe('prepareRelease / readLocalRelease', () => {
  it('lists exactly the referenced files plus the manifest, sorted, with their Content-Type', () => {
    const dir = generatedDir({ ...FILES, '.cache.json': '{}', 'sprites/ron/poses.json': '{}', 'img/stale.webp': 'old' });
    const prepared = prepareRelease(dir, BODY);
    expect(prepared.index.files.map((f) => f.path)).toEqual([
      'audio/music.trial.mp3', 'audio/sfx.gavel.wav', 'img/court.defense.webp', 'img/evidence.demo-badge.webp', 'manifest.json', 'sprites/ron/normal.webp',
    ]);
    expect(prepared.index.files.find((f) => f.path === 'manifest.json')?.contentType).toBe('application/json');
    expect(prepared.index.files.find((f) => f.path === 'audio/music.trial.mp3')?.contentType).toBe('audio/mpeg');
    expect(parseManifest(prepared.manifestText).release).toBe(prepared.index.release);
  });

  it('accepts an untouched release and is deterministic', () => {
    const dir = generatedDir();
    const release = writeRelease(dir);
    expect(readLocalRelease(dir).index.release).toBe(release);
    expect(writeRelease(generatedDir())).toBe(release);
  });

  it('rejects a file changed after the build', () => {
    const dir = generatedDir();
    writeRelease(dir);
    writeFileSync(join(dir, 'audio/sfx.gavel.wav'), 'gavel!');
    expect(() => readLocalRelease(dir)).toThrow(/changed since the last build/);
  });

  it('rejects an index that does not describe the files', () => {
    const dir = generatedDir();
    writeRelease(dir);
    const index = readFileSync(join(dir, 'release.json'), 'utf8');
    writeFileSync(join(dir, 'release.json'), index.replace('"application/json"', '"text/plain"'));
    expect(() => readLocalRelease(dir)).toThrow(/release.json does not match/);
  });

  it('asks for a build when nothing was generated', () => {
    expect(() => readLocalRelease(generatedDir({}))).toThrow(/pnpm assets:build/);
  });
});

describe('manifestPaths', () => {
  it('validates paths and refuses reserved names', () => {
    expect(() => manifestPaths({ ...BODY, audio: { x: '../secret.wav' } })).toThrow(/Invalid asset path/);
    expect(() => manifestPaths({ ...BODY, audio: { x: 'release.json' } })).toThrow(/reserved/);
  });

  it('keeps generated names portable (dev server, case-insensitive disks)', () => {
    expect(() => manifestPaths({ ...BODY, audio: { x: 'audio/dog bark.wav' } })).toThrow(/must only use/);
    expect(() => manifestPaths({ ...BODY, audio: { x: 'audio/a#b.wav' } })).toThrow(/must only use/);
    expect(() => manifestPaths({ ...BODY, audio: { x: 'img/Court.Defense.webp' } })).toThrow(/only differ by case/);
  });
});

describe('assertPublicSafe', () => {
  const index = (paths: readonly string[]) => ({ schema: 1 as const, release: '0123456789abcdef', files: paths.map((path) => ({ path, size: 1, sha256: 'a'.repeat(64), contentType: 'image/webp' })) });

  it('allows demo evidence only', () => {
    expect(() => { assertPublicSafe(index(['img/evidence.demo-capture.webp', 'img/court.defense.webp'])); }).not.toThrow();
    expect(() => { assertPublicSafe(index(['img/evidence.capture-whatsapp.webp'])); }).toThrow(/non-demo evidence/);
  });
});

describe('generated manifest', () => {
  const manifestPath = join(import.meta.dirname, '..', 'public', 'generated', 'manifest.json');
  it.skipIf(!existsSync(manifestPath))('has a Content-Type for every runtime file', () => {
    const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
    for (const path of manifestPaths(manifest)) expect(() => contentTypeFor(path), path).not.toThrow();
  });
});
