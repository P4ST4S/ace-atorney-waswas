import type { AssetManifest, ManifestImage, ManifestPose } from '../../asset-meta/manifest-types.ts';

/** Resolves a manifest-relative URL ("generated/...") against the app base URL. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shallow structural check of the generated manifest (the pipeline is the only writer). */
function isAssetManifest(value: unknown): value is AssetManifest {
  return isRecord(value) && value.version === 1 && isRecord(value.images) && isRecord(value.sprites) && isRecord(value.audio);
}

export class AssetCatalog {
  private readonly manifest: AssetManifest;

  private constructor(manifest: AssetManifest) {
    this.manifest = manifest;
  }

  static async load(): Promise<AssetCatalog> {
    const response = await fetch(assetUrl('generated/manifest.json'));
    if (!response.ok) throw new Error(`Asset manifest missing (${response.status}). Run \`pnpm assets:build\`.`);
    const json: unknown = await response.json();
    if (!isAssetManifest(json)) throw new Error('Asset manifest has an unexpected format. Run `pnpm assets:build`.');
    return new AssetCatalog(json);
  }

  image(alias: string): ManifestImage {
    const image = this.manifest.images[alias];
    if (image === undefined) throw new Error(`Unknown image alias: ${alias}`);
    return image;
  }

  pose(rig: string, pose: string): ManifestPose {
    const found = this.manifest.sprites[rig]?.[pose];
    if (found === undefined) throw new Error(`Unknown pose: ${rig}/${pose}`);
    return found;
  }

  poses(rig: string): readonly string[] {
    return Object.keys(this.manifest.sprites[rig] ?? {});
  }

  audio(alias: string): string | undefined {
    const url = this.manifest.audio[alias];
    return url === undefined ? undefined : assetUrl(url);
  }
}

/**
 * Decoded-image cache with a least-recently-used bound.
 *
 * It only bounds what the application keeps referenced; the browser may keep its own decoded caches longer.
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
