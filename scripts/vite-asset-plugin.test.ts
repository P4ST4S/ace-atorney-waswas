import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AssetManifest, ReleaseIndex } from '../asset-meta/manifest-types.ts';
import { corsOrigins, readCorsPolicy } from './lib/public-check.ts';
import { sha256Hex } from './lib/release.ts';
import { assertPublished, distAssetFiles, fetchPublishedManifest, secretLikeEnvNames, type TextFetch } from './vite-asset-plugin.ts';

const MANIFEST: AssetManifest = {
  version: 2,
  release: '0123456789abcdef',
  images: { bg: { path: 'img/bg.webp', w: 1, h: 1 } },
  sprites: { ron: { normal: { path: 'sprites/ron/normal.webp', sheet: { w: 1, h: 1 }, size: { w: 1, h: 1 }, anchor: { x: 0, y: 0 }, scale: 1, idle: [], blink: [], talk: [] } } },
  audio: { gavel: 'audio/gavel.wav' },
};
const MANIFEST_TEXT = `${JSON.stringify(MANIFEST)}\n`;
const BASE = 'https://pub-fcafc9a980984336ba95440ef648c8cb.r2.dev/';

function index(manifestText: string): ReleaseIndex {
  return { schema: 1, release: MANIFEST.release, files: [{ path: 'manifest.json', size: manifestText.length, sha256: sha256Hex(manifestText), contentType: 'application/json' }] };
}

function bucket(objects: Readonly<Record<string, string>>): TextFetch & { readonly urls: string[] } {
  const urls: string[] = [];
  const fetchFn = (url: string) => {
    urls.push(url);
    const body = objects[url];
    return Promise.resolve({ ok: body !== undefined, status: body === undefined ? 404 : 200, text: () => Promise.resolve(body ?? '') });
  };
  return Object.assign(fetchFn, { urls });
}

describe('distAssetFiles', () => {
  it('ships the manifest and exactly its files locally, only the manifest in remote mode', () => {
    expect(distAssetFiles(MANIFEST, { kind: 'local' })).toEqual(['audio/gavel.wav', 'img/bg.webp', 'manifest.json', 'sprites/ron/normal.webp']);
    expect(distAssetFiles(MANIFEST, { kind: 'remote', base: BASE })).toEqual(['manifest.json']);
  });
});

describe('secretLikeEnvNames', () => {
  it('flags VITE_* variables that look like credentials', () => {
    expect(secretLikeEnvNames(['VITE_ASSET_BASE_URL', 'BASE_URL', 'R2_SECRET_ACCESS_KEY'])).toEqual([]);
    expect(secretLikeEnvNames(['VITE_R2_ACCESS_KEY_ID', 'VITE_SECRET', 'VITE_API_TOKEN'])).toHaveLength(3);
  });
});

describe('published release checks', () => {
  const indexUrl = `${BASE}releases/${MANIFEST.release}/release.json`;
  const manifestUrl = `${BASE}releases/${MANIFEST.release}/manifest.json`;

  it('accepts a complete release whose index lists this exact manifest', async () => {
    await expect(assertPublished(BASE, MANIFEST_TEXT, bucket({ [indexUrl]: JSON.stringify(index(MANIFEST_TEXT)) }))).resolves.toMatchObject({ release: MANIFEST.release });
  });

  it('rejects an unpublished or incomplete release (no index) and a different manifest', async () => {
    await expect(assertPublished(BASE, MANIFEST_TEXT, bucket({}))).rejects.toThrow(/not found at .*release\.json \(HTTP 404\)/);
    const other = MANIFEST_TEXT.replace('"w":1', '"w":2');
    await expect(assertPublished(BASE, other, bucket({ [indexUrl]: JSON.stringify(index(MANIFEST_TEXT)) }))).rejects.toThrow(/differs/);
  });

  it('downloads the manifest of an older release for rollback builds', async () => {
    const fetchFn = bucket({ [manifestUrl]: MANIFEST_TEXT, [indexUrl]: JSON.stringify(index(MANIFEST_TEXT)) });
    await expect(fetchPublishedManifest(BASE, MANIFEST.release, fetchFn)).resolves.toBe(MANIFEST_TEXT);
    await expect(fetchPublishedManifest(BASE, 'not-a-release', fetchFn)).rejects.toThrow(/Invalid asset release/);
  });
});

describe('deploy/r2 CORS policy', () => {
  const dir = join(import.meta.dirname, '..', 'deploy', 'r2');
  const policy = readCorsPolicy(join(dir, 'cors.json'));

  it('allows the local origins actually used, read-only, without wildcards', () => {
    expect(corsOrigins(policy).sort()).toEqual(['http://localhost:4173', 'http://localhost:5173', 'http://localhost:5198']);
    for (const rule of policy) {
      expect([...rule.AllowedMethods].sort()).toEqual(['GET', 'HEAD']);
      expect(rule.AllowedHeaders).toContain('Range');
      for (const origin of rule.AllowedOrigins) expect(origin).toMatch(/^https?:\/\/[a-z0-9.-]+(?::\d+)?$/);
    }
  });

  it('has an equivalent wrangler version', () => {
    const wrangler = JSON.parse(readFileSync(join(dir, 'cors.wrangler.json'), 'utf8')) as {
      rules: { allowed: { origins: string[]; methods: string[]; headers: string[] }; exposeHeaders: string[]; maxAgeSeconds: number }[];
    };
    expect(wrangler.rules.map((r) => ({
      AllowedOrigins: r.allowed.origins, AllowedMethods: r.allowed.methods, AllowedHeaders: r.allowed.headers, ExposeHeaders: r.exposeHeaders, MaxAgeSeconds: r.maxAgeSeconds,
    }))).toEqual(JSON.parse(readFileSync(join(dir, 'cors.json'), 'utf8')));
  });
});
