/**
 * Detects frames in a "compiled" sprite sheet (complete frames laid out in horizontal bands,
 * separated by fully transparent rows/columns) and writes a draft listing for manual labelling.
 *
 * Usage:
 *   node --experimental-strip-types scripts/slice-frame-sheet.ts <sheet.png> <out.json> [--min-gap=40] [--exclude=x,y,w,h]
 *
 * The output is a *draft*: poses (which frame is idle, which are blink/talk) are labelled by hand
 * in asset-meta/rigs/<sprite>.json.
 */
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

interface Rect { x: number; y: number; w: number; h: number }
interface Band { index: number; y: number; h: number; frames: (Rect & { id: string; bottom: number })[] }

function parseArgs(argv: readonly string[]): { sheet: string; out: string; minGap: number; exclude: Rect[] } {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const sheet = positional[0];
  const out = positional[1];
  if (sheet === undefined || out === undefined) throw new Error('Usage: slice-frame-sheet.ts <sheet.png> <out.json> [--min-gap=40] [--exclude=x,y,w,h]');
  let minGap = 40;
  const exclude: Rect[] = [];
  for (const arg of argv) {
    if (arg.startsWith('--min-gap=')) minGap = Number(arg.slice('--min-gap='.length));
    if (arg.startsWith('--exclude=')) {
      const [x, y, w, h] = arg.slice('--exclude='.length).split(',').map(Number);
      if (x === undefined || y === undefined || w === undefined || h === undefined) throw new Error(`Bad --exclude: ${arg}`);
      exclude.push({ x, y, w, h });
    }
  }
  return { sheet, out, minGap, exclude };
}

/** Splits a boolean profile into [start, end) runs of `true`, merging runs separated by gaps smaller than `minGap`. */
function runs(profile: Uint8Array, minGap: number): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < profile.length) {
    if (profile[i] === 1) {
      const start = i;
      while (i < profile.length && profile[i] === 1) i += 1;
      const last = out[out.length - 1];
      if (last !== undefined && start - last[1] < minGap) last[1] = i;
      else out.push([start, i]);
    } else {
      i += 1;
    }
  }
  return out;
}

const { sheet, out, minGap, exclude } = parseArgs(process.argv.slice(2));
const { data, info } = await sharp(sheet).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;

const opaque = (x: number, y: number): boolean =>
  (data[y * width + x] ?? 0) > 0 && !exclude.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

const rowProfile = new Uint8Array(height);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    if (opaque(x, y)) { rowProfile[y] = 1; break; }
  }
}

const bands: Band[] = [];
for (const [y0, y1] of runs(rowProfile, 1)) {
  const colProfile = new Uint8Array(width);
  for (let x = 0; x < width; x += 1) {
    for (let y = y0; y < y1; y += 1) {
      if (opaque(x, y)) { colProfile[x] = 1; break; }
    }
  }
  const index = bands.length + 1;
  const frames = runs(colProfile, minGap).map(([x0, x1], i) => {
    let top = y1;
    let bottom = y0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (opaque(x, y)) { top = Math.min(top, y); bottom = Math.max(bottom, y); break; }
      }
    }
    return { id: `b${index}f${i + 1}`, x: x0, y: top, w: x1 - x0, h: bottom - top + 1, bottom };
  });
  bands.push({ index, y: y0, h: y1 - y0, frames });
}

writeFileSync(out, `${JSON.stringify({ sheet, width, height, minGap, exclude, bands }, null, 2)}\n`);
for (const band of bands) {
  const sizes = band.frames.map((f) => `${f.id} x${f.x} ${f.w}x${f.h} bottom=${f.bottom}`).join('\n    ');
  console.log(`band ${band.index} (y ${band.y}, h ${band.h}): ${band.frames.length} frames\n    ${sizes}`);
}
