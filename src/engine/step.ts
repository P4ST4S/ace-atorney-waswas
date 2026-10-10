import { ContentError } from './types.ts';
import type {
  Actor, CompiledChapter, CompiledCrossExam, CompiledTestimony, Cond, CourtPos, CourtRecord, CrossExamState, Effect, EngineState, Frame,
  Input, Instr, PressResume, RejectReason, Stage, StepResult, Transition, VarValue, Wait,
} from './types.ts';

/** Maximum instructions executed by one `step` without reaching a wait (guards against `exitTo` loops). */
export const INSTRUCTION_BUDGET = 10_000;

const COURT_POSITIONS: readonly CourtPos[] = ['defense', 'prosecution', 'witness', 'judge', 'cocounsel'];

const EMPTY_STAGE: Stage = { place: { k: 'none' }, court: {}, actor: null, music: null, healthBar: false };

/** Mutable working copy used inside one step; the public state is immutable. */
interface Work {
  frames: Frame[];
  wait: Wait;
  waitRev: number;
  fxSeq: number;
  stage: Stage;
  vars: Record<string, VarValue>;
  record: CourtRecord;
  ce: Record<string, CrossExamState>;
  health: number;
  effects: Effect[];
  /** Stage changes are coalesced and flushed before any other effect. */
  pendingStage: Transition | null;
}

function toWork(state: EngineState): Work {
  return {
    frames: [...state.frames],
    wait: state.wait,
    waitRev: state.waitRev,
    fxSeq: state.fxSeq,
    stage: state.stage,
    vars: { ...state.vars },
    record: state.record,
    ce: { ...state.ce },
    health: state.health,
    effects: [],
    pendingStage: null,
  };
}

function toState(w: Work): EngineState {
  return { v: 1, frames: w.frames, wait: w.wait, waitRev: w.waitRev, fxSeq: w.fxSeq, stage: w.stage, vars: w.vars, record: w.record, ce: w.ce, health: w.health };
}

export function initialState(chapter: CompiledChapter): EngineState {
  const vars: Record<string, VarValue> = {};
  for (const [name, def] of Object.entries(chapter.vars)) vars[name] = def.init;
  return {
    v: 1,
    frames: [{ block: chapter.start, ip: 0 }],
    wait: { t: 'none' },
    waitRev: 0,
    fxSeq: 0,
    stage: EMPTY_STAGE,
    vars,
    record: { evidence: [], profiles: [], variants: {} },
    ce: {},
    health: chapter.maxHealth,
  };
}

/** Starts the chapter: runs until the first wait. */
export function startChapter(chapter: CompiledChapter): StepResult {
  const w = toWork(initialState(chapter));
  run(w, chapter);
  return { ok: true, state: toState(w), effects: w.effects };
}

/**
 * Applies one input. Invalid or stale inputs are rejected here (state unchanged), whatever the UI shows.
 */
