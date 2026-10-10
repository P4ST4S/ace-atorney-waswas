/**
 * Vite plugin: decides which generated assets end up in `dist/` (see docs/DEPLOYMENT_R2.md).
 *
 * - Local mode (no VITE_ASSET_BASE_URL): dist/ is self-contained, with the manifest and exactly the files it
 *   references (no pipeline caches such as .cache.json or poses.json).
 * - Remote mode: dist/ only ships `generated/manifest.json`, which points to an R2 release. The build checks
 *   that this release is completely published (its release.json marker is uploaded last) unless
 *   ASSET_RELEASE_CHECK=skip. ASSET_RELEASE=<release> rebuilds the frontend against an older published release
 *   (rollback) by downloading that release's manifest.
 *
 * Vite's own copy of public/ is disabled; other public files (outside generated/) are still copied.
 * Guards: no `VITE_*` variable may look like a secret, and R2 credentials must not appear in dist/.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseEnv } from 'node:util';
import type { Plugin, ResolvedConfig } from 'vite';
import type { AssetManifest, ReleaseIndex } from '../asset-meta/manifest-types.ts';
import {
  LOCAL_ASSET_DIR, MANIFEST_FILE, RELEASE_INDEX_FILE, parseAssetBaseUrl, releaseKey, validateRelease, type AssetSource,
} from '../asset-meta/release-layout.ts';
import { manifestPaths, parseManifest, parseReleaseIndex, sha256Hex } from './lib/release.ts';

const GENERATED = LOCAL_ASSET_DIR.replace(/\/$/, '');

/** Generated files copied into dist/generated/ (paths relative to it). */
export function distAssetFiles(manifest: AssetManifest, source: AssetSource): string[] {
  if (source.kind === 'remote') return [MANIFEST_FILE];
  return [MANIFEST_FILE, ...manifestPaths(manifest)].sort();
}

/** `VITE_*` variables are inlined into the browser bundle: none of them may look like a credential. */
export function secretLikeEnvNames(names: Iterable<string>): string[] {
  return [...names].filter((name) => name.startsWith('VITE_') && /R2_|SECRET|ACCESS_KEY|TOKEN|PASSWORD|CREDENTIAL/i.test(name));
}

export type TextFetch = (url: string) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

