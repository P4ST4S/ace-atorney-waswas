import { startChapter, step } from '../engine/step.ts';
import { ContentError, type CompiledChapter, type Effect, type EngineState, type PlayerInput, type RejectReason, type StepResult } from '../engine/types.ts';
import { INITIAL_VIEW, type ViewStore } from './store.ts';

export type EffectOutcome = 'done' | 'failed';

export interface PlayContext {
  /** Aborted when the effect times out or the run is replaced (new game, restart, load). */
  readonly signal: AbortSignal;
  /** Aborted only when the run is replaced: for transient sounds that outlive the effect (non-blocking sfx). */
  readonly runSignal: AbortSignal;
  readonly runId: number;
  /** Engine wait revision the effect belongs to (lines carry it to the UI). */
  readonly rev: number;
}

/** Presentation side: plays one effect. Must stop promptly when `signal` aborts. */
export interface EffectPlayer {
  play(effect: Effect, ctx: PlayContext): Promise<EffectOutcome>;
  /** Called when a new run starts: stop music and transient presentation state. */
  reset(): void;
}

/** Player inputs as created by the UI: the revision is captured at creation time and never rewritten. */
export type { PlayerInput };

export interface DirectorOptions {
  /** Maximum duration of an effect before it is forcibly stopped and acknowledged as `failed`. */
  readonly timeoutMs?: (effect: Effect) => number;
  readonly onRejected?: (input: PlayerInput, reason: RejectReason) => void;
}

interface Run {
  readonly id: number;
  readonly controller: AbortController;
}

interface Queued {
  readonly effect: Effect;
  readonly rev: number;
}

const DEFAULT_TIMEOUTS: Partial<Record<Effect['fx'], number>> = {
  interjection: 4000,
  shake: 3000,
  flash: 3000,
  banner: 5000,
  verdict: 8000,
  damage: 4000,
  record: 6000,
};

function defaultTimeout(effect: Effect): number {
  if (effect.fx === 'wait') return effect.ms + 1000;
  // Stage changes may wait for the player to retry a failed essential resource: no timeout.
  if (effect.fx === 'stage') return Number.POSITIVE_INFINITY;
  return DEFAULT_TIMEOUTS[effect.fx] ?? 5000;
}

/**
 * Runs the engine and plays its effects in order (docs/ARCHITECTURE.md §8).
 *
 * Contract:
 * - every run has an id and an AbortController; replacing the run aborts everything it started;
 * - a cancelled effect is never acknowledged; an acknowledgement from an old run is ignored;
 * - `finally` only cleans up: success is never assumed;
 * - cosmetic failures/timeouts are acknowledged as `failed`; the engine continues.
 */
export class Director {
  private readonly chapter: CompiledChapter;
  private readonly store: ViewStore;
  private readonly player: EffectPlayer;
  private readonly timeoutMs: (effect: Effect) => number;
  private readonly onRejected: ((input: PlayerInput, reason: RejectReason) => void) | undefined;
  private engine: EngineState | null = null;
  private run: Run = { id: 0, controller: new AbortController() };
  private queue: Queued[] = [];
  private pumping = false;

  constructor(chapter: CompiledChapter, store: ViewStore, player: EffectPlayer, options: DirectorOptions = {}) {
    this.chapter = chapter;
    this.store = store;
    this.player = player;
    this.timeoutMs = options.timeoutMs ?? defaultTimeout;
    this.onRejected = options.onRejected;
  }

  get state(): EngineState | null {
    return this.engine;
  }

  get runId(): number {
    return this.run.id;
  }

  /** Starts a new game in a fresh run (also used to restart). */
  newGame(): void {
    this.beginRun();
    this.apply(() => startChapter(this.chapter));
  }

  /** Applies a player input. The input keeps the revision captured when it was created. */
  input(input: PlayerInput): void {
    const engine = this.engine;
    if (engine === null) return;
    this.store.setState({ inputReady: false });
    const accepted = this.apply(() => step(engine, input, this.chapter), input);
    if (!accepted) this.refreshInputReady();
  }

  dispose(): void {
    this.run.controller.abort();
    this.queue = [];
  }

  private beginRun(): void {
    this.run.controller.abort();
    this.run = { id: this.run.id + 1, controller: new AbortController() };
    this.queue = [];
    this.engine = null;
    this.player.reset();
    this.store.setState({ ...INITIAL_VIEW, runId: this.run.id, health: this.chapter.maxHealth, healthMax: this.chapter.maxHealth });
  }

  /** Runs one engine transition; returns whether it was accepted. */
  private apply(transition: () => StepResult, input?: PlayerInput): boolean {
    let result: StepResult;
    try {
      result = transition();
    } catch (error) {
      this.fail(error);
      return false;
    }
    if (!result.ok) {
      if (input !== undefined) this.onRejected?.(input, result.reason);
      return false;
    }
    this.engine = result.state;
    for (const effect of result.effects) this.queue.push({ effect, rev: result.state.waitRev });
    void this.pump(this.run);
    return true;
  }

  private async pump(run: Run): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && run === this.run) {
        const next = this.queue.shift();
        if (next === undefined) break;
        const outcome = await this.playOne(next, run);
        if (outcome === 'cancelled' || run !== this.run) return;
        const fxId = 'fxId' in next.effect ? next.effect.fxId : undefined;
        if (fxId !== undefined) {
          const engine = this.engine;
          if (engine === null) return;
          this.apply(() => step(engine, { t: 'fxEnd', fxId, outcome }, this.chapter));
        }
      }
      if (run === this.run) this.refreshInputReady();
    } finally {
      this.pumping = false;
      // Effects queued by a newer run while this pump was finishing still need to be played.
      if (run !== this.run && this.queue.length > 0) void this.pump(this.run);
    }
  }

  private async playOne(item: Queued, run: Run): Promise<EffectOutcome | 'cancelled'> {
    const controller = new AbortController();
    const abortEffect = (): void => {
      controller.abort();
    };
    run.controller.signal.addEventListener('abort', abortEffect);
    const timeout = this.timeoutMs(item.effect);
    const timer = Number.isFinite(timeout) ? setTimeout(abortEffect, timeout) : null;
    const aborted = new Promise<'aborted'>((resolve) => {
      controller.signal.addEventListener('abort', () => {
        resolve('aborted');
      });
    });
    try {
      const ctx: PlayContext = { signal: controller.signal, runSignal: run.controller.signal, runId: run.id, rev: item.rev };
      const outcome = await Promise.race([this.player.play(item.effect, ctx), aborted]);
      if (run.controller.signal.aborted) return 'cancelled';
      return outcome === 'aborted' ? 'failed' : outcome;
    } catch {
      return run.controller.signal.aborted ? 'cancelled' : 'failed';
    } finally {
      // Cleanup only: never signals success.
      if (timer !== null) clearTimeout(timer);
      run.controller.signal.removeEventListener('abort', abortEffect);
    }
  }

  private refreshInputReady(): void {
    const wait = this.engine?.wait.t;
    const ready = this.queue.length === 0 && (wait === 'line' || wait === 'ce');
    if (this.store.getState().inputReady !== ready) this.store.setState({ inputReady: ready });
  }

  private fail(error: unknown): void {
    const message = error instanceof ContentError ? `Erreur de contenu : ${error.message}` : `Erreur : ${error instanceof Error ? error.message : String(error)}`;
    this.queue = [];
    this.store.setState({ error: message, inputReady: false });
  }
}