export function step(state: EngineState, input: Input, chapter: CompiledChapter): StepResult {
  const reject = (reason: RejectReason): StepResult => ({ ok: false, state, reason });
  const wait = state.wait;
  if (wait.t === 'ended') return reject('ended');

  if (input.t === 'fxEnd') {
    if (wait.t !== 'fx') return reject('not-waiting-for-fx');
    if (input.fxId !== wait.fxId) return reject('wrong-fx-id');
    return resume(state, chapter, () => undefined);
  }

  if (input.rev !== state.waitRev) return reject('stale-rev');

  if (input.t === 'advance' && wait.t === 'line') return resume(state, chapter, () => undefined);
  if (wait.t !== 'ce') return reject(input.t === 'advance' ? 'not-waiting-for-line' : 'not-in-cross-exam');

  const cx = crossExamOf(chapter, wait.ce);
  const ce = state.ce[cx.id];
  if (ce === undefined) throw new ContentError(`Cross-examination "${cx.id}" has no state.`);
  const visible = visibleStatements(chapter, cx, ce);
  const index = visible.indexOf(ce.current);

  switch (input.t) {
    case 'advance':
      return resume(state, chapter, (w) => {
        const next = visible[index + 1];
        if (next !== undefined) w.ce[cx.id] = { ...ce, current: next };
        else if (cx.loop !== null) {
          w.ce[cx.id] = { ...ce, after: { k: 'loop' } };
          w.frames.push({ block: cx.loop, ip: 0 });
        } else w.ce[cx.id] = { ...ce, current: visible[0] ?? ce.current };
      });
    case 'cePrev': {
      const previous = visible[index - 1];
      if (previous === undefined) return reject('first-statement');
      return resume(state, chapter, (w) => {
        w.ce[cx.id] = { ...ce, current: previous };
      });
    }
    case 'press': {
      const press = cx.press[ce.current];
      return interject(state, chapter, 'holdit', (w) => {
        const pressed = ce.pressed.includes(ce.current) ? ce.pressed : [...ce.pressed, ce.current];
        w.ce[cx.id] = { ...ce, pressed, after: { k: 'press', stmt: ce.current, resume: press?.resume ?? 'next' } };
        if (press !== undefined) w.frames.push({ block: press.block, ip: 0 });
      });
    }
    case 'present': {
      if (!state.record.evidence.includes(input.item) && !state.record.profiles.includes(input.item)) return reject('not-in-record');
      const solution = cx.solutions.find((s) => s.stmts.includes(ce.current) && s.items.includes(input.item));
      return interject(state, chapter, 'objection', (w) => {
        if (solution !== undefined) {
          w.ce[cx.id] = { ...ce, after: { k: 'solution' } };
          w.frames.push({ block: solution.block, ip: 0 });
        } else {
          w.ce[cx.id] = { ...ce, after: { k: 'wrong', stmt: ce.current } };
          w.frames.push({ block: cx.wrongAt[ce.current] ?? cx.wrong, ip: 0 });
        }
      });
    }
  }
}

/** Applies `mutate` to a working copy, then runs until the next wait. */
function resume(state: EngineState, chapter: CompiledChapter, mutate: (w: Work) => void): StepResult {
  const w = toWork(state);
  w.wait = { t: 'none' };
  mutate(w);
  run(w, chapter);
  return { ok: true, state: toState(w), effects: w.effects };
}

/** The player's interjection plays first (blocking); the pushed body runs once it has been acknowledged. */
function interject(state: EngineState, chapter: CompiledChapter, kind: 'holdit' | 'objection', mutate: (w: Work) => void): StepResult {
  const w = toWork(state);
  w.wait = { t: 'none' };
  mutate(w);
  blocking(w, (fxId) => ({ fx: 'interjection', kind, by: chapter.player.char, fxId }));
  return { ok: true, state: toState(w), effects: w.effects };
}

/** Inputs the UI may offer right now (presentation aid only: `step` remains the authority). */
export function availableInputs(state: EngineState): readonly Input['t'][] {
  switch (state.wait.t) {
    case 'line':
      return ['advance'];
    case 'ce':
      return ['advance', 'cePrev', 'press', 'present'];
    case 'fx':
      return ['fxEnd'];
    case 'none':
    case 'ended':
      return [];
  }
}

/**
 * Effects that rebuild the persistent visuals of a restored state, without transitions.
 * Consumed effects (interjections, sounds, damage…) are never replayed.
 */
export function hydrate(state: EngineState, chapter: CompiledChapter): Effect[] {
  const effects: Effect[] = [
    { fx: 'stage', stage: state.stage, transition: 'cut' },
    { fx: 'music', track: state.stage.music, fadeMs: 0 },
    { fx: 'healthBar', visible: state.stage.healthBar },
  ];
  const wait = state.wait;
  if (wait.t === 'line') {
    const instr = chapter.blocks[wait.at.block]?.[wait.at.ip];
    if (instr?.op === 'say') effects.push(lineEffect(instr, chapter));
  } else if (wait.t === 'ce') {
    const cx = crossExamOf(chapter, wait.ce);
    const ce = state.ce[cx.id];
    if (ce !== undefined) effects.push(statementLine(chapter, cx, ce));
  } else if (wait.t === 'ended') {
    effects.push({ fx: 'ended', ending: wait.ending });
  }
  return effects;
}

// ---------------------------------------------------------------------------
// Cross-examination helpers
// ---------------------------------------------------------------------------

function crossExamOf(chapter: CompiledChapter, id: string): CompiledCrossExam {
  const cx = chapter.crossExams[id];
  if (cx === undefined) throw new ContentError(`Unknown cross-examination "${id}".`);
  return cx;
}

function testimonyOf(chapter: CompiledChapter, cx: CompiledCrossExam): CompiledTestimony {
  const t = chapter.testimonies[cx.testimony];
  if (t === undefined) throw new ContentError(`Cross-examination "${cx.id}": unknown testimony "${cx.testimony}".`);
  return t;
}

