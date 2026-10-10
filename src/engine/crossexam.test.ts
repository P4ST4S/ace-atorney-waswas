/**
 * One test per rule of the cross-examination contract (docs/ARCHITECTURE.md §9).
 */
import { describe, expect, it } from 'vitest';
import { compileChapter } from './compile.ts';
import { startChapter, step } from './step.ts';
import { plainText } from './text.ts';
import {
  ContentError, type ChapterSource, type CompiledChapter, type CrossExamSource, type Effect, type EngineState, type PlayerInput, type SourceCommand,
} from './types.ts';

const say = (who: string | null, text: string): SourceCommand => ({ op: 'say', who, text });

function chapterWith(ce: Partial<CrossExamSource> = {}, extra: { after?: readonly SourceCommand[]; maxHealth?: number } = {}): CompiledChapter {
  const spec: CrossExamSource = {
    id: 'ce',
    testimony: 't',
    press: {
      s1: { body: [say('mimi', 'Presse s1')] },
      s2: { body: [say('mimi', 'Presse s2'), { op: 'reveal', ce: 'ce', stmt: 's2b' }] },
      s2b: { body: [say('mimi', 'Presse s2b')] },
      s3: { body: [say('mimi', 'Presse s3')] },
    },
    solutions: [{ stmts: ['s3', 's2b'], items: ['capture'], body: [say('mimi', 'Contradiction !'), { op: 'exitTo', section: 'apres' }] }],
    wrong: [say('juge', 'Hors sujet.'), { op: 'addVar', name: 'exp', delta: 10 }, { op: 'penalty', damage: 20 }, say(null, 'jamais à 0 PV')],
    ...ce,
  };
  const source: ChapterSource = {
    id: 'ce-test', title: 'CE', contentRevision: 1, start: 'start', gameOver: 'perdu', maxHealth: extra.maxHealth ?? 100,
    player: { char: 'mimi', bench: 'prosecution' },
    characters: {
      mimi: { name: 'Mimi', sprite: 'miles-edgeworth', poses: { normal: 'normal' }, blip: 'male', voices: {} },
      juge: { name: 'Le Juge', sprite: 'judges', poses: { normal: 'normal' }, blip: 'male', voices: {} },
      wassim: { name: 'Wassim', sprite: 'ron-delite', poses: { normal: 'normal', sueur: 'nervous' }, blip: 'male', voices: {} },
    },
    vars: { exp: { init: 0 } },
    evidence: {
      capture: { name: 'Capture', description: 'Messages', icon: 'evidence.demo-capture', detail: 'evidence.demo-capture', variants: { annotee: { description: 'Annotée' } } },
      badge: { name: 'Badge', description: 'Badge', icon: 'evidence.demo-badge' },
    },
    profiles: { wassim: { description: "L'accusé.", portrait: 'portrait.wassim' } },
    testimonies: {
      t: {
        id: 't', title: 'La soirée', witness: 'wassim',
        statements: [
          { id: 's1', text: 'Rentré à 21 h.' },
          { id: 's2', pose: 'sueur', text: 'Téléphone à plat.' },
          { id: 's2b', text: 'Éteint vers 22 h.', hidden: true },
          { id: 's3', text: 'Aucun message.', variants: { corrige: 'Peut-être un message…' } },
        ],
      },
    },
    sections: {
      start: [
        { op: 'show', who: 'wassim', pose: 'normal', at: 'witness' },
        { op: 'show', who: 'mimi', pose: 'normal', at: 'prosecution' },
        { op: 'court', view: 'witness' },
        { op: 'evidence', act: 'add', id: 'capture', silent: true },
        { op: 'evidence', act: 'add', id: 'badge', silent: true },
        { op: 'crossExam', spec },
      ],
      apres: [...(extra.after ?? []), say(null, 'Après le contre-interrogatoire'), { op: 'ending', id: 'fin' }],
      perdu: [say('juge', 'Non coupable !'), { op: 'ending', id: 'acquitte' }],
    },
    endings: { fin: { title: 'Fin', tone: 'win' }, acquitte: { title: 'Acquitté', tone: 'lose' } },
  };
  return compileChapter(source);
}

/** Drives the engine like the Director would, acknowledging every blocking effect. */
class Driver {
  state: EngineState;
  effects: Effect[] = [];
  private readonly chapter: CompiledChapter;

