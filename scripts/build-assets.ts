/**
 * Asset pipeline: turns the raw assets referenced by asset-meta/ into web-ready files + a manifest.
 *
 *   assets/ (raw, untracked) + asset-meta/ (tracked) -> public/generated/ (untracked)
 *
 * - Images: WebP at original size.
 * - Character rigs: one small WebP sheet per pose; animation frames are stored as "diff patches"
 *   over the idle frame when that is lossless to composite, otherwise as full frames.
 * - Audio: copied as-is.
 * - Incremental: outputs are skipped when their inputs (file size/mtime, parameters) are unchanged.
 *
 * Usage: node --experimental-strip-types scripts/build-assets.ts [--force]
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { audio, authoredImages, images, portraits, rigs } from '../asset-meta/assets.ts';
import type {
  AssetManifest, AuthoredPiece, AuthoredRig, ManifestImage, ManifestPose, Point, Rect, SheetPiece, SliceFile, SpriteFrame,
} from '../asset-meta/manifest-types.ts';

const PIPELINE_VERSION = 5;
const ROOT = join(import.meta.dirname, '..');
const ASSETS = join(ROOT, 'assets');
const META = join(ROOT, 'asset-meta');
const OUT = join(ROOT, 'public', 'generated');
const CACHE_FILE = join(OUT, '.cache.json');
const MAX_SHEET_WIDTH = 4096;
const PORTRAIT_SIZE = 256;
const FORCE = process.argv.includes('--force');

// ---------------------------------------------------------------------------
// Validation of hand-written metadata
// ---------------------------------------------------------------------------

const point = z.object({ x: z.number().int(), y: z.number().int() });
const rect = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), w: z.number().int().positive(), h: z.number().int().positive() });
const piece = z.object({ src: rect, at: point, seeds: z.array(point).optional(), exclude: z.array(rect).optional() });
const rigSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(), sheet: z.string(), kind: z.literal('parts'),
    poses: z.record(z.string(), z.object({
      size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
      anchor: point,
      scale: z.number().positive().optional(),
      base: z.array(piece).min(1),
      blink: z.array(z.array(piece)).optional(),
      talk: z.array(z.array(piece)).optional(),
    })),
  }),
  z.object({
    id: z.string(), sheet: z.string(), kind: z.literal('frames'), slices: z.string(),
    poses: z.record(z.string(), z.object({
      idle: z.string(), blink: z.array(z.string()).optional(), talk: z.array(z.string()).optional(), anchorX: z.number().optional(),
    })),
  }),
]);
const sliceSchema = z.object({
  sheet: z.string(), width: z.number(), height: z.number(),
  bands: z.array(z.object({ index: z.number(), frames: z.array(rect.extend({ id: z.string(), bottom: z.number() })) })),
});
const cacheSchema = z.record(z.string(), z.string());
const sizeSchema = z.object({ w: z.number(), h: z.number() });
const sheetPieceSchema = z.object({ s: z.tuple([z.number(), z.number(), z.number(), z.number()]), a: z.tuple([z.number(), z.number()]) });
const frameSchema = z.array(sheetPieceSchema);
const posesSchema = z.record(z.string(), z.object({
  url: z.string(), sheet: sizeSchema, size: sizeSchema, anchor: point, scale: z.number(),
  idle: frameSchema, blink: z.array(frameSchema), talk: z.array(frameSchema),
}));

function readJson<T>(path: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

// ---------------------------------------------------------------------------
// Incremental cache
// ---------------------------------------------------------------------------

const cache: Record<string, string> = existsSync(CACHE_FILE) ? readJson(CACHE_FILE, cacheSchema) : {};

function fingerprint(files: readonly string[], params: unknown): string {
  const hash = createHash('sha1').update(String(PIPELINE_VERSION)).update(JSON.stringify(params));
  for (const file of files) {
    const stat = statSync(file);
    hash.update(`${file}:${stat.size}:${stat.mtimeMs}`);
  }
  return hash.digest('hex');
}

function upToDate(output: string, key: string): boolean {
  return !FORCE && cache[output] === key && existsSync(join(OUT, output));
}

// ---------------------------------------------------------------------------
// Raw RGBA helpers
// ---------------------------------------------------------------------------

interface Raster { readonly w: number; readonly h: number; readonly data: Buffer }

function blank(w: number, h: number): Raster {
  return { w, h, data: Buffer.alloc(w * h * 4) };
}

function crop(src: Raster, r: Rect): Raster {
  if (r.x + r.w > src.w || r.y + r.h > src.h) throw new Error(`Crop ${JSON.stringify(r)} outside ${src.w}x${src.h}`);
  const out = blank(r.w, r.h);
  for (let y = 0; y < r.h; y += 1) {
    src.data.copy(out.data, y * r.w * 4, ((r.y + y) * src.w + r.x) * 4, ((r.y + y) * src.w + r.x + r.w) * 4);
  }
  return out;
}

/** Copies `src` into `dst` at (dx, dy), overwriting (no blending). */
function blit(dst: Raster, src: Raster, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y += 1) {
    src.data.copy(dst.data, ((dy + y) * dst.w + dx) * 4, y * src.w * 4, (y + 1) * src.w * 4);
  }
}

