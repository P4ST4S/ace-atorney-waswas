import { plainText } from './text.ts';
import type { CompiledChapter, Cond, Instr, TextToken } from './types.ts';

export interface Issue {
  readonly level: 'error' | 'warning';
  readonly where: string;
  readonly message: string;
}

/** Knowledge outside the engine (asset aliases, rig poses) supplied by the caller. */
export interface ValidationContext {
  readonly sounds?: ReadonlySet<string>;
  readonly images?: ReadonlySet<string>;
  readonly places?: ReadonlySet<string>;
  /** Rig id -> available rig pose ids. */
  readonly rigPoses?: Readonly<Record<string, readonly string[]>>;
}

/** Heuristic: beyond this many characters a line is likely to overflow the text box. */
export const MAX_LINE_LENGTH = 120;

/** Instructions after which a section cannot fall through (a cross-examination only exits through `exitTo`). */
const TERMINAL_OPS = new Set<Instr['op']>(['exitTo', 'ending', 'crossExam']);
const SOLUTION_END_OPS = new Set<Instr['op']>(['exitTo', 'resumeCrossExam', 'ending']);

/**
 * Static validation: structure and references. It guarantees that a *declared* solution exists, not that it is
 * reachable with the evidence actually obtainable — that is what deterministic playthrough tests prove.
 */
