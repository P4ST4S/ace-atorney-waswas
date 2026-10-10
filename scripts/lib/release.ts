/**
 * Asset releases: a deterministic content version computed from the generated files, and the release index
 * that lists every object of the release (see docs/DEPLOYMENT_R2.md).
 *
 * release = first 16 hex chars of SHA-256(canonical manifest without `release` + sorted [path, size, sha256] of
 * every file the manifest references). Same files and manifest => same release, on any machine.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AssetManifest, ReleaseFile, ReleaseIndex } from '../../asset-meta/manifest-types.ts';
import {
  MANIFEST_FILE, RELEASE_INDEX_FILE, RELEASE_PATTERN, contentTypeFor, validateAssetPath,
} from '../../asset-meta/release-layout.ts';

export type ManifestBody = Omit<AssetManifest, 'release'>;

export interface FileDigest {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

const RELEASE_SALT = 'waswas-asset-release/1';

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function md5Base64(data: Uint8Array): string {
  return createHash('md5').update(data).digest('base64');
}

/** JSON with object keys sorted recursively, so the hash does not depend on key insertion order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Generated file names stay portable: URLs encode anything (asset-meta/release-layout.ts), but Vite's dev server
 * does not decode every escape (%23, %3F…) and Windows disks ignore case while R2 keys do not.
 */
const PORTABLE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/** Every file path referenced by the manifest (images, pose sheets, audio), validated, unique and sorted. */
export function manifestPaths(manifest: ManifestBody): string[] {
  const paths = new Set<string>();
  for (const image of Object.values(manifest.images)) paths.add(validateAssetPath(image.path));
  for (const poses of Object.values(manifest.sprites)) for (const pose of Object.values(poses)) paths.add(validateAssetPath(pose.path));
  for (const path of Object.values(manifest.audio)) paths.add(validateAssetPath(path));
  if (paths.has(MANIFEST_FILE) || paths.has(RELEASE_INDEX_FILE)) throw new Error('The manifest references a reserved file name.');
  const lowerCase = new Map<string, string>();
  for (const path of paths) {
    if (!PORTABLE_PATH.test(path)) throw new Error(`Generated file name "${path}" must only use A-Z a-z 0-9 . _ - and "/".`);
    const other = lowerCase.get(path.toLowerCase());
    if (other !== undefined) throw new Error(`Generated files "${other}" and "${path}" only differ by case.`);
    lowerCase.set(path.toLowerCase(), path);
  }
  return [...paths].sort();
}