  constructor(chapter: CompiledChapter) {
    this.chapter = chapter;
    const r = startChapter(chapter);
    if (!r.ok) throw new Error('start rejected');
    this.state = r.state;
    this.collect(r.effects);
  }

  /** Sends an input with the current revision, then acknowledges blocking effects until a player wait. */
  send(input: { t: 'advance' } | { t: 'cePrev' } | { t: 'press' } | { t: 'present'; item: string }): Effect[] {
    const full: PlayerInput = { ...input, rev: this.state.waitRev };
    const r = step(this.state, full, this.chapter);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    this.effects = [];
    this.state = r.state;
    this.collect(r.effects);
    return this.effects;
  }

  get current(): string | undefined {
    return this.state.ce.ce?.current;
  }

  lines(): string[] {
    return this.effects.flatMap((e) => (e.fx === 'line' ? [plainText(e.tokens)] : []));
  }

  private collect(effects: readonly Effect[]): void {
    this.effects.push(...effects);
    while (this.state.wait.t === 'fx') {
      const r = step(this.state, { t: 'fxEnd', fxId: this.state.wait.fxId, outcome: 'done' }, this.chapter);
      if (!r.ok) throw new Error(`fxEnd rejected: ${r.reason}`);
      this.state = r.state;
      this.effects.push(...r.effects);
    }
  }
}

