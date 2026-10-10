/**
 * Content DSL: typed builders producing a `ChapterSource` for the engine.
 *
 * Content only imports engine *types*; everything here is plain data construction.
 * Forward references (section ids, endings) are checked by the content validator and at runtime.
 */
import type { AudioAlias, CourtPos, ImageAlias, PlaceId, RigId } from '../../../asset-meta/assets.ts';
import type {
  Blip, ChapterSource, CharacterDef, Cond, CourtView, EndingDef, EvidenceDef, EvidenceVariant, InterjectionKind, PressResume, ProfileDef,
  SourceCommand, TestimonySource, Transition, VarDef, VarValue,
} from '../../engine/types.ts';

export type MusicAlias = Extract<AudioAlias, `music.${string}`>;
export type SfxAlias = Extract<AudioAlias, `sfx.${string}`>;
export type VoiceAlias = Extract<AudioAlias, `voice.${string}`>;

type Body = readonly SourceCommand[];

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export interface CharacterSpec<P extends string> {
  readonly name: string;
  readonly sprite: RigId;
  /** Content pose key (French, as written in the script) -> rig pose id. */
  readonly poses: Readonly<Record<P, string>>;
  readonly blip: Blip;
  readonly voices?: Readonly<Partial<Record<InterjectionKind, VoiceAlias | null>>>;
}

export interface Character<P extends string> {
  readonly id: string;
  readonly def: CharacterDef;
  /** A line in the current pose. */
  say(text: string): SourceCommand;
  /** A line with a pose change. */
  say(pose: P, text: string): SourceCommand;
  /** An inner thought (blue text, no camera change). */
  think(text: string): SourceCommand;
  show(pose: P, at?: CourtPos): SourceCommand;
  pose(pose: P): SourceCommand;
  hide(): SourceCommand;
  objection(): SourceCommand;
  holdIt(): SourceCommand;
  takeThat(): SourceCommand;
}

