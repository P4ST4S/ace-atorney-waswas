import { describe, expect, it, vi } from 'vitest';
import { compileChapter } from '../engine/compile.ts';
import { plainText } from '../engine/text.ts';
import type { ChapterSource, Effect, SourceCommand } from '../engine/types.ts';
import { Director, type EffectOutcome, type EffectPlayer, type PlayContext } from './director.ts';
import { createViewStore } from './store.ts';

function source(start: readonly SourceCommand[]): ChapterSource {
  return {
    id: 't', title: 'T', contentRevision: 1, start: 'start', gameOver: 'start', maxHealth: 100,
    player: { char: 'mimi', bench: 'prosecution' },
    characters: { mimi: { name: 'Mimi', sprite: 'miles-edgeworth', poses: { normal: 'normal' }, blip: 'male', voices: {} } },
    vars: {}, evidence: {}, profiles: {}, testimonies: {}, endings: { fin: { title: 'Fin', tone: 'win' } },
    sections: { start },
  };
}

const CHAPTER = compileChapter(source([
  { op: 'say', who: 'mimi', text: 'Première ligne.' },
  { op: 'interjection', kind: 'objection', by: 'mimi' },
  { op: 'say', who: 'mimi', text: 'Après l’objection.' },
  { op: 'ending', id: 'fin' },
]));

interface Pending {
  readonly effect: Effect;
  readonly ctx: PlayContext;
  readonly resolve: (outcome: EffectOutcome) => void;
  readonly reject: (error: Error) => void;
}

/** Fake presentation: non-blocking effects complete at once; blocking ones wait for the test. */
class ControllablePlayer implements EffectPlayer {
  readonly played: { runId: number; effect: Effect }[] = [];
  readonly pending: Pending[] = [];
  resets = 0;

  play(effect: Effect, ctx: PlayContext): Promise<EffectOutcome> {
    this.played.push({ runId: ctx.runId, effect });
    if (!('fxId' in effect) || effect.fxId === undefined) return Promise.resolve('done');
    return new Promise((resolve, reject) => {
      this.pending.push({ effect, ctx, resolve, reject });
    });
  }

  reset(): void {
    this.resets += 1;
  }

  lines(runId: number): string[] {
    return this.played.flatMap((p) => (p.runId === runId && p.effect.fx === 'line' ? [plainText(p.effect.tokens)] : []));
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function setup(options: ConstructorParameters<typeof Director>[3] = {}) {
  const store = createViewStore();
  const player = new ControllablePlayer();
  const director = new Director(CHAPTER, store, player, options);
  return { store, player, director };
}

describe('Director', () => {
  it('plays effects in order, acknowledges blocking effects and exposes input readiness', async () => {
    const { store, player, director } = setup();
    director.newGame();
    await flush();
    expect(player.lines(1)).toEqual(['Première ligne.']);
    expect(store.getState().inputReady).toBe(true);

    director.input({ t: 'advance', rev: director.state?.waitRev ?? -1 });
    await flush();
    expect(store.getState().inputReady).toBe(false);
    expect(player.pending).toHaveLength(1);
    player.pending[0]?.resolve('done');
    await flush();
    expect(player.lines(1)).toEqual(['Première ligne.', 'Après l’objection.']);
    expect(store.getState().inputReady).toBe(true);
  });

  it('ignores the completion of an effect from a previous run after a restart (no page reload)', async () => {
    const { player, director } = setup();
    director.newGame();
    await flush();
    director.input({ t: 'advance', rev: director.state?.waitRev ?? -1 });
    await flush();
    const oldEffect = player.pending[0];
    expect(oldEffect?.effect.fx).toBe('interjection');
    expect(oldEffect?.ctx.signal.aborted).toBe(false);

    director.newGame();
    await flush();
    const stateAfterRestart = director.state;
    expect(oldEffect?.ctx.signal.aborted).toBe(true);
    expect(oldEffect?.ctx.runSignal.aborted).toBe(true);

    // The old animation "finishes" late: its acknowledgement must not reach the new game.
    oldEffect?.resolve('done');
    await flush();
    expect(director.state).toBe(stateAfterRestart);
    expect(player.lines(2)).toEqual(['Première ligne.']);
    expect(player.played.filter((p) => p.runId === 2).map((p) => p.effect.fx)).toEqual(['line']);
    expect(player.resets).toBe(2);
  });

  it('rejects a second input carrying the same revision (double click)', async () => {
    const onRejected = vi.fn();
    const { player, director } = setup({ onRejected });
    director.newGame();
    await flush();
    const rev = director.state?.waitRev ?? -1;
    director.input({ t: 'advance', rev });
    director.input({ t: 'advance', rev });
    await flush();
    expect(onRejected).toHaveBeenCalledWith({ t: 'advance', rev }, 'stale-rev');
    expect(player.pending).toHaveLength(1);
  });

  it('acknowledges a timed-out cosmetic effect as failed and continues', async () => {
    vi.useFakeTimers();
    try {
      const { player, director } = setup({ timeoutMs: () => 100 });
      director.newGame();
      await flush();
      director.input({ t: 'advance', rev: director.state?.waitRev ?? -1 });
      await flush();
      const stuck = player.pending[0];
      expect(stuck?.ctx.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(150);
      await flush();
      expect(stuck?.ctx.signal.aborted).toBe(true);
      expect(player.lines(1)).toEqual(['Première ligne.', 'Après l’objection.']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a throwing effect player as a failed cosmetic effect', async () => {
    const { player, director } = setup();
    director.newGame();
    await flush();
    director.input({ t: 'advance', rev: director.state?.waitRev ?? -1 });
    await flush();
    player.pending[0]?.reject(new Error('voice clip failed to decode'));
    await flush();
    expect(player.lines(1)).toEqual(['Première ligne.', 'Après l’objection.']);
  });

  it('reports content errors instead of crashing', async () => {
    const store = createViewStore();
    const broken = compileChapter(source([{ op: 'exitTo', section: 'nowhere' }]));
    const director = new Director(broken, store, new ControllablePlayer());
    director.newGame();
    await flush();
    expect(store.getState().error).toMatch(/Erreur de contenu/);
  });
});
