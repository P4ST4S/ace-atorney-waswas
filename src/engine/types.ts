/**
 * Engine types. The engine is pure: it depends on nothing outside this folder and only manipulates
 * serializable data (see docs/ARCHITECTURE.md §7).
 */

export type CourtPos = 'defense' | 'prosecution' | 'witness' | 'judge' | 'cocounsel';
export type CourtView = CourtPos | 'wide';
export type InterjectionKind = 'objection' | 'holdit' | 'takethat';
export type Transition = 'cut' | 'fade';
export type TextColor = 'white' | 'red' | 'blue' | 'green';
export type Blip = 'male' | 'female' | 'typewriter';
export type LineStyle = 'dialogue' | 'thought' | 'testimony' | 'crossExam';

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export type TextToken =
  | { readonly t: 'text'; readonly text: string; readonly color: TextColor }
  | { readonly t: 'pause'; readonly ms: number }
  | { readonly t: 'speed'; readonly factor: number }
  | { readonly t: 'shake' }
  | { readonly t: 'flash' }
  | { readonly t: 'sfx'; readonly sound: string };

// ---------------------------------------------------------------------------
// Chapter source (what the content DSL produces)
// ---------------------------------------------------------------------------

export type VarValue = number | boolean;

export type Cond =
  | { readonly var: string; readonly op: '==' | '!=' | '>' | '>=' | '<' | '<='; readonly value: VarValue }
  /** True when the evidence or profile is in the Court Record. */
  | { readonly has: string }
  | { readonly not: Cond }
  | { readonly all: readonly Cond[] }
  | { readonly any: readonly Cond[] };

/** Where a cross-examination resumes after a press conversation. */
export type PressResume = 'next' | 'same' | { readonly to: string };

export interface PressSource {
  readonly body: readonly SourceCommand[];
  readonly resume?: PressResume;
}

export interface SolutionSource {
  /** Statements on which presenting one of `items` exposes the contradiction. */
  readonly stmts: readonly string[];
  readonly items: readonly string[];
  /** Must end with `exitTo` or `resumeCrossExam` (checked by the validator, enforced at runtime). */
  readonly body: readonly SourceCommand[];
}

export interface CrossExamSource {
  readonly id: string;
  readonly testimony: string;
  readonly press: Readonly<Record<string, PressSource>>;
  readonly solutions: readonly SolutionSource[];
  /** Wrong presentation (default). Put the penalty last: reaching 0 HP aborts the block. */
  readonly wrong: readonly SourceCommand[];
  readonly wrongAt?: Readonly<Record<string, readonly SourceCommand[]>>;
  /** Played after the last statement, before looping back to the first. */
  readonly loop?: readonly SourceCommand[];
}

export type SourceCommand =
  | { readonly op: 'say'; readonly who: string | null; readonly pose?: string; readonly text: string; readonly thought?: boolean }
  | { readonly op: 'show'; readonly who: string; readonly pose: string; readonly at?: CourtPos }
  | { readonly op: 'hide'; readonly who: string }
  | { readonly op: 'pose'; readonly who: string; readonly pose: string }
  | { readonly op: 'court'; readonly view: CourtView; readonly transition?: Transition }
  | { readonly op: 'location'; readonly place: string; readonly transition?: Transition }
  | { readonly op: 'music'; readonly track: string | null; readonly fadeMs?: number }
  | { readonly op: 'sfx'; readonly sound: string }
  | { readonly op: 'shake'; readonly ms?: number; readonly wait?: boolean }
  | { readonly op: 'flash'; readonly ms?: number; readonly wait?: boolean }
  | { readonly op: 'wait'; readonly ms: number }
  | { readonly op: 'interjection'; readonly kind: InterjectionKind; readonly by: string }
  | { readonly op: 'set'; readonly name: string; readonly value: VarValue }
  | { readonly op: 'addVar'; readonly name: string; readonly delta: number; readonly toast?: string }
  | { readonly op: 'if'; readonly cond: Cond; readonly then: readonly SourceCommand[]; readonly else?: readonly SourceCommand[] }
  | { readonly op: 'exitTo'; readonly section: string }
  | { readonly op: 'call'; readonly section: string }
  | { readonly op: 'return' }
  | { readonly op: 'ending'; readonly id: string }
  | { readonly op: 'evidence'; readonly act: 'add' | 'remove'; readonly id: string; readonly silent?: boolean }
  | { readonly op: 'evidence'; readonly act: 'update'; readonly id: string; readonly variant: string; readonly silent?: boolean }
  | { readonly op: 'profile'; readonly act: 'add' | 'remove'; readonly id: string; readonly silent?: boolean }
  | { readonly op: 'healthBar'; readonly visible: boolean }
  | { readonly op: 'penalty'; readonly damage: number }
  | { readonly op: 'testimony'; readonly testimony: string }
  | { readonly op: 'crossExam'; readonly spec: CrossExamSource }
  | { readonly op: 'reveal'; readonly ce: string; readonly stmt: string }
  | { readonly op: 'amend'; readonly ce: string; readonly stmt: string; readonly variant: string }
  | { readonly op: 'resumeCrossExam' }
  | { readonly op: 'verdict'; readonly text: string };