export function validateChapter(chapter: CompiledChapter, ctx: ValidationContext = {}): Issue[] {
  const issues: Issue[] = [];
  const error = (where: string, message: string): void => {
    issues.push({ level: 'error', where, message });
  };
  const warn = (where: string, message: string): void => {
    issues.push({ level: 'warning', where, message });
  };
  const sections = new Set(chapter.sections);
  const items = new Set([...Object.keys(chapter.evidence), ...Object.keys(chapter.profiles)]);

  const checkSound = (where: string, sound: string): void => {
    if (ctx.sounds !== undefined && !ctx.sounds.has(sound)) error(where, `unknown sound "${sound}"`);
  };
  const checkImage = (where: string, image: string): void => {
    if (ctx.images !== undefined && !ctx.images.has(image)) error(where, `unknown image "${image}"`);
  };
  const checkChar = (where: string, who: string, pose?: string | null): void => {
    const def = chapter.characters[who];
    if (def === undefined) {
      error(where, `unknown character "${who}"`);
      return;
    }
    if (pose !== undefined && pose !== null && !(pose in def.poses)) error(where, `character "${who}" has no pose "${pose}"`);
  };
  const checkTokens = (where: string, tokens: readonly TextToken[]): void => {
    for (const token of tokens) if (token.t === 'sfx') checkSound(where, token.sound);
    const length = plainText(tokens).length;
    if (length > MAX_LINE_LENGTH) warn(where, `line is ${length} characters long (> ${MAX_LINE_LENGTH}): it may overflow the text box`);
  };
  const checkCond = (where: string, cond: Cond): void => {
    if ('not' in cond) checkCond(where, cond.not);
    else if ('all' in cond) cond.all.forEach((c) => { checkCond(where, c); });
    else if ('any' in cond) cond.any.forEach((c) => { checkCond(where, c); });
    else if ('has' in cond) { if (!items.has(cond.has)) error(where, `unknown Court Record item "${cond.has}"`); }
    else if (!(cond.var in chapter.vars)) error(where, `unknown variable "${cond.var}"`);
  };

  // Chapter-level references.
  if (!sections.has(chapter.start)) error('chapter', `start section "${chapter.start}" does not exist`);
  if (!sections.has(chapter.gameOver)) error('chapter', `game-over section "${chapter.gameOver}" does not exist`);
  checkChar('chapter', chapter.player.char);

  for (const [id, def] of Object.entries(chapter.characters)) {
    const rigPoses = ctx.rigPoses?.[def.sprite];
    if (ctx.rigPoses !== undefined && rigPoses === undefined) error(`character ${id}`, `unknown sprite rig "${def.sprite}"`);
    for (const [pose, rigPose] of Object.entries(def.poses)) {
      if (rigPoses !== undefined && !rigPoses.includes(rigPose)) error(`character ${id}`, `pose "${pose}" maps to missing rig pose "${def.sprite}/${rigPose}"`);
    }
    for (const voice of Object.values(def.voices)) if (typeof voice === 'string') checkSound(`character ${id}`, voice);
  }
  for (const [id, def] of Object.entries(chapter.evidence)) {
    checkImage(`evidence ${id}`, def.icon);
    if (def.detail !== undefined) checkImage(`evidence ${id}`, def.detail);
    for (const variant of Object.values(def.variants ?? {})) {
      if (variant.icon !== undefined) checkImage(`evidence ${id}`, variant.icon);
      if (variant.detail !== undefined) checkImage(`evidence ${id}`, variant.detail);
    }
  }
  for (const [id, def] of Object.entries(chapter.profiles)) {
    checkChar(`profile ${id}`, id);
    checkImage(`profile ${id}`, def.portrait);
  }
  for (const t of Object.values(chapter.testimonies)) {
    checkChar(`testimony ${t.id}`, t.witness);
    for (const s of t.statements) {
      checkChar(`testimony ${t.id}/${s.id}`, t.witness, s.pose);
      checkTokens(`testimony ${t.id}/${s.id}`, s.tokens);
    }
  }

  // Instructions.
  const revealed = new Set<string>();
  const callTargets = new Set<string>();
  for (const [blockId, instrs] of Object.entries(chapter.blocks)) {
    instrs.forEach((instr, index) => {
      const where = `${blockId}#${index}`;
      switch (instr.op) {
        case 'say':
          if (instr.who !== null) checkChar(where, instr.who, instr.pose);
          checkTokens(where, instr.tokens);
          break;
        case 'show':
        case 'pose':
          checkChar(where, instr.who, instr.pose);
          break;
        case 'hide':
          checkChar(where, instr.who);
          break;
        case 'location':
          if (ctx.places !== undefined && !ctx.places.has(instr.place)) error(where, `unknown place "${instr.place}"`);
          break;
        case 'music':
          if (instr.track !== null) checkSound(where, instr.track);
          break;
        case 'sfx':
          checkSound(where, instr.sound);
          break;
        case 'interjection': {
          checkChar(where, instr.by);
          const voice = chapter.characters[instr.by]?.voices[instr.kind];
          if (voice === undefined || voice === null) warn(where, `"${instr.by}" has no voice for "${instr.kind}" (no voice will play)`);
          break;
        }
        case 'set':
          if (!(instr.name in chapter.vars)) error(where, `unknown variable "${instr.name}"`);
          break;
        case 'addVar':
          if (typeof chapter.vars[instr.name]?.init !== 'number') error(where, `"${instr.name}" is not a numeric variable`);
          break;
        case 'if':
          checkCond(where, instr.cond);
          break;
        case 'exitTo':
          if (!sections.has(instr.section)) error(where, `exitTo: unknown section "${instr.section}"`);
          break;
        case 'call':
          if (!sections.has(instr.section)) error(where, `call: unknown section "${instr.section}"`);
          callTargets.add(instr.section);
          break;
        case 'ending':
          if (!(instr.id in chapter.endings)) error(where, `unknown ending "${instr.id}"`);
          break;
        case 'record':
          if (instr.kind === 'evidence') {
            const def = chapter.evidence[instr.id];
            if (def === undefined) error(where, `unknown evidence "${instr.id}"`);
            else if (instr.act === 'update' && (instr.variant === null || def.variants?.[instr.variant] === undefined)) error(where, `evidence "${instr.id}" has no variant "${instr.variant ?? ''}"`);
          } else if (!(instr.id in chapter.profiles)) error(where, `unknown profile "${instr.id}"`);
          break;
        case 'crossExam': {
          const cx = chapter.crossExams[instr.ce];
          if (cx === undefined) {
            error(where, `unknown cross-examination "${instr.ce}"`);
            break;
          }
          const t = chapter.testimonies[cx.testimony];
          if (t === undefined) {
            error(where, `cross-examination "${cx.id}": unknown testimony "${cx.testimony}"`);
            break;
          }
          const stmtIds = new Set(t.statements.map((s) => s.id));
          const checkStmt = (what: string, stmt: string): void => {
            if (!stmtIds.has(stmt)) error(where, `cross-examination "${cx.id}": ${what} refers to unknown statement "${stmt}"`);
          };
          for (const [stmt, press] of Object.entries(cx.press)) {
            checkStmt('press', stmt);
            if (typeof press.resume === 'object') checkStmt('press resume', press.resume.to);
          }
          for (const s of t.statements) {
            if (!(s.id in cx.press)) warn(where, `cross-examination "${cx.id}": statement "${s.id}" has no press conversation`);
          }
          if (cx.solutions.length === 0) error(where, `cross-examination "${cx.id}" has no solution`);
          for (const solution of cx.solutions) {
            solution.stmts.forEach((stmt) => { checkStmt('solution', stmt); });
            for (const item of solution.items) if (!items.has(item)) error(where, `cross-examination "${cx.id}": unknown solution item "${item}"`);
            const last = chapter.blocks[solution.block]?.at(-1);
            if (last === undefined || !SOLUTION_END_OPS.has(last.op)) error(solution.block, `cross-examination "${cx.id}": a solution must end with exitTo or resumeCrossExam`);
          }
          Object.keys(cx.wrongAt).forEach((stmt) => { checkStmt('wrongAt', stmt); });
          break;
        }
        case 'reveal':
        case 'amend': {
          const cx = chapter.crossExams[instr.ce];
          const t = cx === undefined ? undefined : chapter.testimonies[cx.testimony];
          const stmt = t?.statements.find((s) => s.id === instr.stmt);
          if (stmt === undefined) error(where, `${instr.op}: unknown statement "${instr.ce}/${instr.stmt}"`);
          else if (instr.op === 'reveal') {
            if (!stmt.hidden) warn(where, `reveal: statement "${instr.stmt}" is not hidden`);
            revealed.add(`${instr.ce}/${instr.stmt}`);
          } else if (!(instr.variant in stmt.variants)) error(where, `amend: statement "${instr.stmt}" has no variant "${instr.variant}"`);
          break;
        }
        case 'wait':
        case 'court':
        case 'shake':
        case 'flash':
        case 'return':
        case 'healthBar':
        case 'penalty':
        case 'banner':
        case 'resumeCrossExam':
        case 'verdict':
          break;
      }
    });
  }

  for (const cx of Object.values(chapter.crossExams)) {
    const t = chapter.testimonies[cx.testimony];
    for (const s of t?.statements ?? []) {
      if (s.hidden && !revealed.has(`${cx.id}/${s.id}`)) warn(`cross-examination ${cx.id}`, `hidden statement "${s.id}" is never revealed`);
    }
  }

  // Sections must not fall off their end (except call targets, which return to their caller).
  for (const id of chapter.sections) {
    const last = chapter.blocks[id]?.at(-1);
    if (!callTargets.has(id) && (last === undefined || !TERMINAL_OPS.has(last.op))) error(id, 'section ends without exitTo or ending');
  }

  // Reachability from the start and game-over sections.
  const reachable = new Set<string>();
  const visit = (blockId: string): void => {
    if (reachable.has(blockId)) return;
    reachable.add(blockId);
    for (const instr of chapter.blocks[blockId] ?? []) {
      if (instr.op === 'exitTo' || instr.op === 'call') visit(instr.section);
      else if (instr.op === 'if') {
        visit(instr.then);
        if (instr.else !== null) visit(instr.else);
      } else if (instr.op === 'crossExam') {
        const cx = chapter.crossExams[instr.ce];
        if (cx === undefined) continue;
        for (const p of Object.values(cx.press)) visit(p.block);
        for (const s of cx.solutions) visit(s.block);
        visit(cx.wrong);
        for (const b of Object.values(cx.wrongAt)) visit(b);
        if (cx.loop !== null) visit(cx.loop);
      }
    }
  };
  if (sections.has(chapter.start)) visit(chapter.start);
  if (sections.has(chapter.gameOver)) visit(chapter.gameOver);
  for (const id of chapter.sections) if (!reachable.has(id)) warn(id, 'section is unreachable from the start');

  return issues;
}