/** Statement ids in written order, keeping only visible ones (not hidden, or revealed). */
function visibleStatements(chapter: CompiledChapter, cx: CompiledCrossExam, ce: Pick<CrossExamState, 'revealed'>): string[] {
  return testimonyOf(chapter, cx).statements.filter((s) => !s.hidden || ce.revealed.includes(s.id)).map((s) => s.id);
}

function resolvePressResume(resume: PressResume, pressed: string, visible: readonly string[], ceId: string): string {
  if (resume === 'same') return pressed;
  if (resume !== 'next') {
    if (!visible.includes(resume.to)) throw new ContentError(`Cross-examination "${ceId}": press resumes on invisible statement "${resume.to}".`);
    return resume.to;
  }
  const index = visible.indexOf(pressed);
  return visible[index + 1] ?? visible[0] ?? pressed;
}

function statementLine(chapter: CompiledChapter, cx: CompiledCrossExam, ce: CrossExamState): Effect {
  const t = testimonyOf(chapter, cx);
  const stmt = t.statements.find((s) => s.id === ce.current);
  if (stmt === undefined) throw new ContentError(`Cross-examination "${cx.id}": unknown statement "${ce.current}".`);
  const variant = ce.amended[stmt.id];
  const tokens = variant === undefined ? stmt.tokens : stmt.variants[variant];
  if (tokens === undefined) throw new ContentError(`Statement "${stmt.id}": unknown variant "${variant ?? ''}".`);
  const visible = visibleStatements(chapter, cx, ce);
  const index = visible.indexOf(stmt.id);
  return {
    fx: 'line',
    speaker: t.witness,
    name: chapter.characters[t.witness]?.name ?? t.witness,
    tokens,
    style: 'crossExam',
    ce: { id: cx.id, stmt: stmt.id, isFirst: index === 0, isLast: index === visible.length - 1, pressed: ce.pressed.includes(stmt.id) },
  };
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

function run(w: Work, chapter: CompiledChapter): void {
  let budget = INSTRUCTION_BUDGET;
  const trace: string[] = [];
  for (;;) {
    const frame = w.frames[w.frames.length - 1];
    if (frame === undefined) throw new ContentError('The call stack is empty: a section ended without exitTo/ending.');
    const block = chapter.blocks[frame.block];
    if (block === undefined) throw new ContentError(`Unknown block "${frame.block}".`);
    const instr = block[frame.ip];
    if (instr === undefined) {
      w.frames.pop();
      if (w.frames.length === 0) throw new ContentError(`Block "${frame.block}" ended without exitTo/ending.`);
      continue;
    }
    budget -= 1;
    trace.push(`${frame.block}#${frame.ip}`);
    if (trace.length > 20) trace.shift();
    if (budget < 0) throw new ContentError(`Instruction budget exceeded (${INSTRUCTION_BUDGET}); last: ${trace.slice(-10).join(' > ')}`);
    if (exec(w, instr, frame, chapter) === 'wait') {
      flushStage(w);
      return;
    }
  }
}

type Outcome = 'continue' | 'wait';

function advanceTop(w: Work): void {
  const top = w.frames[w.frames.length - 1];
  if (top !== undefined) w.frames[w.frames.length - 1] = { block: top.block, ip: top.ip + 1 };
}

function setWait(w: Work, wait: Wait): Outcome {
  w.wait = wait;
  w.waitRev += 1;
  return 'wait';
}

function emit(w: Work, effect: Effect): void {
  flushStage(w);
  w.effects.push(effect);
}

function blocking(w: Work, make: (fxId: number) => Effect): Outcome {
  w.fxSeq += 1;
  emit(w, make(w.fxSeq));
  return setWait(w, { t: 'fx', fxId: w.fxSeq });
}

function changeStage(w: Work, stage: Stage, transition: Transition = 'cut'): void {
  w.stage = stage;
  if (w.pendingStage !== 'fade') w.pendingStage = transition;
}

function flushStage(w: Work): void {
  if (w.pendingStage === null) return;
  w.effects.push({ fx: 'stage', stage: w.stage, transition: w.pendingStage });
  w.pendingStage = null;
}

function courtPositionOf(stage: Stage, char: string): CourtPos | null {
  return COURT_POSITIONS.find((pos) => stage.court[pos]?.char === char) ?? null;
}

function withActorPose(stage: Stage, char: string, pose: string): Stage {
  const pos = courtPositionOf(stage, char);
  if (pos !== null) {
    const current = stage.court[pos];
    return current?.pose === pose ? stage : { ...stage, court: { ...stage.court, [pos]: { char, pose } } };
  }
  if (stage.actor?.char === char && stage.actor.pose !== pose) return { ...stage, actor: { char, pose } };
  return stage;
}

/** Automatic camera: cut to the speaker's bench in court, and apply the pose if one is given. */
function focusSpeaker(w: Work, who: string, pose: string | null): void {
  const pos = courtPositionOf(w.stage, who);
  if (pos !== null && w.stage.place.k === 'court' && w.stage.place.view !== pos) changeStage(w, { ...w.stage, place: { k: 'court', view: pos } });
  if (pose !== null) {
    const next = withActorPose(w.stage, who, pose);
    if (next !== w.stage) changeStage(w, next);
  }
}

function lineEffect(instr: Extract<Instr, { op: 'say' }>, chapter: CompiledChapter): Effect {
  const name = instr.who === null ? null : (chapter.characters[instr.who]?.name ?? instr.who);
  return { fx: 'line', speaker: instr.who, name, tokens: instr.tokens, style: instr.style };
}

function evaluate(cond: Cond, w: Work): boolean {
  if ('not' in cond) return !evaluate(cond.not, w);
  if ('all' in cond) return cond.all.every((c) => evaluate(c, w));
  if ('any' in cond) return cond.any.some((c) => evaluate(c, w));
  if ('has' in cond) return w.record.evidence.includes(cond.has) || w.record.profiles.includes(cond.has);
  const value = w.vars[cond.var];
  if (value === undefined) throw new ContentError(`Unknown variable "${cond.var}" in condition.`);
  switch (cond.op) {
    case '==': return value === cond.value;
    case '!=': return value !== cond.value;
    case '>': return value > cond.value;
    case '>=': return value >= cond.value;
    case '<': return value < cond.value;
    case '<=': return value <= cond.value;
  }
}

function without(items: readonly string[], item: string): string[] {
  return items.filter((i) => i !== item);
}

function execRecord(w: Work, instr: Extract<Instr, { op: 'record' }>, chapter: CompiledChapter): Outcome {
  const { record } = w;
  if (instr.kind === 'evidence') {
    const def = chapter.evidence[instr.id];
    if (def === undefined) throw new ContentError(`Unknown evidence "${instr.id}".`);
    if (instr.act === 'add') w.record = { ...record, evidence: record.evidence.includes(instr.id) ? record.evidence : [...record.evidence, instr.id] };
    else if (instr.act === 'remove') w.record = { ...record, evidence: without(record.evidence, instr.id) };
    else {
      if (instr.variant === null || def.variants?.[instr.variant] === undefined) throw new ContentError(`Evidence "${instr.id}": unknown variant "${instr.variant ?? ''}".`);
      w.record = { ...record, variants: { ...record.variants, [instr.id]: instr.variant } };
    }
  } else {
    if (chapter.profiles[instr.id] === undefined) throw new ContentError(`Unknown profile "${instr.id}".`);
    if (instr.act === 'add') w.record = { ...record, profiles: record.profiles.includes(instr.id) ? record.profiles : [...record.profiles, instr.id] };
    else w.record = { ...record, profiles: without(record.profiles, instr.id) };
  }
  advanceTop(w);
  const effect = { fx: 'record', record: w.record, act: instr.act, kind: instr.kind, item: instr.id } as const;
  // A visible addition or update shows the item to the player (blocking popup); removals and silent changes don't.
  if (!instr.silent && instr.act !== 'remove') return blocking(w, (fxId) => ({ ...effect, fxId }));
  emit(w, effect);
  return 'continue';
}

function execCrossExam(w: Work, instr: Extract<Instr, { op: 'crossExam' }>, chapter: CompiledChapter): Outcome {
  const cx = crossExamOf(chapter, instr.ce);
  const t = testimonyOf(chapter, cx);
  let ce = w.ce[cx.id];
  if (ce === undefined) {
    const first = visibleStatements(chapter, cx, { revealed: [] })[0];
    if (first === undefined) throw new ContentError(`Cross-examination "${cx.id}" has no visible statement.`);
    w.ce[cx.id] = { current: first, revealed: [], amended: {}, pressed: [], after: null };
    focusSpeaker(w, t.witness, null);
    // The instruction is re-entrant: the pointer stays here and the banner's acknowledgement re-runs it.
    return blocking(w, (fxId) => ({ fx: 'banner', kind: 'crossExam', title: t.title, fxId }));
  }
  if (ce.after !== null) {
    const visible = visibleStatements(chapter, cx, ce);
    let current = ce.current;
    switch (ce.after.k) {
      case 'press':
        current = resolvePressResume(ce.after.resume, ce.after.stmt, visible, cx.id);
        break;
      case 'wrong':
        current = ce.after.stmt;
        break;
      case 'loop':
        current = visible[0] ?? current;
        break;
      case 'resume':
        break;
      case 'solution':
        throw new ContentError(`Cross-examination "${cx.id}": a solution body must end with exitTo or resumeCrossExam.`);
    }
    ce = { ...ce, current, after: null };
    w.ce[cx.id] = ce;
  }
  const stmt = t.statements.find((s) => s.id === ce.current);
  focusSpeaker(w, t.witness, stmt?.pose ?? null);
  emit(w, statementLine(chapter, cx, ce));
  return setWait(w, { t: 'ce', ce: cx.id });
}

function exec(w: Work, instr: Instr, frame: Frame, chapter: CompiledChapter): Outcome {
  switch (instr.op) {
    case 'say':
      if (instr.who !== null && instr.style !== 'thought') {
        focusSpeaker(w, instr.who, instr.pose);
      } else if (instr.who !== null && instr.pose !== null) {
        // Thoughts never move the camera; they may still change the thinker's pose.
        const next = withActorPose(w.stage, instr.who, instr.pose);
        if (next !== w.stage) changeStage(w, next);
      }
      emit(w, lineEffect(instr, chapter));
      advanceTop(w);
      return setWait(w, { t: 'line', at: frame });
    case 'show': {
      const actor: Actor = { char: instr.who, pose: instr.pose };
      if (instr.at !== null) {
        const court: Partial<Record<CourtPos, Actor>> = {};
        for (const pos of COURT_POSITIONS) {
          const existing = w.stage.court[pos];
          if (existing !== undefined && existing.char !== instr.who) court[pos] = existing;
        }
        court[instr.at] = actor;
        changeStage(w, { ...w.stage, court });
      } else {
        changeStage(w, { ...w.stage, actor });
      }
      advanceTop(w);
      return 'continue';
    }
    case 'hide': {
      const court: Partial<Record<CourtPos, Actor>> = {};
      for (const pos of COURT_POSITIONS) {
        const existing = w.stage.court[pos];
        if (existing !== undefined && existing.char !== instr.who) court[pos] = existing;
      }
      changeStage(w, { ...w.stage, court, actor: w.stage.actor?.char === instr.who ? null : w.stage.actor });
      advanceTop(w);
      return 'continue';
    }
    case 'pose': {
      const next = withActorPose(w.stage, instr.who, instr.pose);
      if (next !== w.stage) changeStage(w, next);
      advanceTop(w);
      return 'continue';
    }
    case 'court':
    case 'location': {
      const place = instr.op === 'court' ? { k: 'court' as const, view: instr.view } : { k: 'location' as const, place: instr.place };
      advanceTop(w);
      if (instr.transition === 'fade') {
        w.stage = { ...w.stage, place };
        return blocking(w, (fxId) => ({ fx: 'stage', stage: w.stage, transition: 'fade', fxId }));
      }
      changeStage(w, { ...w.stage, place });
      return 'continue';
    }
    case 'music':
      w.stage = { ...w.stage, music: instr.track };
      emit(w, { fx: 'music', track: instr.track, fadeMs: instr.fadeMs });
      advanceTop(w);
      return 'continue';
    case 'sfx':
      emit(w, { fx: 'sfx', sound: instr.sound });
      advanceTop(w);
      return 'continue';
    case 'shake':
    case 'flash':
      advanceTop(w);
      if (instr.wait) return blocking(w, (fxId) => ({ fx: instr.op, ms: instr.ms, fxId }));
      emit(w, { fx: instr.op, ms: instr.ms });
      return 'continue';
    case 'wait':
      advanceTop(w);
      return blocking(w, (fxId) => ({ fx: 'wait', ms: instr.ms, fxId }));
    case 'interjection':
      advanceTop(w);
      return blocking(w, (fxId) => ({ fx: 'interjection', kind: instr.kind, by: instr.by, fxId }));
    case 'set':
      if (!(instr.name in w.vars)) throw new ContentError(`Unknown variable "${instr.name}".`);
      w.vars[instr.name] = instr.value;
      advanceTop(w);
      return 'continue';
    case 'addVar': {
      const current = w.vars[instr.name];
      if (typeof current !== 'number') throw new ContentError(`Variable "${instr.name}" is not numeric.`);
      const value = current + instr.delta;
      w.vars[instr.name] = value;
      emit(w, { fx: 'var', name: instr.name, delta: instr.delta, value, toast: instr.toast });
      advanceTop(w);
      return 'continue';
    }
    case 'if': {
      advanceTop(w);
      const target = evaluate(instr.cond, w) ? instr.then : instr.else;
      if (target !== null) w.frames.push({ block: target, ip: 0 });
      return 'continue';
    }
    case 'exitTo':
      if (!(instr.section in chapter.blocks)) throw new ContentError(`exitTo: unknown section "${instr.section}".`);
      w.frames = [{ block: instr.section, ip: 0 }];
      return 'continue';
    case 'call':
      if (!(instr.section in chapter.blocks)) throw new ContentError(`call: unknown section "${instr.section}".`);
      advanceTop(w);
      w.frames.push({ block: instr.section, ip: 0 });
      return 'continue';
    case 'return':
      w.frames.pop();
      return 'continue';
    case 'ending':
      if (!(instr.id in chapter.endings)) throw new ContentError(`Unknown ending "${instr.id}".`);
      emit(w, { fx: 'ended', ending: instr.id });
      return setWait(w, { t: 'ended', ending: instr.id });
    case 'record':
      return execRecord(w, instr, chapter);
    case 'healthBar':
      w.stage = { ...w.stage, healthBar: instr.visible };
      emit(w, { fx: 'healthBar', visible: instr.visible });
      advanceTop(w);
      return 'continue';
    case 'penalty': {
      advanceTop(w);
      w.health = Math.max(0, w.health - instr.damage);
      const outcome = blocking(w, (fxId) => ({ fx: 'damage', amount: instr.damage, health: w.health, max: chapter.maxHealth, fxId }));
      // At 0 HP the whole stack is abandoned: nothing after the penalty runs; the game-over section follows the damage effect.
      if (w.health <= 0) w.frames = [{ block: chapter.gameOver, ip: 0 }];
      return outcome;
    }
    case 'banner':
      advanceTop(w);
      return blocking(w, (fxId) => ({ fx: 'banner', kind: instr.kind, title: instr.title, fxId }));
    case 'crossExam':
      return execCrossExam(w, instr, chapter);
    case 'reveal': {
      const ce = w.ce[instr.ce];
      if (ce === undefined) throw new ContentError(`reveal: cross-examination "${instr.ce}" has not started.`);
      if (!ce.revealed.includes(instr.stmt)) w.ce[instr.ce] = { ...ce, revealed: [...ce.revealed, instr.stmt] };
      advanceTop(w);
      return 'continue';
    }
    case 'amend': {
      const ce = w.ce[instr.ce];
      if (ce === undefined) throw new ContentError(`amend: cross-examination "${instr.ce}" has not started.`);
      w.ce[instr.ce] = { ...ce, amended: { ...ce.amended, [instr.stmt]: instr.variant } };
      advanceTop(w);
      return 'continue';
    }
    case 'resumeCrossExam':
      // Leave the solution body (and any nested block) back to the cross-examination instruction.
      for (;;) {
        w.frames.pop();
        const top = w.frames[w.frames.length - 1];
        if (top === undefined) throw new ContentError('resumeCrossExam used outside a cross-examination.');
        const at = chapter.blocks[top.block]?.[top.ip];
        if (at?.op === 'crossExam') {
          const ce = w.ce[at.ce];
          if (ce === undefined) throw new ContentError(`resumeCrossExam: cross-examination "${at.ce}" has no state.`);
          w.ce[at.ce] = { ...ce, after: { k: 'resume' } };
          return 'continue';
        }
      }
    case 'verdict':
      advanceTop(w);
      return blocking(w, (fxId) => ({ fx: 'verdict', text: instr.text, fxId }));
  }
}