export interface CharacterDef {
  readonly name: string;
  /** Sprite rig used to draw this character (identity is separate from the sprite sheet). */
  readonly sprite: string;
  /** Content pose key -> rig pose id. */
  readonly poses: Readonly<Record<string, string>>;
  readonly blip: Blip;
  /** Interjection voice per kind: audio alias, or null when the character has no voice for it. */
  readonly voices: Readonly<Partial<Record<InterjectionKind, string | null>>>;
}

export interface VarDef {
  readonly init: VarValue;
  readonly label?: string;
}

export interface EndingDef {
  readonly title: string;
  readonly tone: 'win' | 'lose' | 'joke';
}

export interface EvidenceVariant {
  readonly name?: string;
  readonly description?: string;
  readonly icon?: string;
  readonly detail?: string;
}

/** Court Record evidence. `icon` and `detail` are image aliases; the detail view zooms/scrolls tall images. */
export interface EvidenceDef {
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly detail?: string;
  readonly variants?: Readonly<Record<string, EvidenceVariant>>;
}

/** Court Record profile of a character (id = character id). */
export interface ProfileDef {
  readonly description: string;
  readonly portrait: string;
}

export interface StatementSource {
  readonly id: string;
  readonly pose?: string;
  readonly text: string;
  readonly hidden?: boolean;
  /** Alternative texts selected by `amend`. */
  readonly variants?: Readonly<Record<string, string>>;
}

export interface TestimonySource {
  readonly id: string;
  readonly title: string;
  readonly witness: string;
  readonly statements: readonly StatementSource[];
}

export interface ChapterSource {
  readonly id: string;
  readonly title: string;
  /** Manual revision, part of the save-compatibility hash. */
  readonly contentRevision: number;
  readonly start: string;
  readonly gameOver: string;
  readonly maxHealth: number;
  readonly player: { readonly char: string; readonly bench: CourtPos };
  readonly characters: Readonly<Record<string, CharacterDef>>;
  readonly vars: Readonly<Record<string, VarDef>>;
  readonly evidence: Readonly<Record<string, EvidenceDef>>;
  readonly profiles: Readonly<Record<string, ProfileDef>>;
  readonly testimonies: Readonly<Record<string, TestimonySource>>;
  readonly sections: Readonly<Record<string, readonly SourceCommand[]>>;
  readonly endings: Readonly<Record<string, EndingDef>>;
}

// ---------------------------------------------------------------------------
// Compiled chapter (what the engine executes)
// ---------------------------------------------------------------------------

export interface CompiledStatement {
  readonly id: string;
  readonly pose: string | null;
  readonly tokens: readonly TextToken[];
  readonly hidden: boolean;
  readonly variants: Readonly<Record<string, readonly TextToken[]>>;
}

export interface CompiledTestimony {
  readonly id: string;
  readonly title: string;
  readonly witness: string;
  readonly statements: readonly CompiledStatement[];
}

export interface CompiledCrossExam {
  readonly id: string;
  readonly testimony: string;
  readonly press: Readonly<Record<string, { readonly block: string; readonly resume: PressResume }>>;
  readonly solutions: readonly { readonly stmts: readonly string[]; readonly items: readonly string[]; readonly block: string }[];
  readonly wrong: string;
  readonly wrongAt: Readonly<Record<string, string>>;
  readonly loop: string | null;
}

