import { parseMarkup } from './text.ts';
import {
  ContentError,
  type ChapterSource,
  type CompiledChapter,
  type CompiledCrossExam,
  type CompiledTestimony,
  type Instr,
  type SourceCommand,
  type TextToken,
} from './types.ts';

/**
 * Compiles a chapter source:
 * - nested bodies (if/else, press conversations, answers…) are hoisted into named blocks run as calls;
 * - testimonies are expanded into a banner and statement lines;
 * - text is parsed into tokens and typographically normalised;
 * - the save-compatibility hash is computed.
 *
 * Block ids derive from positions (e.g. `proces#3/press:s2`): they change when commands are inserted,
 * which is acceptable because saves are only restored when `compat` is identical.
 */
export function compileChapter(source: ChapterSource): CompiledChapter {
  const blocks: Record<string, Instr[]> = {};
  const crossExams: Record<string, CompiledCrossExam> = {};
  const testimonies: Record<string, CompiledTestimony> = {};

  for (const [id, t] of Object.entries(source.testimonies)) {
    if (t.id !== id) throw new ContentError(`Testimony key "${id}" does not match its id "${t.id}".`);
    testimonies[id] = {
      id,
      title: t.title,
      witness: t.witness,
      statements: t.statements.map((s) => ({
        id: s.id,
        pose: s.pose ?? null,
        tokens: parseMarkup(s.text, `${id}/${s.id}`),
        hidden: s.hidden ?? false,
        variants: Object.fromEntries(Object.entries(s.variants ?? {}).map(([k, text]) => [k, parseMarkup(text, `${id}/${s.id}/${k}`)])),
      })),
    };
  }

  const compileBlock = (blockId: string, commands: readonly SourceCommand[]): void => {
    if (blockId in blocks) throw new ContentError(`Duplicate block id: ${blockId}`);
    const out: Instr[] = [];
    blocks[blockId] = out;
    commands.forEach((cmd, index) => {
      const where = `${blockId}#${index}`;
      const hoist = (suffix: string, body: readonly SourceCommand[]): string => {
        const id = `${where}/${suffix}`;
        compileBlock(id, body);
        return id;
      };
      out.push(...compileCommand(cmd, where, hoist, testimonies, crossExams));
    });
  };

  for (const [sectionId, commands] of Object.entries(source.sections)) compileBlock(sectionId, commands);

  return {
    id: source.id,
    title: source.title,
    start: source.start,
    gameOver: source.gameOver,
    maxHealth: source.maxHealth,
    player: source.player,
    characters: source.characters,
    vars: source.vars,
    evidence: source.evidence,
    profiles: source.profiles,
    endings: source.endings,
    testimonies,
    crossExams,
    blocks,
    sections: Object.keys(source.sections),
    compat: compatHash(source.contentRevision, blocks, testimonies, crossExams),
  };
}

type Hoist = (suffix: string, body: readonly SourceCommand[]) => string;

