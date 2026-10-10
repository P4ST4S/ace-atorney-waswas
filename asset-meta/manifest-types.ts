/**
 * Types shared by the asset pipeline (scripts/build-assets.ts) and the runtime (src/runtime/assets.ts).
 * Type-only module: safe to import from Node scripts and from the browser bundle.
 */

export interface Point { readonly x: number; readonly y: number }
export interface Size { readonly w: number; readonly h: number }
export interface Rect extends Point, Size {}

// ---------------------------------------------------------------------------
// Authoring formats (asset-meta/rigs/*.json), written by hand.
// ---------------------------------------------------------------------------

/** A piece cut from an atlas and drawn at `at` in pose space. */
export interface AuthoredPiece {
  readonly src: Rect;
  readonly at: Point;
  /** Keep only opaque pixels 8-connected to these seeds (relative to `src`); removes foreign atlas pieces. */
  readonly seeds?: readonly Point[];
  /** Rectangles (relative to `src`) cleared to transparent. */
  readonly exclude?: readonly Rect[];
}

/** "parts" rig: base pieces plus overlay pieces per animation frame (drawn over the base). */
export interface PartsPose {
  readonly size: Size;
  readonly anchor: Point;
  /** Display scale (some atlases, e.g. the judges, are stored at a lower resolution). Defaults to 1. */
  readonly scale?: number;
  readonly base: readonly AuthoredPiece[];
  readonly blink?: readonly (readonly AuthoredPiece[])[];
  readonly talk?: readonly (readonly AuthoredPiece[])[];
}

/** "frames" rig: complete frames detected by scripts/slice-frame-sheet.ts, referenced by id (e.g. "b1f2"). */
export interface FramesPose {
  readonly idle: string;
  readonly blink?: readonly string[];
  readonly talk?: readonly string[];
  /** Anchor x relative to the pose box; defaults to half the idle frame width. */
  readonly anchorX?: number;
}

export type AuthoredRig =
  | { readonly id: string; readonly sheet: string; readonly kind: 'parts'; readonly poses: Readonly<Record<string, PartsPose>> }
  | { readonly id: string; readonly sheet: string; readonly kind: 'frames'; readonly slices: string; readonly poses: Readonly<Record<string, FramesPose>> };

export interface SliceFile {
  readonly sheet: string;
  readonly width: number;
  readonly height: number;
  readonly bands: readonly { readonly index: number; readonly frames: readonly (Rect & { readonly id: string; readonly bottom: number })[] }[];
}

// ---------------------------------------------------------------------------
// Generated runtime manifest (public/generated/manifest.json).
// ---------------------------------------------------------------------------

/** A rectangle of the pose sheet drawn at a position in pose space. */
export interface SheetPiece {
  readonly s: readonly [x: number, y: number, w: number, h: number];
  readonly a: readonly [x: number, y: number];
}

/** Every animation frame is complete: it lists all the pieces to draw (base included). */
export type SpriteFrame = readonly SheetPiece[];

/** Pose geometry, shared by the manifest entry and its resolved runtime form. */
export interface PoseLayout {
  readonly sheet: Size;
  readonly size: Size;
  readonly anchor: Point;
  /** Display scale applied around the anchor. */
  readonly scale: number;
  readonly idle: SpriteFrame;
  readonly blink: readonly SpriteFrame[];
  readonly talk: readonly SpriteFrame[];
}

/**
 * Paths are relative to the generated root (`public/generated/` locally, `releases/<release>/` on R2),
 * e.g. "sprites/ron-delite/normal.webp". They are never URLs: the runtime resolves them (asset-meta/release-layout.ts).
 */
export interface ManifestPose extends PoseLayout {
  readonly path: string;
}

export interface ManifestImage {
  readonly path: string;
  readonly w: number;
  readonly h: number;
}

export interface AssetManifest {
  readonly version: 2;
  /** Content version of the generated files (see scripts/lib/release.ts); R2 objects live under `releases/<release>/`. */
  readonly release: string;
  readonly images: Readonly<Record<string, ManifestImage>>;
  readonly sprites: Readonly<Record<string, Readonly<Record<string, ManifestPose>>>>;
  /** Audio alias -> path. */
  readonly audio: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Release index (public/generated/release.json, uploaded last as `releases/<release>/release.json`).
// ---------------------------------------------------------------------------

export interface ReleaseFile {
  readonly path: string;
  readonly size: number;
  /** Hex SHA-256 of the file content: the explicit fingerprint (an ETag is not always an MD5). */
  readonly sha256: string;
  readonly contentType: string;
}

/** Every object of a release except the index itself. Its presence on R2 marks the release as complete. */
export interface ReleaseIndex {
  readonly schema: 1;
  readonly release: string;
  readonly files: readonly ReleaseFile[];
}