/** Keeps only opaque pixels 8-connected to the seeds; everything else becomes fully transparent. */
function keepConnected(r: Raster, seeds: readonly Point[]): void {
  const keep = new Uint8Array(r.w * r.h);
  const queue = new Int32Array(r.w * r.h);
  let head = 0;
  let tail = 0;
  for (const seed of seeds) {
    const i = seed.y * r.w + seed.x;
    if ((r.data[i * 4 + 3] ?? 0) === 0) throw new Error(`Seed ${JSON.stringify(seed)} is on a transparent pixel`);
    keep[i] = 1;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++] ?? 0;
    const x = i % r.w;
    const y = (i - x) / r.w;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue;
        const n = ny * r.w + nx;
        if (keep[n] === 0 && (r.data[n * 4 + 3] ?? 0) > 0) {
          keep[n] = 1;
          queue[tail++] = n;
        }
      }
    }
  }
  for (let i = 0; i < keep.length; i += 1) {
    if (keep[i] === 0) r.data.fill(0, i * 4, i * 4 + 4);
  }
}

function clearRect(r: Raster, area: Rect): void {
  for (let y = area.y; y < Math.min(r.h, area.y + area.h); y += 1) {
    r.data.fill(0, (y * r.w + area.x) * 4, (y * r.w + Math.min(r.w, area.x + area.w)) * 4);
  }
}

async function loadRaster(path: string): Promise<Raster> {
  const { data, info } = await sharp(path, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data };
}

// ---------------------------------------------------------------------------
// Sprite pose building
// ---------------------------------------------------------------------------

interface PosePiece { readonly image: Raster; readonly at: Point }

const DIFF_TOLERANCE = 8;

function pixelDiffers(a: Buffer, b: Buffer, i: number): boolean {
  for (let c = 0; c < 4; c += 1) {
    if (Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0)) > DIFF_TOLERANCE) return true;
  }
  return false;
}

/**
 * Expresses `frame` as a patch over `base` (both full pose canvases). Returns null when compositing the patch
 * over the base would not reproduce the frame (the frame would need to erase or blend over base pixels).
 */