export type Instr =
  | { readonly op: 'say'; readonly who: string | null; readonly pose: string | null; readonly tokens: readonly TextToken[]; readonly style: LineStyle }
  | { readonly op: 'show'; readonly who: string; readonly pose: string; readonly at: CourtPos | null }
  | { readonly op: 'hide'; readonly who: string }
  | { readonly op: 'pose'; readonly who: string; readonly pose: string }
  | { readonly op: 'court'; readonly view: CourtView; readonly transition: Transition }
  | { readonly op: 'location'; readonly place: string; readonly transition: Transition }
  | { readonly op: 'music'; readonly track: string | null; readonly fadeMs: number }
  | { readonly op: 'sfx'; readonly sound: string }
  | { readonly op: 'shake' | 'flash'; readonly ms: number; readonly wait: boolean }
  | { readonly op: 'wait'; readonly ms: number }
  | { readonly op: 'interjection'; readonly kind: InterjectionKind; readonly by: string }
  | { readonly op: 'set'; readonly name: string; readonly value: VarValue }
  | { readonly op: 'addVar'; readonly name: string; readonly delta: number; readonly toast: string | null }
  | { readonly op: 'if'; readonly cond: Cond; readonly then: string; readonly else: string | null }
  | { readonly op: 'exitTo'; readonly section: string }
  | { readonly op: 'call'; readonly section: string }
  | { readonly op: 'return' }
  | { readonly op: 'ending'; readonly id: string }
  | { readonly op: 'record'; readonly act: 'add' | 'remove' | 'update'; readonly kind: 'evidence' | 'profile'; readonly id: string; readonly variant: string | null; readonly silent: boolean }
  | { readonly op: 'healthBar'; readonly visible: boolean }
  | { readonly op: 'penalty'; readonly damage: number }
  | { readonly op: 'banner'; readonly kind: 'testimony' | 'crossExam'; readonly title: string }
  | { readonly op: 'crossExam'; readonly ce: string }
  | { readonly op: 'reveal'; readonly ce: string; readonly stmt: string }
  | { readonly op: 'amend'; readonly ce: string; readonly stmt: string; readonly variant: string }
  | { readonly op: 'resumeCrossExam' }
  | { readonly op: 'verdict'; readonly text: string };

