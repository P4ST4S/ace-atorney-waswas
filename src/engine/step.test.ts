import { describe, expect, it } from 'vitest';
import { compileChapter } from './compile.ts';
import { hydrate, INSTRUCTION_BUDGET, startChapter, step } from './step.ts';
import { plainText } from './text.ts';
import { ContentError, type ChapterSource, type CompiledChapter, type Effect, type EngineState, type SourceCommand, type StepResult } from './types.ts';

function chapter(sections: Record<string, readonly SourceCommand[]>, extra: Partial<ChapterSource> = {}): ChapterSource {
  return {
    id: 'test',
    title: 'Test',
    contentRevision: 1,
    start: 'start',
    gameOver: 'start',
    maxHealth: 100,
    player: { char: 'mimi', bench: 'prosecution' },
    characters: {
      juge: { name: 'Le Juge', sprite: 'judges', poses: { normal: 'normal' }, blip: 'male', voices: {} },
      mimi: { name: 'Mimi', sprite: 'miles-edgeworth', poses: { normal: 'normal' }, blip: 'male', voices: { objection: 'voice.x' } },
      wassim: { name: 'Wassim', sprite: 'ron-delite', poses: { normal: 'normal', sueur: 'nervous' }, blip: 'male', voices: {} },
    },
    vars: { exp: { init: 0 }, flag: { init: false } },
    evidence: {},
    profiles: {},
    testimonies: {},
    endings: { coupable: { title: 'Coupable', tone: 'win' } },
    sections,
    ...extra,
  };
}

type Ok = Extract<StepResult, { ok: true }>;

function ok(result: StepResult): Ok {
  if (!result.ok) throw new Error(`Rejected: ${result.reason}`);
  return result;
}

function lines(effects: readonly Effect[]): string[] {
  return effects.flatMap((e) => (e.fx === 'line' ? [plainText(e.tokens)] : []));
}

function advance(state: EngineState, compiled: CompiledChapter): Ok {
  return ok(step(state, { t: 'advance', rev: state.waitRev }, compiled));
}

describe('engine: dialogue loop', () => {
  const compiled = compileChapter(chapter({
    start: [
      { op: 'show', who: 'juge', pose: 'normal', at: 'judge' },
      { op: 'show', who: 'wassim', pose: 'normal', at: 'witness' },
      { op: 'court', view: 'judge' },
      { op: 'music', track: 'music.court-in-session' },
      { op: 'say', who: 'juge', text: "L'audience est ouverte." },
      { op: 'say', who: 'wassim', pose: 'sueur', text: "Je n'ai rien fait !" },
      { op: 'interjection', kind: 'objection', by: 'mimi' },
      { op: 'addVar', name: 'exp', delta: 10, toast: 'Wassim gagne 10 EXP !' },
      {
        op: 'if',
        cond: { var: 'exp', op: '>=', value: 10 },
        then: [{ op: 'say', who: null, text: 'Branche vraie' }],
        else: [{ op: 'say', who: null, text: 'Branche fausse' }],
      },
      { op: 'ending', id: 'coupable' },
    ],
  }));

  it('runs until the first line and emits stage, music and line effects in order', () => {
    const r = ok(startChapter(compiled));
    expect(r.effects.map((e) => e.fx)).toEqual(['stage', 'music', 'line']);
    expect(lines(r.effects)).toEqual(["L'audience est ouverte."]);
    expect(r.state.wait).toEqual({ t: 'line', at: { block: 'start', ip: 4 } });
    expect(r.state.stage.place).toEqual({ k: 'court', view: 'judge' });
    expect(r.state.waitRev).toBe(1);
  });

  it('cuts the camera to the speaker and applies the pose', () => {
    const second = advance(ok(startChapter(compiled)).state, compiled);
    const stage = second.effects.find((e) => e.fx === 'stage');
    expect(stage?.fx === 'stage' ? stage.stage.place : null).toEqual({ k: 'court', view: 'witness' });
    expect(second.state.stage.court.witness).toEqual({ char: 'wassim', pose: 'sueur' });
  });

  it('waits for blocking effects and only accepts the matching fx id', () => {
    let s = advance(advance(ok(startChapter(compiled)).state, compiled).state, compiled);
    expect(s.effects.at(-1)?.fx).toBe('interjection');
    if (s.state.wait.t !== 'fx') throw new Error('expected an fx wait');
    const fxId = s.state.wait.fxId;
    expect(step(s.state, { t: 'fxEnd', fxId: fxId + 1, outcome: 'done' }, compiled)).toMatchObject({ ok: false, reason: 'wrong-fx-id' });
    expect(step(s.state, { t: 'advance', rev: s.state.waitRev }, compiled)).toMatchObject({ ok: false, reason: 'not-waiting-for-line' });
    s = ok(step(s.state, { t: 'fxEnd', fxId, outcome: 'failed' }, compiled));
    expect(s.effects[0]).toEqual({ fx: 'var', name: 'exp', delta: 10, value: 10, toast: 'Wassim gagne 10 EXP !' });
    expect(lines(s.effects)).toEqual(['Branche vraie']);
    const end = advance(s.state, compiled);
    expect(end.state.wait).toEqual({ t: 'ended', ending: 'coupable' });
    expect(step(end.state, { t: 'advance', rev: end.state.waitRev }, compiled)).toMatchObject({ ok: false, reason: 'ended' });
  });

  it('rejects a second advance carrying the same revision (double click)', () => {
    const first = ok(startChapter(compiled));
    const rev = first.state.waitRev;
    const second = ok(step(first.state, { t: 'advance', rev }, compiled));
    const replay = step(second.state, { t: 'advance', rev }, compiled);
    expect(replay).toMatchObject({ ok: false, reason: 'stale-rev' });
    expect(replay.state).toBe(second.state);
  });

  it('hydrates persistent visuals and the current line without replaying consumed effects', () => {
    const second = advance(ok(startChapter(compiled)).state, compiled);
    const effects = hydrate(second.state, compiled);
    expect(effects.map((e) => e.fx)).toEqual(['stage', 'music', 'healthBar', 'line']);
    expect(lines(effects)).toEqual(["Je n'ai rien fait\u202F!"]);
  });
});