export function computeRelease(manifest: ManifestBody, files: readonly FileDigest[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256')
    .update(`${RELEASE_SALT}\n`)
    .update(canonicalJson(manifest))
    .update('\n')
    .update(JSON.stringify(sorted.map((f) => [f.path, f.size, f.sha256])));
  return hash.digest('hex').slice(0, 16);
}

export function digestFile(root: string, path: string): FileDigest {
  const data = readFileSync(join(root, ...path.split('/')));
  return { path, size: data.byteLength, sha256: sha256Hex(data) };
}

export function serializeManifest(manifest: AssetManifest): string {
  return `${JSON.stringify(manifest)}\n`;
}

export function serializeIndex(index: ReleaseIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

function toReleaseFile(digest: FileDigest): ReleaseFile {
  return { ...digest, contentType: contentTypeFor(digest.path) };
}

export interface PreparedRelease {
  readonly manifest: AssetManifest;
  readonly manifestText: string;
  readonly index: ReleaseIndex;
  readonly indexText: string;
}

/**
 * Computes the release of the generated files under `root` (only those referenced by the manifest) and builds
 * the final manifest and its index. Writes nothing.
 */
export function prepareRelease(root: string, body: ManifestBody): PreparedRelease {
  const digests = manifestPaths(body).map((path) => digestFile(root, path));
  const release = computeRelease(body, digests);
  const manifest: AssetManifest = { version: body.version, release, images: body.images, sprites: body.sprites, audio: body.audio };
  const manifestText = serializeManifest(manifest);
  const manifestBytes = Buffer.from(manifestText, 'utf8');
  const manifestDigest: FileDigest = { path: MANIFEST_FILE, size: manifestBytes.byteLength, sha256: sha256Hex(manifestBytes) };
  const files = [...digests, manifestDigest].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map(toReleaseFile);
  const index: ReleaseIndex = { schema: 1, release, files };
  return { manifest, manifestText, index, indexText: serializeIndex(index) };
}

// ---------------------------------------------------------------------------
// Validation of files read back from disk or from the bucket
// ---------------------------------------------------------------------------

const size = z.object({ w: z.number(), h: z.number() });
const point = z.object({ x: z.number(), y: z.number() });
const frame = z.array(z.object({ s: z.tuple([z.number(), z.number(), z.number(), z.number()]), a: z.tuple([z.number(), z.number()]) }));

export const manifestSchema = z.object({
  version: z.literal(2),
  release: z.string().regex(RELEASE_PATTERN),
  images: z.record(z.string(), z.object({ path: z.string(), w: z.number(), h: z.number() })),
  sprites: z.record(z.string(), z.record(z.string(), z.object({
    path: z.string(), sheet: size, size, anchor: point, scale: z.number(), idle: frame, blink: z.array(frame), talk: z.array(frame),
  }))),
  audio: z.record(z.string(), z.string()),
});

export const releaseIndexSchema = z.object({
  schema: z.literal(1),
  release: z.string().regex(RELEASE_PATTERN),
  files: z.array(z.object({ path: z.string(), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/), contentType: z.string() })),
});

/** Validates a manifest; the parsed JSON itself is returned so that hashing sees exactly what was written. */
export function parseManifest(text: string): AssetManifest {
  const json: unknown = JSON.parse(text);
  manifestSchema.parse(json);
  return json as AssetManifest;
}

export function parseReleaseIndex(text: string): ReleaseIndex {
  const json: unknown = JSON.parse(text);
  releaseIndexSchema.parse(json);
  return json as ReleaseIndex;
}

export interface LocalRelease {
  readonly root: string;
  readonly manifest: AssetManifest;
  readonly manifestText: string;
  readonly index: ReleaseIndex;
  readonly indexText: string;
}

function sameFiles(a: readonly ReleaseFile[], b: readonly ReleaseFile[]): boolean {
  const key = (f: ReleaseFile): string => JSON.stringify([f.path, f.size, f.sha256, f.contentType]);
  return a.length === b.length && a.every((f, i) => { const other = b[i]; return other !== undefined && key(f) === key(other); });
}

/**
 * Reads `manifest.json` and `release.json` from `root`, re-hashes every file and checks that everything still
 * matches (a file changed after `pnpm assets:build` would otherwise publish an inconsistent release).
 */
export function readLocalRelease(root: string): LocalRelease {
  let manifestText: string;
  let indexText: string;
  try {
    manifestText = readFileSync(join(root, MANIFEST_FILE), 'utf8');
    indexText = readFileSync(join(root, RELEASE_INDEX_FILE), 'utf8');
  } catch {
    throw new Error(`No generated release in ${root}. Run \`pnpm assets:build\` first.`);
  }
  const manifest = parseManifest(manifestText);
  const index = parseReleaseIndex(indexText);
  const { release, ...body } = manifest;
  const digests = manifestPaths(body).map((path) => digestFile(root, path));
  const actual = computeRelease(body, digests);
  if (actual !== release || index.release !== release) {
    throw new Error(`Generated files changed since the last build (manifest ${release}, index ${index.release}, files ${actual}). Run \`pnpm assets:build\`.`);
  }
  const manifestBytes = Buffer.from(manifestText, 'utf8');
  const expectedFiles = [...digests, { path: MANIFEST_FILE, size: manifestBytes.byteLength, sha256: sha256Hex(manifestBytes) }]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(toReleaseFile);
  if (!sameFiles(expectedFiles, index.files)) throw new Error('release.json does not match the generated files. Run `pnpm assets:build`.');
  return { root, manifest, manifestText, index, indexText };
}

/**
 * The bucket is public: only demo evidence may be published. Real message captures must never be part of a
 * public release (docs/OPEN_QUESTIONS.md §8).
 */
export function assertPublicSafe(index: ReleaseIndex): void {
  const forbidden = index.files.filter((f) => /(^|\/)evidence\./.test(f.path) && !/(^|\/)evidence\.demo-[^/]*$/.test(f.path));
  if (forbidden.length > 0) {
    throw new Error(`Refusing to publish non-demo evidence to a public bucket: ${forbidden.map((f) => f.path).join(', ')}`);
  }
}