function compileCommand(
  cmd: SourceCommand,
  where: string,
  hoist: Hoist,
  testimonies: Readonly<Record<string, CompiledTestimony>>,
  crossExams: Record<string, CompiledCrossExam>,
): Instr[] {
  switch (cmd.op) {
    case 'say':
      return [{ op: 'say', who: cmd.who, pose: cmd.pose ?? null, tokens: parseMarkup(cmd.text, where), style: cmd.thought === true ? 'thought' : 'dialogue' }];
    case 'show':
      return [{ op: 'show', who: cmd.who, pose: cmd.pose, at: cmd.at ?? null }];
    case 'court':
      return [{ op: 'court', view: cmd.view, transition: cmd.transition ?? 'cut' }];
    case 'location':
      return [{ op: 'location', place: cmd.place, transition: cmd.transition ?? 'cut' }];
    case 'music':
      return [{ op: 'music', track: cmd.track, fadeMs: cmd.fadeMs ?? 0 }];
    case 'shake':
      return [{ op: 'shake', ms: cmd.ms ?? 400, wait: cmd.wait ?? false }];
    case 'flash':
      return [{ op: 'flash', ms: cmd.ms ?? 200, wait: cmd.wait ?? false }];
    case 'addVar':
      return [{ op: 'addVar', name: cmd.name, delta: cmd.delta, toast: cmd.toast ?? null }];
    case 'if':
      return [{ op: 'if', cond: cmd.cond, then: hoist('then', cmd.then), else: cmd.else === undefined ? null : hoist('else', cmd.else) }];
    case 'evidence':
      return [{ op: 'record', act: cmd.act, kind: 'evidence', id: cmd.id, variant: cmd.act === 'update' ? cmd.variant : null, silent: cmd.silent ?? false }];
    case 'profile':
      return [{ op: 'record', act: cmd.act, kind: 'profile', id: cmd.id, variant: null, silent: cmd.silent ?? false }];
    case 'testimony': {
      const t = testimonies[cmd.testimony];
      if (t === undefined) throw new ContentError(`${where}: unknown testimony "${cmd.testimony}".`);
      return [
        { op: 'banner', kind: 'testimony', title: t.title },
        ...t.statements.filter((s) => !s.hidden).map((s): Instr => ({ op: 'say', who: t.witness, pose: s.pose, tokens: s.tokens, style: 'testimony' })),
      ];
    }
    case 'crossExam': {
      const spec = cmd.spec;
      if (spec.id in crossExams) throw new ContentError(`${where}: duplicate cross-examination id "${spec.id}".`);
      crossExams[spec.id] = {
        id: spec.id,
        testimony: spec.testimony,
        press: Object.fromEntries(Object.entries(spec.press).map(([stmt, p]) => [stmt, { block: hoist(`press:${stmt}`, p.body), resume: p.resume ?? 'next' }])),
        solutions: spec.solutions.map((s, i) => ({ stmts: s.stmts, items: s.items, block: hoist(`solution:${i}`, s.body) })),
        wrong: hoist('wrong', spec.wrong),
        wrongAt: Object.fromEntries(Object.entries(spec.wrongAt ?? {}).map(([stmt, body]) => [stmt, hoist(`wrong:${stmt}`, body)])),
        loop: spec.loop === undefined ? null : hoist('loop', spec.loop),
      };
      return [{ op: 'crossExam', ce: spec.id }];
    }
    case 'hide':
    case 'pose':
    case 'sfx':
    case 'wait':
    case 'interjection':
    case 'set':
    case 'exitTo':
    case 'call':
    case 'return':
    case 'ending':
    case 'healthBar':
    case 'penalty':
    case 'reveal':
    case 'amend':
    case 'resumeCrossExam':
    case 'verdict':
      return [cmd];
  }
}

/** Structural projection of a token: displayed words are dropped, everything else is kept. */
function structuralToken(token: TextToken): unknown {
  return token.t === 'text' ? { t: 'text', color: token.color } : token;
}

function structuralInstr(instr: Instr): unknown {
  return instr.op === 'say' ? { ...instr, tokens: instr.tokens.map(structuralToken) } : instr;
}

function compatHash(
  contentRevision: number,
  blocks: Readonly<Record<string, readonly Instr[]>>,
  testimonies: Readonly<Record<string, CompiledTestimony>>,
  crossExams: Readonly<Record<string, CompiledCrossExam>>,
): string {
  const sorted = <T>(record: Readonly<Record<string, T>>): [string, T][] => Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
  const projection = {
    blocks: sorted(blocks).map(([id, instrs]) => [id, instrs.map(structuralInstr)]),
    testimonies: sorted(testimonies).map(([id, t]) => [id, t.witness, t.statements.map((s) => [s.id, s.pose, s.hidden, s.tokens.map(structuralToken), Object.keys(s.variants).sort()])]),
    crossExams: sorted(crossExams),
  };
  return `r${contentRevision}-${cyrb53(JSON.stringify(projection)).toString(36)}`;
}

/** cyrb53: small, fast, well-distributed 53-bit string hash (no crypto needed for compatibility checks). */
function cyrb53(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