describe('engine: calls and guards', () => {
  it('returns from call and unwinds the stack on exitTo', () => {
    const compiled = compileChapter(chapter({
      start: [{ op: 'call', section: 'sub' }, { op: 'say', who: null, text: 'après call' }, { op: 'exitTo', section: 'fin' }],
      sub: [{ op: 'say', who: null, text: 'dans sub' }],
      fin: [{ op: 'say', who: null, text: 'fin' }, { op: 'ending', id: 'coupable' }],
    }));
    const a = ok(startChapter(compiled));
    expect(lines(a.effects)).toEqual(['dans sub']);
    const b = advance(a.state, compiled);
    expect(lines(b.effects)).toEqual(['après call']);
    const c = advance(b.state, compiled);
    expect(lines(c.effects)).toEqual(['fin']);
    expect(c.state.frames).toEqual([{ block: 'fin', ip: 1 }]);
  });

  it('throws a ContentError when an exitTo loop exceeds the instruction budget', () => {
    const compiled = compileChapter(chapter({ start: [{ op: 'exitTo', section: 'loop' }], loop: [{ op: 'exitTo', section: 'start' }] }));
    expect(() => startChapter(compiled)).toThrow(ContentError);
    expect(() => startChapter(compiled)).toThrow(`budget exceeded (${INSTRUCTION_BUDGET})`);
  });

  it('throws a ContentError when a section falls off its end', () => {
    const compiled = compileChapter(chapter({ start: [{ op: 'sfx', sound: 'sfx.gavel' }] }));
    expect(() => startChapter(compiled)).toThrow(ContentError);
  });
});

describe('compileChapter: compat hash', () => {
  const base: SourceCommand[] = [{ op: 'say', who: 'juge', text: 'Bonjour {sfx:sfx.gavel}tout le monde.' }, { op: 'ending', id: 'coupable' }];
  const hash = (cmds: SourceCommand[], revision = 1): string => compileChapter(chapter({ start: cmds }, { contentRevision: revision })).compat;

  it('is stable when only displayed words change', () => {
    expect(hash([{ op: 'say', who: 'juge', text: 'Salut {sfx:sfx.gavel}à tous.' }, { op: 'ending', id: 'coupable' }])).toBe(hash(base));
  });

  it('changes when an inline command changes', () => {
    expect(hash([{ op: 'say', who: 'juge', text: 'Bonjour {sfx:sfx.shock}tout le monde.' }, { op: 'ending', id: 'coupable' }])).not.toBe(hash(base));
  });

  it('changes when the manual content revision changes', () => {
    expect(hash(base, 2)).not.toBe(hash(base, 1));
  });
});
