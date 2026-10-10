/**
 * One-off, reversible reorganisation of the raw `assets/` folder.
 *
 * - Moves files only: file contents are never modified.
 * - Plans every move first and aborts if any file is unclassified or two files collide.
 * - Verifies file count and SHA-256 of every file before and after moving.
 * - Writes `asset-meta/reorg-map.json` (from -> to + hash) so the operation can be reverted.
 *
 * Usage:
 *   node --experimental-strip-types scripts/reorganize-assets.ts --dry-run
 *   node --experimental-strip-types scripts/reorganize-assets.ts
 *   node --experimental-strip-types scripts/reorganize-assets.ts --revert
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ASSETS = join(ROOT, 'assets');
const SOURCE = join(ASSETS, 'sprites');
const MAP_FILE = join(ROOT, 'asset-meta', 'reorg-map.json');

interface MoveEntry {
  readonly from: string;
  readonly to: string;
  readonly sha256: string;
  readonly bytes: number;
}

interface ReorgMap {
  readonly createdAt: string;
  readonly fileCount: number;
  readonly entries: readonly MoveEntry[];
}

const PREFIX_PC = 'PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - ';

const LANGUAGE_DIRS: Readonly<Record<string, string>> = {
  'Brazilian Portuguese': 'pt-br',
  English: 'en',
  French: 'fr',
  German: 'de',
  Japanese: 'ja',
  Korean: 'ko',
  'Latin American Spanish': 'es-419',
  'Simplified Chinese': 'zh-hans',
  'Traditional Chinese': 'zh-hant',
};

const MUSIC_FILES: Readonly<Record<string, string>> = {
  'Phoenix Wright Ace Attorney - Court is Now in Session.mp3': 'court-is-now-in-session.mp3',
  'Phoenix Wright Ace Attorney OST - Phoenix Wright ~ Objection! 2001.mp3': 'objection-2001.mp3',
  'Phoenix Wright Ace Attorney OST - Questioning ~ Allegro 2001.mp3': 'questioning-allegro-2001.mp3',
  'Phoenix Wright Ace Attorney OST - Questioning ~ Moderato 2001.mp3': 'questioning-moderato-2001.mp3',
  'Phoenix Wright Ace Attorney OST - Suspense.mp3': 'suspense.mp3',
  'Phoenix Wright Ace Attorney OST - Telling the Truth 2001.mp3': 'telling-the-truth-2001.mp3',
  'Pursuit - Corner the Culprit - Phoenix Wright Ace Attorney Trilogy OST.mp3': 'pursuit-corner-the-culprit.mp3',
};

/** DS general sound effects, grouped by purpose (names without the `sfx-` prefix). */
const DS_SFX_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  blips: ['bip', 'bip2', 'bip3', 'blipfemale', 'blipmale', 'typwriter'],
  ui: ['blink', 'bleep', 'cancel', 'evidenceshoop', 'pageturn', 'peep', 'peep2', 'pichoop', 'saveblip', 'scenechange', 'scroll',
    'selectblip', 'selectblip2', 'selectjingle', 'tap', 'tap2', 'tap3', 'wipe'],
  court: ['badum', 'crowdgoeswhile', 'damage1', 'damage2', 'deskslam', 'dramapound', 'gallery', 'gallerycheer', 'gavel', 'guilty',
    'happyping', 'lightbulb', 'objection', 'realization', 'shock', 'shock2', 'supershock', 'testimony', 'testimony2', 'whoops'],
  'psyche-lock': ['lock', 'locksbreak', 'psyche1'],
  impacts: ['bang', 'explosion', 'gunshot', 'gunshot2', 'gunshot3', 'gunshot4', 'lightbang', 'loudbang', 'shattering', 'shook',
    'shook2', 'smack', 'stab', 'stab2', 'swing', 'thud', 'thud2', 'thud3', 'thud4', 'thump', 'thump2', 'thump3', 'thwap',
    'weakgunshot', 'whack', 'wham', 'whip'],
  movement: ['bvvt', 'chug', 'dink', 'fwashing', 'fwasshing', 'grinding', 'grinding2', 'longwoosh', 'powder', 'shoomp', 'shooop',
    'spritz', 'swoop', 'swoop2', 'tong', 'yip', 'zooma'],
  ambience: ['bling2', 'dog bark', 'dooropens', 'maaagical', 'maaagical2', 'maaagical3', 'meow', 'phone1', 'phone2', 'phone3',
    'phone4', 'phone5', 'phonebeep', 'photosnap', 'roar', 'sirens', 'whimper'],
};