function diffPatch(base: Raster, frame: Raster): PosePiece | 'identical' | null {
  let x0 = base.w;
  let y0 = base.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < base.h; y += 1) {
    for (let x = 0; x < base.w; x += 1) {
      const i = (y * base.w + x) * 4;
      if (!pixelDiffers(base.data, frame.data, i)) continue;
      const frameAlpha = frame.data[i + 3] ?? 0;
      const baseAlpha = base.data[i + 3] ?? 0;
      if (frameAlpha < 255 && baseAlpha > 0) return null;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return 'identical';
  const area = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  const patch = crop(frame, area);
  const under = crop(base, area);
  // Pixels equal to the base are made transparent so semi-transparent edges are not composited twice.
  for (let i = 0; i < patch.data.length; i += 4) {
    if (!pixelDiffers(patch.data, under.data, i)) patch.data.fill(0, i, i + 4);
  }
  return { image: patch, at: { x: area.x, y: area.y } };
}

/** Alignment problems found while building frame rigs; the build fails if any are found. */
const alignmentErrors: string[] = [];

/** Max share of differing pixels tolerated in the lower body (which never animates) of a full-frame fallback. */
const MAX_BOTTOM_DRIFT = 0.02;

/** Anti-jitter check: share of opaque pixels differing between two frames in the bottom 20% of the pose box. */
function bottomDrift(base: Raster, frame: Raster): number {
  let differing = 0;
  let opaque = 0;
  for (let y = Math.floor(base.h * 0.8); y < base.h; y += 1) {
    for (let x = 0; x < base.w; x += 1) {
      const i = (y * base.w + x) * 4;
      if ((base.data[i + 3] ?? 0) === 0 && (frame.data[i + 3] ?? 0) === 0) continue;
      opaque += 1;
      if (pixelDiffers(base.data, frame.data, i)) differing += 1;
    }
  }
  return opaque === 0 ? 0 : differing / opaque;
}

function authoredPieceRaster(sheet: Raster, p: AuthoredPiece): Raster {
  const image = crop(sheet, p.src);
  if (p.seeds !== undefined) keepConnected(image, p.seeds);
  for (const area of p.exclude ?? []) clearRect(image, area);
  return image;
}

interface BuiltPose {
  readonly size: { w: number; h: number };
  readonly anchor: Point;
  readonly scale: number;
  readonly pieces: readonly PosePiece[];
  readonly idle: readonly number[];
  readonly blink: readonly (readonly number[])[];
  readonly talk: readonly (readonly number[])[];
}

function buildFramesPose(sheet: Raster, slices: SliceFile, pose: { idle: string; blink?: readonly string[]; talk?: readonly string[]; anchorX?: number }): BuiltPose {
  const frameRects = new Map(slices.bands.flatMap((band) => band.frames.map((f) => [f.id, f] as const)));
  const get = (id: string): Rect => {
    const f = frameRects.get(id);
    if (f === undefined) throw new Error(`Unknown frame ${id}`);
    return f;
  };
  const ids = [pose.idle, ...(pose.blink ?? []), ...(pose.talk ?? [])];
  const w = Math.max(...ids.map((id) => get(id).w));
  const h = Math.max(...ids.map((id) => get(id).h));
  // Frames share their left edge (grid pitch) and their bottom line: align left/bottom in the pose box.
  const canvasOf = (id: string): Raster => {
    const r = get(id);
    const canvas = blank(w, h);
    blit(canvas, crop(sheet, r), 0, h - r.h);
    return canvas;
  };
  const idleRect = get(pose.idle);
  const baseCanvas = canvasOf(pose.idle);
  const pieces: PosePiece[] = [{ image: crop(sheet, idleRect), at: { x: 0, y: h - idleRect.h } }];
  const memo = new Map<string, number[]>([[pose.idle, [0]]]);
  const frameOf = (id: string): number[] => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const frameCanvas = canvasOf(id);
    const patch = diffPatch(baseCanvas, frameCanvas);
    let frame: number[];
    if (patch === 'identical') {
      frame = [0];
    } else if (patch === null) {
      const r = get(id);
      const drift = bottomDrift(baseCanvas, frameCanvas);
      if (drift > MAX_BOTTOM_DRIFT) alignmentErrors.push(`${id}: ${(drift * 100).toFixed(1)}% of the lower body differs from ${pose.idle} (misaligned frame?)`);
      pieces.push({ image: crop(sheet, r), at: { x: 0, y: h - r.h } });
      frame = [pieces.length - 1];
    } else {
      pieces.push(patch);
      frame = [0, pieces.length - 1];
    }
    memo.set(id, frame);
    return frame;
  };
  return {
    size: { w, h },
    anchor: { x: pose.anchorX ?? Math.round(idleRect.w / 2), y: h },
    scale: 1,
    pieces,
    idle: [0],
    blink: (pose.blink ?? []).map(frameOf),
    talk: (pose.talk ?? []).map(frameOf),
  };
}

