import { describe, expect, it, vi } from 'vitest';
import type { AssetManifest } from '../../asset-meta/manifest-types.ts';
import { AssetCatalog, probeAssetCors } from './assets.ts';

const R2 = 'https://pub-fcafc9a980984336ba95440ef648c8cb.r2.dev/';

const MANIFEST: AssetManifest = {
  version: 2,
  release: '484a0b919698a519',
  images: { 'court.defense': { path: 'img/court.defense.webp', w: 1920, h: 1080 }, 'evidence.demo-capture': { path: 'img/evidence.demo capture.webp', w: 10, h: 20 } },
  sprites: { 'ron-delite': { normal: { path: 'sprites/ron-delite/normal.webp', sheet: { w: 1, h: 1 }, size: { w: 1, h: 1 }, anchor: { x: 0, y: 0 }, scale: 1, idle: [], blink: [], talk: [] } } },
  audio: { 'sfx.gavel': 'audio/sfx.gavel.wav' },
};

function fakeFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe('AssetCatalog', () => {
  it('loads the manifest from the frontend and resolves local URLs', async () => {
    const fetchFn = fakeFetch(MANIFEST);
    const catalog = await AssetCatalog.load({ env: { BASE_URL: '/' }, fetch: fetchFn });
    expect(fetchFn).toHaveBeenCalledWith('/generated/manifest.json', { cache: 'no-cache' });
    expect(catalog.source).toEqual({ kind: 'local' });
    expect(catalog.image('court.defense')).toEqual({ url: '/generated/img/court.defense.webp', w: 1920, h: 1080 });
    expect(catalog.pose('ron-delite', 'normal').url).toBe('/generated/sprites/ron-delite/normal.webp');
    expect(catalog.audio('sfx.gavel')).toBe('/generated/audio/sfx.gavel.wav');
  });

  it('resolves every asset kind on the R2 release in remote mode, the manifest staying on the frontend', async () => {
    const fetchFn = fakeFetch(MANIFEST);
    const catalog = await AssetCatalog.load({ env: { BASE_URL: '/', VITE_ASSET_BASE_URL: R2 }, fetch: fetchFn });
    expect(fetchFn).toHaveBeenCalledWith('/generated/manifest.json', { cache: 'no-cache' });
    const root = `${R2}releases/484a0b919698a519/`;
    expect(catalog.image('court.defense').url).toBe(`${root}img/court.defense.webp`);
    expect(catalog.image('evidence.demo-capture').url).toBe(`${root}img/evidence.demo%20capture.webp`);
    expect(catalog.pose('ron-delite', 'normal')).toMatchObject({ url: `${root}sprites/ron-delite/normal.webp`, scale: 1 });
    expect(catalog.audio('sfx.gavel')).toBe(`${root}audio/sfx.gavel.wav`);
    expect(catalog.url('manifest.json')).toBe(`${root}manifest.json`);
  });

  it('keeps alias errors: unknown images and poses throw, unknown sounds are skipped', () => {
    const catalog = AssetCatalog.fromManifest(MANIFEST, { BASE_URL: '/' });
    expect(() => catalog.image('nope')).toThrow(/Unknown image alias/);
    expect(() => catalog.pose('ron-delite', 'nope')).toThrow(/Unknown pose/);
    expect(catalog.audio('nope')).toBeUndefined();
  });

  it('rejects a missing, outdated or malformed manifest', async () => {
    await expect(AssetCatalog.load({ env: { BASE_URL: '/' }, fetch: fakeFetch({}, 404) })).rejects.toThrow(/missing \(404\)/);
    await expect(AssetCatalog.load({ env: { BASE_URL: '/' }, fetch: fakeFetch({ version: 1, images: {}, sprites: {}, audio: {} }) })).rejects.toThrow(/older pipeline/);
    await expect(AssetCatalog.load({ env: { BASE_URL: '/' }, fetch: fakeFetch({ ...MANIFEST, release: 'latest' }) })).rejects.toThrow(/unexpected format/);
  });

  it('rejects an invalid asset base URL', async () => {
    await expect(AssetCatalog.load({ env: { BASE_URL: '/', VITE_ASSET_BASE_URL: 'pub-x.r2.dev' }, fetch: fakeFetch(MANIFEST) })).rejects.toThrow(/VITE_ASSET_BASE_URL/);
  });
});

describe('probeAssetCors', () => {
  it('does nothing in local mode', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    expect(await probeAssetCors(AssetCatalog.fromManifest(MANIFEST, { BASE_URL: '/' }), fetchFn)).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports a CORS rejection of the asset origin', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const catalog = AssetCatalog.fromManifest(MANIFEST, { BASE_URL: '/', VITE_ASSET_BASE_URL: R2 });
    const ok = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 200 })));
    expect(await probeAssetCors(catalog, ok)).toBe(true);
    expect(ok).toHaveBeenCalledWith(`${R2}releases/484a0b919698a519/manifest.json`, expect.objectContaining({ method: 'HEAD', mode: 'cors' }));
    expect(await probeAssetCors(catalog, () => Promise.reject(new TypeError('Failed to fetch')))).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('rejects CORS requests'));
    error.mockRestore();
  });
});
