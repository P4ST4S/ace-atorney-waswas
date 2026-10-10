import type { AssetManifest, PoseLayout } from '../../asset-meta/manifest-types.ts';
import {
  MANIFEST_FILE, RELEASE_PATTERN, assetRoot, localManifestUrl, parseAssetBaseUrl, resolveAssetUrl, type AssetSource,
} from '../../asset-meta/release-layout.ts';

/** An image of the manifest with its resolved URL. */
export interface ImageAsset {
  readonly url: string;
  readonly w: number;
  readonly h: number;
}

/** A sprite pose with the resolved URL of its sheet. */
export interface PoseAsset extends PoseLayout {
  readonly url: string;
}

/** The public build settings the catalog depends on (a subset of `import.meta.env`). */
export interface AssetEnv {
  readonly BASE_URL: string;
  readonly VITE_ASSET_BASE_URL?: string | undefined;
}

export interface CatalogLoadOptions {
  readonly env?: AssetEnv;
  readonly fetch?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shallow structural check of the generated manifest (the pipeline is the only writer). */
function isAssetManifest(value: unknown): value is AssetManifest {
  return isRecord(value) && value.version === 2 && typeof value.release === 'string' && RELEASE_PATTERN.test(value.release)
    && isRecord(value.images) && isRecord(value.sprites) && isRecord(value.audio);
}

function mapValues<T, U>(record: Readonly<Record<string, T>>, map: (value: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value)]));
}

/**
 * The asset manifest with every path resolved once into a URL: the only place that knows where assets are
 * hosted (locally under `generated/`, or on R2 under `releases/<release>/`; see docs/DEPLOYMENT_R2.md).
 * The engine and the content only deal with aliases.
 */
export class AssetCatalog {
  readonly release: string;
  readonly source: AssetSource;
  private readonly root: string;
  private readonly images: Readonly<Record<string, ImageAsset>>;
  private readonly sprites: Readonly<Record<string, Readonly<Record<string, PoseAsset>>>>;
  private readonly sounds: Readonly<Record<string, string>>;

  private constructor(manifest: AssetManifest, source: AssetSource, appBase: string) {
    this.release = manifest.release;
    this.source = source;
    this.root = assetRoot(source, appBase, manifest.release);
    this.images = mapValues(manifest.images, ({ path, w, h }) => ({ url: this.url(path), w, h }));
    this.sprites = mapValues(manifest.sprites, (poses) => mapValues(poses, ({ path, ...layout }) => ({ ...layout, url: this.url(path) })));
    this.sounds = mapValues(manifest.audio, (path) => this.url(path));
  }

  /** Builds a catalog from an already loaded manifest (tests, tools). */
  static fromManifest(manifest: AssetManifest, env: AssetEnv): AssetCatalog {
    return new AssetCatalog(manifest, parseAssetBaseUrl(env.VITE_ASSET_BASE_URL), env.BASE_URL);
  }

  /** Loads the manifest, which the frontend always serves itself (it points to the release to use). */
  static async load(options: CatalogLoadOptions = {}): Promise<AssetCatalog> {
    const env = options.env ?? import.meta.env;
    const source = parseAssetBaseUrl(env.VITE_ASSET_BASE_URL);
    const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    // Revalidated on every load: a new deploy points to a new release at once (old releases stay available).
    const response = await fetchFn(localManifestUrl(env.BASE_URL), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Asset manifest missing (${response.status}). Run \`pnpm assets:build\`.`);
    const json: unknown = await response.json();
    if (isRecord(json) && json.version === 1) throw new Error('Asset manifest is from an older pipeline. Run `pnpm assets:build`.');
    if (!isAssetManifest(json)) throw new Error('Asset manifest has an unexpected format. Run `pnpm assets:build`.');
    return new AssetCatalog(json, source, env.BASE_URL);
  }

  /** URL of a file of the current release, from its manifest path. */
  url(path: string): string {
    return resolveAssetUrl(this.root, path);
  }

  image(alias: string): ImageAsset {
    const image = this.images[alias];
    if (image === undefined) throw new Error(`Unknown image alias: ${alias}`);
    return image;
  }

  pose(rig: string, pose: string): PoseAsset {
    const found = this.sprites[rig]?.[pose];
    if (found === undefined) throw new Error(`Unknown pose: ${rig}/${pose}`);
    return found;
  }

  poses(rig: string): readonly string[] {
    return Object.keys(this.sprites[rig] ?? {});
  }

  audio(alias: string): string | undefined {
    return this.sounds[alias];
  }
}

/**
 * Remote mode only: checks that the asset origin answers CORS requests from this page. Images do not need CORS,
 * but sound effects, voices and blips are fetched by Howler (XHR for Web Audio), which silently falls back to
 * HTML5 audio when CORS fails: this probe makes that misconfiguration visible. Resolves to false on failure.
 */
export async function probeAssetCors(catalog: AssetCatalog, fetchFn: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<boolean> {
  if (catalog.source.kind === 'local') return true;
  const url = catalog.url(MANIFEST_FILE);
  try {
    const response = await fetchFn(url, { method: 'HEAD', mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!response.ok) console.warn(`[assets] release ${catalog.release} looks unpublished: HEAD ${url} -> ${response.status}`);
    return true;
  } catch {
    console.error(
      `[assets] ${new URL(url).origin} rejects CORS requests from this page: sound effects will fall back to HTML5 audio `
      + 'and may fail. Add this origin to the bucket CORS policy (docs/DEPLOYMENT_R2.md).',
    );
    return false;
  }
}

/**
 * Decoded-image cache with a least-recently-used bound.
 *
 * It only bounds what the application keeps referenced; the browser may keep its own decoded caches longer.
 * Images are loaded without `crossOrigin` (nothing reads their pixels), like the `<img>` tags and CSS
 * backgrounds that display them, so they share the browser's HTTP cache and need no CORS.
 */
export class ImageCache {
  private readonly entries = new Map<string, { promise: Promise<HTMLImageElement>; lastUsed: number }>();
  private readonly capacity: number;
  private clock = 0;

  constructor(capacity = 48) {
    this.capacity = capacity;
  }

  /** Loads and decodes an image; resolves only once it can be painted without flicker. */
  load(url: string): Promise<HTMLImageElement> {
    this.clock += 1;
    const existing = this.entries.get(url);
    if (existing !== undefined) {
      existing.lastUsed = this.clock;
      return existing.promise;
    }
    const image = new Image();
    image.src = url;
    const promise = image.decode().then(() => image);
    promise.catch(() => this.entries.delete(url));
    this.entries.set(url, { promise, lastUsed: this.clock });
    this.evict();
    return promise;
  }

  private evict(): void {
    if (this.entries.size <= this.capacity) return;
    const oldest = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [url] of oldest.slice(0, this.entries.size - this.capacity)) this.entries.delete(url);
  }
}