function buildPartsPose(sheet: Raster, pose: { size: { w: number; h: number }; anchor: Point; scale?: number; base: readonly AuthoredPiece[]; blink?: readonly (readonly AuthoredPiece[])[]; talk?: readonly (readonly AuthoredPiece[])[] }): BuiltPose {
  const pieces: PosePiece[] = pose.base.map((p) => ({ image: authoredPieceRaster(sheet, p), at: p.at }));
  const baseIndices = pieces.map((_, i) => i);
  const frameOf = (overlay: readonly AuthoredPiece[]): number[] => [
    ...baseIndices,
    ...overlay.map((p) => {
      pieces.push({ image: authoredPieceRaster(sheet, p), at: p.at });
      return pieces.length - 1;
    }),
  ];
  return {
    size: pose.size, anchor: pose.anchor, scale: pose.scale ?? 1, pieces, idle: baseIndices,
    blink: (pose.blink ?? []).map(frameOf), talk: (pose.talk ?? []).map(frameOf),
  };
}

/** Shelf packing of pose pieces into one sheet. Returns the sheet and each piece's rectangle in it. */
function pack(pieces: readonly PosePiece[]): { sheet: Raster; rects: Rect[] } {
  const order = pieces.map((p, i) => ({ i, w: p.image.w, h: p.image.h })).sort((a, b) => b.h - a.h);
  const rects: Rect[] = new Array<Rect>(pieces.length);
  let x = 0;
  let y = 0;
  let shelfH = 0;
  let width = 0;
  for (const item of order) {
    if (x > 0 && x + item.w > MAX_SHEET_WIDTH) { y += shelfH + 2; x = 0; shelfH = 0; }
    rects[item.i] = { x, y, w: item.w, h: item.h };
    x += item.w + 2;
    shelfH = Math.max(shelfH, item.h);
    width = Math.max(width, x - 2);
  }
  const sheet = blank(width, y + shelfH);
  pieces.forEach((p, i) => {
    const r = rects[i];
    if (r !== undefined) blit(sheet, p.image, r.x, r.y);
  });
  return { sheet, rects };
}