export interface CompiledChapter {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly gameOver: string;
  readonly maxHealth: number;
  readonly player: { readonly char: string; readonly bench: CourtPos };
  readonly characters: Readonly<Record<string, CharacterDef>>;
  readonly vars: Readonly<Record<string, VarDef>>;
  readonly evidence: Readonly<Record<string, EvidenceDef>>;
  readonly profiles: Readonly<Record<string, ProfileDef>>;
  readonly endings: Readonly<Record<string, EndingDef>>;
  readonly testimonies: Readonly<Record<string, CompiledTestimony>>;
  readonly crossExams: Readonly<Record<string, CompiledCrossExam>>;
  /** Sections and hoisted nested bodies, by block id. */
  readonly blocks: Readonly<Record<string, readonly Instr[]>>;
  /** Section ids (blocks written by the author, as opposed to hoisted bodies). */
  readonly sections: readonly string[];
  /** Save-compatibility hash: structure + inline commands + contentRevision; displayed words excluded. */
  readonly compat: string;
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface Frame {
  readonly block: string;
  readonly ip: number;
}

export type Wait =
  | { readonly t: 'none' }
  /** A line is displayed; `at` points to its `say` instruction (used to rebuild it after a load). */
  | { readonly t: 'line'; readonly at: Frame }
  | { readonly t: 'fx'; readonly fxId: number }
  | { readonly t: 'ce'; readonly ce: string }
  | { readonly t: 'ended'; readonly ending: string };

export interface Actor {
  readonly char: string;
  readonly pose: string;
}

export type Place =
  | { readonly k: 'none' }
  | { readonly k: 'court'; readonly view: CourtView }
  | { readonly k: 'location'; readonly place: string };

export interface Stage {
  readonly place: Place;
  /** Who stands where in the courtroom; persists across camera cuts. */
  readonly court: Readonly<Partial<Record<CourtPos, Actor>>>;
  /** The character shown in a location (one at a time, as in the original games). */
  readonly actor: Actor | null;
  readonly music: string | null;
  readonly healthBar: boolean;
}

export interface CourtRecord {
  readonly evidence: readonly string[];
  readonly profiles: readonly string[];
  /** Evidence id -> current variant key. */
  readonly variants: Readonly<Record<string, string>>;
}

export type CrossExamAfter =
  | { readonly k: 'press'; readonly stmt: string; readonly resume: PressResume }
  | { readonly k: 'wrong'; readonly stmt: string }
  | { readonly k: 'loop' }
  | { readonly k: 'solution' }
  | { readonly k: 'resume' };

export interface CrossExamState {
  /** Current statement id (never an index: revealing a statement must not shift the resume point). */
  readonly current: string;
  readonly revealed: readonly string[];
  readonly amended: Readonly<Record<string, string>>;
  readonly pressed: readonly string[];
  readonly after: CrossExamAfter | null;
}

export interface EngineState {
  readonly v: 1;
  readonly frames: readonly Frame[];
  readonly wait: Wait;
  readonly waitRev: number;
  readonly fxSeq: number;
  readonly stage: Stage;
  readonly vars: Readonly<Record<string, VarValue>>;
  readonly record: CourtRecord;
  readonly ce: Readonly<Record<string, CrossExamState>>;
  readonly health: number;
}

// ---------------------------------------------------------------------------
// Inputs and effects
// ---------------------------------------------------------------------------

/** Player inputs carry the wait revision they answer (captured by the UI when the action is created). */
export type PlayerInput =
  | { readonly t: 'advance'; readonly rev: number }
  | { readonly t: 'cePrev'; readonly rev: number }
  | { readonly t: 'press'; readonly rev: number }
  | { readonly t: 'present'; readonly rev: number; readonly item: string };

export type Input = PlayerInput | { readonly t: 'fxEnd'; readonly fxId: number; readonly outcome: 'done' | 'failed' };

export interface CrossExamLineInfo {
  readonly id: string;
  readonly stmt: string;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly pressed: boolean;
}

export type Effect =
  | { readonly fx: 'stage'; readonly stage: Stage; readonly transition: Transition; readonly fxId?: number }
  | {
    readonly fx: 'line';
    readonly speaker: string | null;
    readonly name: string | null;
    readonly tokens: readonly TextToken[];
    readonly style: LineStyle;
    readonly ce?: CrossExamLineInfo;
  }
  | { readonly fx: 'interjection'; readonly kind: InterjectionKind; readonly by: string; readonly fxId: number }
  | { readonly fx: 'music'; readonly track: string | null; readonly fadeMs: number }
  | { readonly fx: 'sfx'; readonly sound: string }
  | { readonly fx: 'shake' | 'flash'; readonly ms: number; readonly fxId?: number }
  | { readonly fx: 'wait'; readonly ms: number; readonly fxId: number }
  | { readonly fx: 'var'; readonly name: string; readonly delta: number; readonly value: VarValue; readonly toast: string | null }
  | { readonly fx: 'record'; readonly record: CourtRecord; readonly act: 'add' | 'remove' | 'update'; readonly kind: 'evidence' | 'profile'; readonly item: string; readonly fxId?: number }
  | { readonly fx: 'healthBar'; readonly visible: boolean }
  | { readonly fx: 'damage'; readonly amount: number; readonly health: number; readonly max: number; readonly fxId: number }
  | { readonly fx: 'banner'; readonly kind: 'testimony' | 'crossExam'; readonly title: string; readonly fxId: number }
  | { readonly fx: 'verdict'; readonly text: string; readonly fxId: number }
  | { readonly fx: 'ended'; readonly ending: string };

export type RejectReason =
  | 'stale-rev'
  | 'not-waiting-for-line'
  | 'not-waiting-for-fx'
  | 'not-in-cross-exam'
  | 'wrong-fx-id'
  | 'first-statement'
  | 'not-in-record'
  | 'ended';

export type StepResult =
  | { readonly ok: true; readonly state: EngineState; readonly effects: readonly Effect[] }
  | { readonly ok: false; readonly state: EngineState; readonly reason: RejectReason };

/** Raised for content bugs (dangling references, runaway loops); never for player actions. */
export class ContentError extends Error {
  override readonly name = 'ContentError';
}
