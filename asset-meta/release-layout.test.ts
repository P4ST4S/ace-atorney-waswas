import { describe, expect, it } from 'vitest';
import {
  assetRoot, contentTypeFor, encodeAssetPath, localManifestUrl, parseAssetBaseUrl, releaseKey, resolveAssetUrl, validateAssetPath,
} from './release-layout.ts';

const R2 = 'https://pub-fcafc9a980984336ba95440ef648c8cb.r2.dev';
const RELEASE = '0123456789abcdef';

describe('parseAssetBaseUrl', () => {
  it('is local when unset or blank', () => {
    expect(parseAssetBaseUrl(undefined)).toEqual({ kind: 'local' });
    expect(parseAssetBaseUrl('')).toEqual({ kind: 'local' });
    expect(parseAssetBaseUrl('   ')).toEqual({ kind: 'local' });
  });

  it('keeps the bucket URL as is, with exactly one trailing slash and no bucket name appended', () => {
    expect(parseAssetBaseUrl(R2)).toEqual({ kind: 'remote', base: `${R2}/` });
    expect(parseAssetBaseUrl(`${R2}/`)).toEqual({ kind: 'remote', base: `${R2}/` });
    expect(parseAssetBaseUrl(` ${R2}// `)).toEqual({ kind: 'remote', base: `${R2}/` });
    expect(parseAssetBaseUrl('https://assets.example.test/cdn')).toEqual({ kind: 'remote', base: 'https://assets.example.test/cdn/' });
    expect(parseAssetBaseUrl('http://localhost:5299')).toEqual({ kind: 'remote', base: 'http://localhost:5299/' });
  });

  it('rejects relative URLs, other schemes, queries, fragments and credentials', () => {
    for (const value of ['/generated/', 'pub-x.r2.dev', 'ftp://host/', `${R2}/?v=1`, `${R2}/#x`, 'https://user:pass@host/', 'http://assets.example.test/']) {
      expect(() => parseAssetBaseUrl(value), value).toThrow(/VITE_ASSET_BASE_URL/);
    }
  });

  it('rejects the private S3 endpoint and a bucket name appended to the r2.dev URL', () => {
    expect(() => parseAssetBaseUrl('https://3ba4389dadfb525c4920fd6c0e13766f.r2.cloudflarestorage.com')).toThrow(/S3 API endpoint/);
    expect(() => parseAssetBaseUrl(`${R2}/ace-atorney-waswas`)).toThrow(/already bound to its bucket/);
  });
});

describe('asset paths', () => {
  it('rejects paths that could escape the release root or be ambiguous', () => {
    for (const path of ['', '/img/a.webp', 'img/a.webp/', 'img//a.webp', './a.webp', 'img/../a.webp', '..', 'img\\a.webp', 'a\u0000b']) {
      expect(() => validateAssetPath(path), JSON.stringify(path)).toThrow(/Invalid asset path/);
    }
  });

  it('percent-encodes each segment and keeps the separators', () => {
    expect(encodeAssetPath('img/court.defense.webp')).toBe('img/court.defense.webp');
    expect(encodeAssetPath('audio/sfx dog bark.wav')).toBe('audio/sfx%20dog%20bark.wav');
    expect(encodeAssetPath('img/a#b?c%d.webp')).toBe('img/a%23b%3Fc%25d.webp');
    expect(encodeAssetPath('img/prévenu.webp')).toBe('img/pr%C3%A9venu.webp');
  });
});

describe('URL resolution', () => {
  it('serves local assets from the app base, unversioned', () => {
    const root = assetRoot({ kind: 'local' }, '/', RELEASE);
    expect(resolveAssetUrl(root, 'sprites/ron-delite/normal.webp')).toBe('/generated/sprites/ron-delite/normal.webp');
    expect(resolveAssetUrl(assetRoot({ kind: 'local' }, '/sub/', RELEASE), 'img/a.webp')).toBe('/sub/generated/img/a.webp');
    expect(localManifestUrl('/')).toBe('/generated/manifest.json');
  });

  it('serves remote assets from the release prefix of the bucket URL', () => {
    const root = assetRoot(parseAssetBaseUrl(R2), '/', RELEASE);
    expect(resolveAssetUrl(root, 'sprites/ron-delite/normal.webp')).toBe(`${R2}/releases/${RELEASE}/sprites/ron-delite/normal.webp`);
    expect(() => assetRoot(parseAssetBaseUrl(R2), '/', 'latest')).toThrow(/release/);
  });

  it('maps every URL back to the exact R2 key that the upload writes', () => {
    const root = assetRoot(parseAssetBaseUrl(`${R2}/`), '/', RELEASE);
    for (const path of ['img/court.defense.webp', 'audio/sfx dog bark.wav', 'img/a#b?c%d.webp', 'img/prévenu.webp', "img/it's (1).webp"]) {
      const url = new URL(resolveAssetUrl(root, path));
      expect(url.origin).toBe(R2);
      expect(url.search + url.hash).toBe('');
      expect(decodeURIComponent(url.pathname.slice(1))).toBe(releaseKey(RELEASE, path));
    }
  });
});

describe('contentTypeFor', () => {
  it('knows every runtime format and refuses to guess', () => {
    expect(contentTypeFor('img/a.webp')).toBe('image/webp');
    expect(contentTypeFor('audio/a.WAV')).toBe('audio/wav');
    expect(contentTypeFor('audio/a.mp3')).toBe('audio/mpeg');
    expect(contentTypeFor('manifest.json')).toBe('application/json');
    expect(() => contentTypeFor('img/a.bmp')).toThrow(/Content-Type/);
    expect(() => contentTypeFor('README')).toThrow(/Content-Type/);
  });
});