async function writeWebp(raster: Raster, output: string, quality: number): Promise<void> {
  const path = join(OUT, output);
  mkdirSync(dirname(path), { recursive: true });
  await sharp(raster.data, { raw: { width: raster.w, height: raster.h, channels: 4 } })
    .webp({ quality, alphaQuality: 100, effort: 4 })
    .toFile(path);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const manifestImages: Record<string, ManifestImage> = {};
const manifestSprites: Record<string, Record<string, ManifestPose>> = {};
const manifestAudio: Record<string, string> = {};
let built = 0;
let skipped = 0;

mkdirSync(OUT, { recursive: true });

const imageSources = [
  ...Object.entries(images).map(([alias, rel]) => [alias, join(ASSETS, rel)] as const),
  ...Object.entries(authoredImages).map(([alias, rel]) => [alias, join(ROOT, rel)] as const),
];
for (const [alias, src] of imageSources) {
  const output = `img/${alias}.webp`;
  const path = join(OUT, output);
  const key = fingerprint([src], { quality: 88 });
  if (upToDate(output, key)) {
    const meta = await sharp(path).metadata();
    manifestImages[alias] = { url: `generated/${output}`, w: meta.width, h: meta.height };
    skipped += 1;
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  const info = await sharp(src).webp({ quality: 88, alphaQuality: 100, effort: 4 }).toFile(path);
  manifestImages[alias] = { url: `generated/${output}`, w: info.width, h: info.height };
  cache[output] = key;
  built += 1;
}

function buildRigPoses(rig: AuthoredRig, sheet: Raster): [string, BuiltPose][] {
  if (rig.kind === 'frames') {
    const slices = readJson(join(META, 'rigs', rig.slices), sliceSchema);
    return Object.entries(rig.poses).map(([poseId, pose]) => [poseId, buildFramesPose(sheet, slices, pose)]);
  }
  return Object.entries(rig.poses).map(([poseId, pose]) => [poseId, buildPartsPose(sheet, pose)]);
}

for (const rigId of rigs) {
  const rigPath = join(META, 'rigs', `${rigId}.json`);
  const rig: AuthoredRig = readJson(rigPath, rigSchema);
  const sheetPath = join(ASSETS, rig.sheet);
  const inputs = rig.kind === 'frames' ? [rigPath, sheetPath, join(META, 'rigs', rig.slices)] : [rigPath, sheetPath];
  const key = fingerprint(inputs, {});
  const output = `sprites/${rig.id}/poses.json`;
  if (upToDate(output, key)) {
    manifestSprites[rig.id] = readJson(join(OUT, output), posesSchema);
    skipped += 1;
    continue;
  }
  const sheet = await loadRaster(sheetPath);
  const poses: Record<string, ManifestPose> = {};
  for (const [poseId, builtPose] of buildRigPoses(rig, sheet)) {
    const { sheet: poseSheet, rects } = pack(builtPose.pieces);
    const toFrame = (indices: readonly number[]): SpriteFrame => indices.map((i): SheetPiece => {
      const r = rects[i];
      const p = builtPose.pieces[i];
      if (r === undefined || p === undefined) throw new Error(`Missing piece ${i}`);
      return { s: [r.x, r.y, r.w, r.h], a: [p.at.x, p.at.y] };
    });
    const file = `sprites/${rig.id}/${poseId}.webp`;
    await writeWebp(poseSheet, file, 92);
    poses[poseId] = {
      url: `generated/${file}`,
      sheet: { w: poseSheet.w, h: poseSheet.h },
      size: builtPose.size,
      anchor: builtPose.anchor,
      scale: builtPose.scale,
      idle: toFrame(builtPose.idle),
      blink: builtPose.blink.map(toFrame),
      talk: builtPose.talk.map(toFrame),
    };
    console.log(`  ${rig.id}/${poseId}: sheet ${poseSheet.w}x${poseSheet.h}, ${builtPose.pieces.length} pieces`);
  }
  manifestSprites[rig.id] = poses;
  writeFileSync(join(OUT, output), JSON.stringify(poses));
  cache[output] = key;
  built += 1;
}

// Court Record portraits: composed from the generated pose sheet's idle frame, then cropped.
for (const [alias, spec] of Object.entries(portraits)) {
  const pose = manifestSprites[spec.rig]?.[spec.pose];
  if (pose === undefined) throw new Error(`Portrait ${alias}: unknown pose ${spec.rig}/${spec.pose}`);
  const sheetFile = join(OUT, pose.url.replace(/^generated\//, ''));
  const output = `img/${alias}.webp`;
  const key = fingerprint([sheetFile], { rect: spec.rect, idle: pose.idle });
  if (upToDate(output, key)) {
    manifestImages[alias] = { url: `generated/${output}`, w: PORTRAIT_SIZE, h: PORTRAIT_SIZE };
    skipped += 1;
    continue;
  }
  const sheet = await loadRaster(sheetFile);
  const frame = blank(pose.size.w, pose.size.h);
  for (const piece of pose.idle) {
    const [sx, sy, w, h] = piece.s;
    const [ax, ay] = piece.a;
    blit(frame, crop(sheet, { x: sx, y: sy, w, h }), ax, ay);
  }
  const face = crop(frame, spec.rect);
  const path = join(OUT, output);
  mkdirSync(dirname(path), { recursive: true });
  await sharp(face.data, { raw: { width: face.w, height: face.h, channels: 4 } })
    .resize(PORTRAIT_SIZE, PORTRAIT_SIZE)
    .webp({ quality: 90, alphaQuality: 100 })
    .toFile(path);
  manifestImages[alias] = { url: `generated/${output}`, w: PORTRAIT_SIZE, h: PORTRAIT_SIZE };
  cache[output] = key;
  built += 1;
}

for (const [alias, rel] of Object.entries(audio)) {
  const src = join(ASSETS, rel);
  const output = `audio/${alias}${extname(rel)}`;
  const key = fingerprint([src], {});
  manifestAudio[alias] = `generated/${output}`;
  if (upToDate(output, key)) { skipped += 1; continue; }
  mkdirSync(dirname(join(OUT, output)), { recursive: true });
  copyFileSync(src, join(OUT, output));
  cache[output] = key;
  built += 1;
}

const manifest: AssetManifest = { version: 1, images: manifestImages, sprites: manifestSprites, audio: manifestAudio };
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
console.log(`Assets: ${built} built, ${skipped} up to date -> public/generated/manifest.json`);
if (alignmentErrors.length > 0) {
  console.error('Frame alignment check failed:');
  for (const error of alignmentErrors) console.error(`  ${error}`);
  process.exitCode = 1;
}