async function fetchText(fetchFn: TextFetch, url: string, what: string): Promise<string> {
  let response: Awaited<ReturnType<TextFetch>>;
  try {
    response = await fetchFn(url);
  } catch (error) {
    throw new Error(`Cannot reach ${what} at ${url}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!response.ok) throw new Error(`${what} not found at ${url} (HTTP ${response.status}).`);
  return response.text();
}

function manifestDigest(index: ReleaseIndex): string | undefined {
  return index.files.find((f) => f.path === MANIFEST_FILE)?.sha256;
}

/**
 * Checks that `manifestText` is exactly the manifest of a completely published release: the release index
 * (uploaded last by `pnpm assets:upload`) exists and lists this manifest's SHA-256.
 */
export async function assertPublished(base: string, manifestText: string, fetchFn: TextFetch): Promise<ReleaseIndex> {
  const manifest = parseManifest(manifestText);
  const url = `${base}${releaseKey(manifest.release, RELEASE_INDEX_FILE)}`;
  const index = parseReleaseIndex(await fetchText(fetchFn, url, `Release ${manifest.release} index`));
  if (index.release !== manifest.release) throw new Error(`${url} describes release ${index.release}, expected ${manifest.release}.`);
  if (manifestDigest(index) !== sha256Hex(manifestText)) throw new Error(`The local manifest differs from the published manifest of release ${manifest.release}.`);
  return index;
}

/** Downloads the manifest of an already published release (rollback builds). */
export async function fetchPublishedManifest(base: string, release: string, fetchFn: TextFetch): Promise<string> {
  validateRelease(release);
  const manifestText = await fetchText(fetchFn, `${base}${releaseKey(release, MANIFEST_FILE)}`, `Release ${release} manifest`);
  if (parseManifest(manifestText).release !== release) throw new Error(`The manifest of release ${release} names another release.`);
  await assertPublished(base, manifestText, fetchFn);
  return manifestText;
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/** Credential values that must never end up in dist/ (from the environment and the local r2.env file). */
function secretValues(root: string): string[] {
  const values = [process.env.R2_ACCESS_KEY_ID, process.env.R2_SECRET_ACCESS_KEY];
  for (const name of ['r2.env', '.r2.env']) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    values.push(parsed.R2_ACCESS_KEY_ID, parsed.R2_SECRET_ACCESS_KEY);
  }
  return values.filter((v): v is string => v !== undefined && v.length >= 8);
}

/** Network checks of the build must not hang on an unreachable bucket. */
const timedFetch: TextFetch = (url) => fetch(url, { signal: AbortSignal.timeout(15_000) });

const TEXT_FILE = /\.(?:html|js|mjs|cjs|css|json|map|txt|svg|webmanifest)$/i;

export function wasWasAssets(): Plugin {
  let config: ResolvedConfig;
  let source: AssetSource = { kind: 'local' };
  let manifestText = '';
  let manifest: AssetManifest | null = null;
  // Set once the generated files are written: the final checks must not mask an earlier build error.
  let written = false;

  const generatedDir = (): string => join(config.publicDir, GENERATED);
  const outDir = (): string => resolve(config.root, config.build.outDir);

  return {
    name: 'waswas-assets',

    config() {
      return { build: { copyPublicDir: false } };
    },

    configResolved(resolved) {
      config = resolved;
      const leaked = secretLikeEnvNames(Object.keys(resolved.env));
      if (leaked.length > 0) {
        throw new Error(`These variables would be inlined into the browser bundle and look like secrets: ${leaked.join(', ')}. Only the public VITE_ASSET_BASE_URL belongs in VITE_* variables.`);
      }
      const raw: unknown = resolved.env.VITE_ASSET_BASE_URL;
      source = parseAssetBaseUrl(typeof raw === 'string' ? raw : undefined);
    },

    async buildStart() {
      if (config.command !== 'build') return;
      const pinned = process.env.ASSET_RELEASE?.trim() ?? '';
      if (pinned !== '') {
        if (source.kind !== 'remote') throw new Error('ASSET_RELEASE needs remote assets: use `pnpm build:remote`.');
        manifestText = await fetchPublishedManifest(source.base, pinned, timedFetch);
        manifest = parseManifest(manifestText);
        config.logger.info(`[waswas-assets] rollback build on published release ${pinned}`);
        return;
      }
      const path = join(generatedDir(), MANIFEST_FILE);
      if (!existsSync(path)) throw new Error(`${path} is missing. Run \`pnpm assets:build\` first.`);
      manifestText = readFileSync(path, 'utf8');
      manifest = parseManifest(manifestText);
      if (source.kind === 'local') {
        config.logger.info(`[waswas-assets] local assets, release ${manifest.release} copied into dist/`);
        return;
      }
      if (process.env.ASSET_RELEASE_CHECK === 'skip') {
        config.logger.warn(`[waswas-assets] ASSET_RELEASE_CHECK=skip: release ${manifest.release} is NOT checked on ${source.base}`);
        return;
      }
      try {
        await assertPublished(source.base, manifestText, timedFetch);
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nPublish the release first (\`pnpm assets:upload\`), or set ASSET_RELEASE_CHECK=skip for an offline build.`, { cause: error });
      }
      config.logger.info(`[waswas-assets] remote assets: ${source.base}releases/${manifest.release}/ (published; only the manifest is copied into dist/)`);
    },

    writeBundle() {
      if (manifest === null) return;
      const out = outDir();
      if (existsSync(config.publicDir)) {
        cpSync(config.publicDir, out, {
          recursive: true,
          filter: (src) => relative(config.publicDir, src).split(sep)[0] !== GENERATED,
        });
      }
      const target = join(out, GENERATED);
      for (const file of distAssetFiles(manifest, source)) {
        const destination = join(target, ...file.split('/'));
        mkdirSync(dirname(destination), { recursive: true });
        if (file === MANIFEST_FILE) writeFileSync(destination, manifestText);
        else copyFileSync(join(generatedDir(), ...file.split('/')), destination);
      }
      written = true;
    },

    closeBundle() {
      if (manifest === null || !written) return;
      const out = outDir();
      const expected = distAssetFiles(manifest, source);
      const actual = listFiles(join(out, GENERATED));
      if (actual.join('\n') !== expected.join('\n')) {
        const extra = actual.filter((f) => !expected.includes(f));
        const missing = expected.filter((f) => !actual.includes(f));
        throw new Error(`dist/${GENERATED}/ does not match the ${source.kind} asset plan (extra: ${extra.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}).`);
      }
      const secrets = secretValues(config.root);
      if (secrets.length > 0) {
        const leaking = listFiles(out).filter((file) => TEXT_FILE.test(file) && secrets.some((s) => readFileSync(join(out, file), 'utf8').includes(s)));
        if (leaking.length > 0) throw new Error(`R2 credentials found in the build output: ${leaking.join(', ')}. Never expose them to the browser.`);
      }
    },
  };
}