export function character<const P extends string>(id: string, spec: CharacterSpec<P>): Character<P> {
  const def: CharacterDef = { name: spec.name, sprite: spec.sprite, poses: spec.poses, blip: spec.blip, voices: spec.voices ?? {} };
  function say(text: string): SourceCommand;
  function say(pose: P, text: string): SourceCommand;
  function say(first: string, second?: string): SourceCommand {
    return second === undefined ? { op: 'say', who: id, text: first } : { op: 'say', who: id, pose: first, text: second };
  }
  return {
    id,
    def,
    say,
    think: (text) => ({ op: 'say', who: id, text, thought: true }),
    show: (pose, at) => (at === undefined ? { op: 'show', who: id, pose } : { op: 'show', who: id, pose, at }),
    pose: (pose) => ({ op: 'pose', who: id, pose }),
    hide: () => ({ op: 'hide', who: id }),
    objection: () => ({ op: 'interjection', kind: 'objection', by: id }),
    holdIt: () => ({ op: 'interjection', kind: 'holdit', by: id }),
    takeThat: () => ({ op: 'interjection', kind: 'takethat', by: id }),
  };
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

export interface Variable<V extends VarValue> {
  readonly name: string;
  readonly def: VarDef;
  set(value: V): SourceCommand;
  is(op: Extract<Cond, { var: string }>['op'], value: V): Cond;
}

export interface Counter extends Variable<number> {
  /** Adds `delta`; `toast` is shown to the player (e.g. "Wassim gagne 10 EXP !"). */
  add(delta: number, toast?: string): SourceCommand;
}

export function flag(name: string, init = false): Variable<boolean> {
  return {
    name,
    def: { init },
    set: (value) => ({ op: 'set', name, value }),
    is: (op, value) => ({ var: name, op, value }),
  };
}

/** A numeric variable; with a label it is displayed in the HUD (e.g. Wassim's EXP). */
export function counter(name: string, init = 0, label?: string): Counter {
  return {
    name,
    def: label === undefined ? { init } : { init, label },
    set: (value) => ({ op: 'set', name, value }),
    is: (op, value) => ({ var: name, op, value }),
    add: (delta, toast) => (toast === undefined ? { op: 'addVar', name, delta } : { op: 'addVar', name, delta, toast }),
  };
}

export const not = (cond: Cond): Cond => ({ not: cond });
export const all = (...conds: Cond[]): Cond => ({ all: conds });
export const any = (...conds: Cond[]): Cond => ({ any: conds });

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export const narrate = (text: string): SourceCommand => ({ op: 'say', who: null, text });
export const court = (view: CourtView, transition: Transition = 'cut'): SourceCommand => ({ op: 'court', view, transition });
export const location = (place: PlaceId, transition: Transition = 'cut'): SourceCommand => ({ op: 'location', place, transition });
export const music = (track: MusicAlias | null, fadeMs = 0): SourceCommand => ({ op: 'music', track, fadeMs });
export const stopMusic = (fadeMs = 600): SourceCommand => ({ op: 'music', track: null, fadeMs });
export const sfx = (sound: SfxAlias): SourceCommand => ({ op: 'sfx', sound });
export const shake = (ms = 400, wait = false): SourceCommand => ({ op: 'shake', ms, wait });
export const flash = (ms = 200, wait = false): SourceCommand => ({ op: 'flash', ms, wait });
export const pause = (ms: number): SourceCommand => ({ op: 'wait', ms });
export const when = (cond: Cond, then: Body, otherwise?: Body): SourceCommand =>
  (otherwise === undefined ? { op: 'if', cond, then } : { op: 'if', cond, then, else: otherwise });
/** Leaves everything in progress (the call stack is emptied) and continues at `section`. */
export const exitTo = (section: string): SourceCommand => ({ op: 'exitTo', section });
/** Runs `section`, then comes back here. */
export const call = (section: string): SourceCommand => ({ op: 'call', section });
export const ret = (): SourceCommand => ({ op: 'return' });
export const ending = (id: string): SourceCommand => ({ op: 'ending', id });

// ---------------------------------------------------------------------------
// Court Record
// ---------------------------------------------------------------------------

export interface Evidence {
  readonly id: string;
  readonly def: EvidenceDef;
  /** Adds the evidence; unless silent, the player sees it ("ajouté au Dossier"). */
  add(silent?: boolean): SourceCommand;
  remove(): SourceCommand;
  /** Switches to another variant (new description/image), e.g. after a revelation. */
  update(variant: string, silent?: boolean): SourceCommand;
}

export interface EvidenceSpec {
  readonly name: string;
  readonly description: string;
  readonly icon: ImageAlias;
  /** Full-size image shown by "Examiner" (tall screenshots scroll and zoom). */
  readonly detail?: ImageAlias;
  readonly variants?: Readonly<Record<string, EvidenceVariant & { readonly icon?: ImageAlias; readonly detail?: ImageAlias }>>;
}

export function evidence(id: string, spec: EvidenceSpec): Evidence {
  return {
    id,
    def: spec,
    add: (silent = false) => ({ op: 'evidence', act: 'add', id, silent }),
    remove: () => ({ op: 'evidence', act: 'remove', id }),
    update: (variant, silent = false) => ({ op: 'evidence', act: 'update', id, variant, silent }),
  };
}

export interface Profile {
  readonly id: string;
  readonly def: ProfileDef;
  add(silent?: boolean): SourceCommand;
  remove(): SourceCommand;
}

/** A Court Record profile; its id is the character's id (presentable like evidence). */
export function profile(char: Character<string>, spec: { readonly description: string; readonly portrait: ImageAlias }): Profile {
  return {
    id: char.id,
    def: spec,
    add: (silent = false) => ({ op: 'profile', act: 'add', id: char.id, silent }),
    remove: () => ({ op: 'profile', act: 'remove', id: char.id }),
  };
}

/** True when the item is in the Court Record. */
export const has = (item: Evidence | Profile): Cond => ({ has: item.id });

// ---------------------------------------------------------------------------
// Trial
// ---------------------------------------------------------------------------

export interface Statement<S extends string, P extends string> {
  readonly id: S;
  readonly pose?: P;
  readonly text: string;
  /** Hidden until revealed (typically by pressing another statement). */
  readonly hidden?: boolean;
  readonly variants?: Readonly<Record<string, string>>;
}

export interface Testimony<S extends string> {
  readonly id: string;
  readonly source: TestimonySource;
  /** Statement ids, kept for typing cross-examination specs. */
  readonly statementIds: readonly S[];
}

export function testimony<const S extends string, P extends string>(
  id: string,
  title: string,
  witness: Character<P>,
  statements: readonly Statement<S, P>[],
): Testimony<S> {
  return { id, source: { id, title, witness: witness.id, statements }, statementIds: statements.map((s) => s.id) };
}

/** Plays a testimony: "Témoignage" banner, then the visible statements (green, no interaction). */
export const play = (t: Testimony<string>): SourceCommand => ({ op: 'testimony', testimony: t.id });

export interface CrossExamSpec<S extends string> {
  readonly id: string;
  readonly testimony: Testimony<S>;
  readonly press: Readonly<Partial<Record<S, Body | { readonly body: Body; readonly resume: PressResume }>>>;
  readonly solutions: readonly { readonly stmts: readonly S[]; readonly items: readonly (Evidence | Profile)[]; readonly body: Body }[];
  /** Wrong presentation. Put the penalty last: reaching 0 HP aborts the block. */
  readonly wrong: Body;
  readonly wrongAt?: Readonly<Partial<Record<S, Body>>>;
  readonly loop?: Body;
}

function isPressObject(value: Body | { readonly body: Body; readonly resume: PressResume }): value is { readonly body: Body; readonly resume: PressResume } {
  return 'body' in value;
}

export function crossExam<S extends string>(spec: CrossExamSpec<S>): SourceCommand {
  const press: Record<string, { body: Body; resume?: PressResume }> = {};
  for (const [stmt, value] of Object.entries<Body | { readonly body: Body; readonly resume: PressResume } | undefined>(spec.press)) {
    if (value === undefined) continue;
    press[stmt] = isPressObject(value) ? value : { body: value };
  }
  const wrongAt: Record<string, Body> = {};
  for (const [stmt, body] of Object.entries<Body | undefined>(spec.wrongAt ?? {})) {
    if (body !== undefined) wrongAt[stmt] = body;
  }
  return {
    op: 'crossExam',
    spec: {
      id: spec.id,
      testimony: spec.testimony.id,
      press,
      solutions: spec.solutions.map((s) => ({ stmts: s.stmts, items: s.items.map((i) => i.id), body: s.body })),
      wrong: spec.wrong,
      wrongAt,
      ...(spec.loop === undefined ? {} : { loop: spec.loop }),
    },
  };
}

/** Reveals a hidden statement of `t` (at its written position) in cross-examination `ce`. */
export function reveal<S extends string>(ce: string, t: Testimony<S>, stmt: S): SourceCommand {
  if (!t.statementIds.includes(stmt)) throw new Error(`reveal: "${stmt}" is not a statement of ${t.id}`);
  return { op: 'reveal', ce, stmt };
}

/** Replaces a statement's text by one of its variants, without moving it. */
export function amend<S extends string>(ce: string, t: Testimony<S>, stmt: S, variant: string): SourceCommand {
  if (!t.statementIds.includes(stmt)) throw new Error(`amend: "${stmt}" is not a statement of ${t.id}`);
  return { op: 'amend', ce, stmt, variant };
}

/** Ends a solution body and resumes the cross-examination on the same statement. */
export const resumeCrossExam = (): SourceCommand => ({ op: 'resumeCrossExam' });
export const penalty = (damage: number): SourceCommand => ({ op: 'penalty', damage });
export const healthBar = (visible: boolean): SourceCommand => ({ op: 'healthBar', visible });
export const verdict = (text: string): SourceCommand => ({ op: 'verdict', text });

// ---------------------------------------------------------------------------
// Chapter
// ---------------------------------------------------------------------------

export interface Section {
  readonly id: string;
  readonly body: Body;
}

export const section = (id: string, body: Body): Section => ({ id, body });

export interface ChapterSpec {
  readonly id: string;
  readonly title: string;
  readonly contentRevision: number;
  readonly start: string;
  readonly gameOver: string;
  readonly maxHealth: number;
  readonly player: { readonly character: Character<string>; readonly bench: CourtPos };
  readonly cast: readonly Character<string>[];
  readonly vars: readonly Variable<VarValue>[];
  readonly evidence: readonly Evidence[];
  readonly profiles: readonly Profile[];
  readonly testimonies: readonly Testimony<string>[];
  readonly endings: Readonly<Record<string, EndingDef>>;
  readonly sections: readonly Section[];
}

export function defineChapter(spec: ChapterSpec): ChapterSource {
  const unique = <T>(items: readonly T[], key: (item: T) => string, what: string): void => {
    const seen = new Set<string>();
    for (const item of items) {
      const k = key(item);
      if (seen.has(k)) throw new Error(`Duplicate ${what}: ${k}`);
      seen.add(k);
    }
  };
  unique(spec.cast, (c) => c.id, 'character');
  unique(spec.vars, (v) => v.name, 'variable');
  unique(spec.sections, (s) => s.id, 'section');
  unique(spec.evidence, (e) => e.id, 'evidence');
  unique(spec.profiles, (p) => p.id, 'profile');
  unique(spec.testimonies, (t) => t.id, 'testimony');
  return {
    id: spec.id,
    title: spec.title,
    contentRevision: spec.contentRevision,
    start: spec.start,
    gameOver: spec.gameOver,
    maxHealth: spec.maxHealth,
    player: { char: spec.player.character.id, bench: spec.player.bench },
    characters: Object.fromEntries(spec.cast.map((c) => [c.id, c.def])),
    vars: Object.fromEntries(spec.vars.map((v) => [v.name, v.def])),
    evidence: Object.fromEntries(spec.evidence.map((e) => [e.id, e.def])),
    profiles: Object.fromEntries(spec.profiles.map((p) => [p.id, p.def])),
    testimonies: Object.fromEntries(spec.testimonies.map((t) => [t.id, t.source])),
    endings: spec.endings,
    sections: Object.fromEntries(spec.sections.map((s) => [s.id, s.body])),
  };
}