describe('cross-examination contract', () => {
  it('entry: shows the banner first, then the first visible statement, and stores the current statement by id', () => {
    const d = new Driver(chapterWith());
    expect(d.effects.map((e) => e.fx)).toContain('banner');
    expect(d.state.wait).toEqual({ t: 'ce', ce: 'ce' });
    expect(d.current).toBe('s1');
    const line = d.effects.at(-1);
    expect(line?.fx === 'line' ? line.ce : null).toEqual({ id: 'ce', stmt: 's1', isFirst: true, isLast: false, pressed: false });
  });

  it('visible order: hidden statements are skipped until revealed', () => {
    const d = new Driver(chapterWith());
    d.send({ t: 'advance' });
    expect(d.current).toBe('s2');
    d.send({ t: 'advance' });
    expect(d.current).toBe('s3');
  });

  it('next on the last statement plays the loop body, then returns to the first statement', () => {
    const d = new Driver(chapterWith({ loop: [say('juge', 'On reprend depuis le début.')] }));
    d.send({ t: 'advance' });
    d.send({ t: 'advance' });
    expect(d.current).toBe('s3');
    d.send({ t: 'advance' });
    expect(d.lines()).toEqual(['On reprend depuis le début.']);
    d.send({ t: 'advance' });
    expect(d.current).toBe('s1');
  });

  it('previous on the first statement is rejected; otherwise it goes back', () => {
    const d = new Driver(chapterWith());
    expect(step(d.state, { t: 'cePrev', rev: d.state.waitRev }, chapterWith())).toMatchObject({ ok: false, reason: 'first-statement' });
    d.send({ t: 'advance' });
    d.send({ t: 'cePrev' });
    expect(d.current).toBe('s1');
  });

  it('press: player "Hold it!" first, then the press body, then the next visible statement', () => {
    const d = new Driver(chapterWith());
    const effects = d.send({ t: 'press' });
    expect(effects[0]).toMatchObject({ fx: 'interjection', kind: 'holdit', by: 'mimi' });
    expect(d.lines()).toEqual(['Presse s1']);
    d.send({ t: 'advance' });
    expect(d.current).toBe('s2');
    expect(d.state.ce.ce?.pressed).toEqual(['s1']);
  });

  it('press with resume "same" or { to } overrides the default', () => {
    const same = new Driver(chapterWith({ press: { s1: { body: [say('mimi', 'p')], resume: 'same' } } }));
    same.send({ t: 'press' });
    same.send({ t: 'advance' });
    expect(same.current).toBe('s1');
    const to = new Driver(chapterWith({ press: { s1: { body: [say('mimi', 'p')], resume: { to: 's3' } } } }));
    to.send({ t: 'press' });
    to.send({ t: 'advance' });
    expect(to.current).toBe('s3');
  });

  it('reveal: the revealed statement appears at its written position and is selected after the press', () => {
    const d = new Driver(chapterWith());
    d.send({ t: 'advance' });
    d.send({ t: 'press' });
    d.send({ t: 'advance' });
    expect(d.current).toBe('s2b');
    d.send({ t: 'advance' });
    expect(d.current).toBe('s3');
    d.send({ t: 'cePrev' });
    expect(d.current).toBe('s2b');
  });

  it('amend: replaces the statement text without moving it', () => {
    const d = new Driver(chapterWith({ press: { s1: { body: [{ op: 'amend', ce: 'ce', stmt: 's3', variant: 'corrige' }], resume: { to: 's3' } } } }));
    d.send({ t: 'press' });
    expect(d.current).toBe('s3');
    expect(d.lines().at(-1)).toBe('Peut-être un message…');
  });

  it('wrong evidence: objection, wrong body with a single penalty, then back to the same statement', () => {
    const d = new Driver(chapterWith());
    d.send({ t: 'advance' });
    const effects = d.send({ t: 'present', item: 'badge' });
    expect(effects[0]).toMatchObject({ fx: 'interjection', kind: 'objection', by: 'mimi' });
    expect(d.lines()).toEqual(['Hors sujet.']);
    const after = d.send({ t: 'advance' });
    expect(after.filter((e) => e.fx === 'damage')).toHaveLength(1);
    expect(d.state.health).toBe(80);
    expect(d.state.vars.exp).toBe(10);
    expect(d.lines()).toEqual(['jamais à 0 PV']);
    d.send({ t: 'advance' });
    expect(d.current).toBe('s2');
  });

  it('wrongAt overrides the default wrong body for a statement', () => {
    const d = new Driver(chapterWith({ wrongAt: { s1: [say('phoenix', 'Ça ne prouve rien.')] } }));
    d.send({ t: 'present', item: 'badge' });
    expect(d.lines()).toEqual(['Ça ne prouve rien.']);
  });

  it('correct evidence: objection, solution body, and exitTo leaves the cross-examination', () => {
    const d = new Driver(chapterWith());
    d.send({ t: 'advance' });
    d.send({ t: 'advance' });
    const effects = d.send({ t: 'present', item: 'capture' });
    expect(effects[0]).toMatchObject({ fx: 'interjection', kind: 'objection' });
    expect(d.lines()).toEqual(['Contradiction\u202F!']);
    d.send({ t: 'advance' });
    expect(d.lines()).toEqual(['Après le contre-interrogatoire']);
    expect(d.state.frames).toEqual([{ block: 'apres', ip: 1 }]);
  });

  it('resumeCrossExam returns to the same statement after the solution', () => {
    const d = new Driver(chapterWith({ solutions: [{ stmts: ['s1'], items: ['capture'], body: [say('mimi', 'Partiel'), { op: 'resumeCrossExam' }] }] }));
    d.send({ t: 'present', item: 'capture' });
    d.send({ t: 'advance' });
    expect(d.state.wait).toEqual({ t: 'ce', ce: 'ce' });
    expect(d.current).toBe('s1');
  });

  it('a solution falling off its end is a content error', () => {
    const d = new Driver(chapterWith({ solutions: [{ stmts: ['s1'], items: ['capture'], body: [say('mimi', 'Oubli')] }] }));
    d.send({ t: 'present', item: 'capture' });
    expect(() => d.send({ t: 'advance' })).toThrow(ContentError);
  });

  it('0 HP inside a body abandons the whole stack and continues at the game-over section', () => {
    const d = new Driver(chapterWith({}, { maxHealth: 20 }));
    d.send({ t: 'present', item: 'badge' });
    d.send({ t: 'advance' });
    expect(d.state.health).toBe(0);
    expect(d.lines()).toEqual(['Non coupable\u202F!']);
    expect(d.lines()).not.toContain('jamais à 0 PV');
    d.send({ t: 'advance' });
    expect(d.state.wait).toEqual({ t: 'ended', ending: 'acquitte' });
  });

  it('presenting an item that is not in the Court Record is rejected', () => {
    const d = new Driver(chapterWith());
    expect(step(d.state, { t: 'present', item: 'inconnu', rev: d.state.waitRev }, chapterWith())).toMatchObject({ ok: false, reason: 'not-in-record' });
  });

  it('inputs with a stale revision are rejected during a cross-examination', () => {
    const d = new Driver(chapterWith());
    const rev = d.state.waitRev;
    d.send({ t: 'advance' });
    expect(step(d.state, { t: 'press', rev }, chapterWith())).toMatchObject({ ok: false, reason: 'stale-rev' });
  });
});