const DS_SFX_LOOKUP = new Map<string, string>(
  Object.entries(DS_SFX_CATEGORIES).flatMap(([category, names]) => names.map((name) => [name, category] as const)),
);

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Returns the destination path (relative to `assets/`) for a source path (relative to `assets/sprites/`). */
function classify(rel: string): string {
  const parts = rel.split(sep);
  const top = parts[0] ?? '';
  const file = parts[parts.length - 1] ?? '';

  if (top.startsWith(`${PREFIX_PC}Backgrounds - `)) {
    const group = top.slice(`${PREFIX_PC}Backgrounds - `.length);
    const game = group === 'Courtroom' ? 'courtroom' : /^AA([123]) Locations$/.exec(group)?.[1];
    if (game === undefined) throw new Error(`Unknown background group: ${group}`);
    const folder = game === 'courtroom' ? 'courtroom' : `aa${game}`;
    const locationDirs = parts.slice(1, -1).map(slugify);
    return ['images', 'backgrounds', folder, ...locationDirs, file].join('/');
  }

  if (top.startsWith(`${PREFIX_PC}Characters - `) && parts.length === 1) {
    const name = top.slice(`${PREFIX_PC}Characters - `.length).replace(/\.png$/, '');
    const slug = name === 'The Judges' ? 'judges' : slugify(name);
    return `images/characters/${slug}.png`;
  }

  if (top === `${PREFIX_PC}Miscellaneous - Evidence Frame.png`) return 'images/ui/evidence-frame.png';

  if (top === `${PREFIX_PC}Miscellaneous - Multilingual Interjections`) {
    const lang = LANGUAGE_DIRS[parts[1] ?? ''];
    if (lang === undefined) throw new Error(`Unknown interjection language: ${parts[1] ?? '?'}`);
    const kind = file.startsWith('etc00a') ? 'objection' : file.startsWith('etc00b') ? 'hold-it' : file.startsWith('etc012') ? 'take-that' : undefined;
    if (kind === undefined) throw new Error(`Unknown interjection file: ${rel}`);
    return `images/ui/interjections/${lang}/${kind}.png`;
  }

  if (top === 'OST') {
    const target = MUSIC_FILES[file];
    if (target === undefined) throw new Error(`Unknown music file: ${file}`);
    return `audio/music/${target}`;
  }

  if (top.startsWith('DS _ DSi - Phoenix Wright_ Ace Attorney_ Trials and Tribulations - Voices - French')) {
    const match = /^(.+)- (Objection|Hold it|Take that) \(fr\)\.wav$/.exec(file);
    if (match === null) throw new Error(`Unknown voice file: ${file}`);
    return `audio/voices/fr/${slugify(match[1] ?? '')}-${slugify(match[2] ?? '')}.wav`;
  }

  if (top.startsWith('DS _ DSi - Phoenix Wright_ Ace Attorney - Miscellaneous - General Sound Effects')) {
    const name = file.replace(/^sfx-/, '').replace(/\.wav$/, '');
    const category = DS_SFX_LOOKUP.get(name);
    if (category === undefined) throw new Error(`Unclassified DS sound effect: ${file}`);
    return `audio/sfx/ds/${category}/sfx-${slugify(name)}.wav`;
  }

  if (top.startsWith('3DS - Phoenix Wright_ Ace Attorney Trilogy - Miscellaneous - Sound Effects')) {
    return `audio/sfx/3ds/_a-trier/${file}`;
  }

  throw new Error(`Unclassified asset: ${rel}`);
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => {
        resolve(hash.digest('hex'));
      });
  });
}

function removeEmptyDirs(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(join(dir, entry.name));
  }
  if (readdirSync(dir).length === 0) rmdirSync(dir);
}

async function reorganize(dryRun: boolean): Promise<void> {
  if (!existsSync(SOURCE)) throw new Error(`Nothing to reorganise: ${SOURCE} does not exist.`);
  const sources = listFiles(SOURCE);
  const entries: MoveEntry[] = [];
  const targets = new Set<string>();

  for (const abs of sources) {
    const to = classify(relative(SOURCE, abs));
    if (targets.has(to)) throw new Error(`Destination collision: ${to}`);
    targets.add(to);
    entries.push({ from: relative(ASSETS, abs).split(sep).join('/'), to, sha256: await sha256(abs), bytes: statSync(abs).size });
  }

  for (const entry of entries) {
    if (existsSync(join(ASSETS, entry.to))) throw new Error(`Destination already exists: ${entry.to}`);
  }

  const byTopFolder = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.to.split('/').slice(0, 3).join('/');
    byTopFolder.set(key, (byTopFolder.get(key) ?? 0) + 1);
  }
  console.log(`Planned ${entries.length} moves:`);
  for (const [key, count] of [...byTopFolder.entries()].sort()) console.log(`  ${String(count).padStart(4)}  ${key}`);
  if (dryRun) return;

  for (const entry of entries) {
    const dest = join(ASSETS, entry.to);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(join(ASSETS, entry.from), dest);
  }

  for (const entry of entries) {
    const actual = await sha256(join(ASSETS, entry.to));
    if (actual !== entry.sha256) throw new Error(`Hash mismatch after move: ${entry.to}`);
  }

  removeEmptyDirs(SOURCE);
  const map: ReorgMap = { createdAt: new Date().toISOString(), fileCount: entries.length, entries };
  mkdirSync(dirname(MAP_FILE), { recursive: true });
  writeFileSync(MAP_FILE, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`Moved and verified ${entries.length} files. Map written to ${relative(ROOT, MAP_FILE)}.`);
}

async function revert(): Promise<void> {
  const map = JSON.parse(readFileSync(MAP_FILE, 'utf8')) as ReorgMap;
  for (const entry of map.entries) {
    const src = join(ASSETS, entry.to);
    const dest = join(ASSETS, entry.from);
    if (await sha256(src) !== entry.sha256) throw new Error(`Refusing to revert modified file: ${entry.to}`);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(src, dest);
  }
  for (const folder of ['images', 'audio']) removeEmptyDirs(join(ASSETS, folder));
  console.log(`Reverted ${map.entries.length} files.`);
}

const args = new Set(process.argv.slice(2));
if (args.has('--revert')) await revert();
else await reorganize(args.has('--dry-run'));
