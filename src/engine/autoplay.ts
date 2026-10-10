import { startChapter, step } from './step.ts';
import { plainText } from './text.ts';
import type { CompiledChapter, Effect, EngineState, PlayerInput, RejectReason } from './types.ts';

/** A player action without its revision (the auto-player fills in the current one). */
export type Action = { readonly t: 'advance' } | { readonly t: 'cePrev' } | { readonly t: 'press' } | { readonly t: 'present'; readonly item: string };

/**
 * Headless player for tests and tooling: drives the engine like the Director would (every blocking effect is
 * acknowledged at once) and keeps a readable trace.
 */
export class AutoPlayer {
  state: EngineState;
  /** Effects produced by the last action (including acknowledged blocking effects). */
  effects: Effect[] = [];
  readonly trace: string[] = [];
  private readonly chapter: CompiledChapter;

  constructor(chapter: CompiledChapter) {
    this.chapter = chapter;
    const r = startChapter(chapter);
    if (!r.ok) throw new Error(`start rejected: ${r.reason}`);
    this.state = r.state;
    this.absorb(r.effects);
  }

  get ended(): string | null {
    return this.state.wait.t === 'ended' ? this.state.wait.ending : null;
  }

  /** Applies an action; returns the rejection reason, or null when accepted. */
  tryAct(action: Action): RejectReason | null {
    const input: PlayerInput = { ...action, rev: this.state.waitRev };
    const r = step(this.state, input, this.chapter);
    this.trace.push(`${action.t}${action.t === 'present' ? `:${action.item}` : ''}${r.ok ? '' : ` (rejected: ${r.reason})`}`);
    if (!r.ok) return r.reason;
    this.effects = [];
    this.state = r.state;
    this.absorb(r.effects);
    return null;
  }

  act(action: Action): this {
    const reason = this.tryAct(action);
    if (reason !== null) throw new Error(`${action.t} rejected: ${reason}\ntrace: ${this.trace.join(' > ')}`);
    return this;
  }

  /** Advances lines until `until` holds (checked before each advance) or the chapter ends. */
  advanceUntil(until: (player: this) => boolean, maxSteps = 500): this {
    for (let i = 0; i < maxSteps; i += 1) {
      if (until(this) || this.ended !== null) return this;
      this.act({ t: 'advance' });
    }
    throw new Error(`advanceUntil: condition not reached after ${maxSteps} steps\ntrace: ${this.trace.slice(-20).join(' > ')}`);
  }

  /** In a cross-examination, navigates (forward) to the given statement. */
  goToStatement(stmt: string, maxSteps = 50): this {
    return this.advanceUntil((p) => p.state.wait.t === 'ce' && p.currentStatement() === stmt, maxSteps);
  }

  currentStatement(): string | null {
    const wait = this.state.wait;
    return wait.t === 'ce' ? (this.state.ce[wait.ce]?.current ?? null) : null;
  }

  lines(): string[] {
    return this.effects.flatMap((e) => (e.fx === 'line' ? [plainText(e.tokens)] : []));
  }

  private absorb(effects: readonly Effect[]): void {
    this.effects.push(...effects);
    for (const effect of effects) if (effect.fx === 'line') this.trace.push(`"${plainText(effect.tokens).slice(0, 40)}"`);
    while (this.state.wait.t === 'fx') {
      const r = step(this.state, { t: 'fxEnd', fxId: this.state.wait.fxId, outcome: 'done' }, this.chapter);
      if (!r.ok) throw new Error(`fxEnd rejected: ${r.reason}`);
      this.state = r.state;
      this.effects.push(...r.effects);
      for (const effect of r.effects) if (effect.fx === 'line') this.trace.push(`"${plainText(effect.tokens).slice(0, 40)}"`);
    }
  }
}

/** Deterministic PRNG (mulberry32): the engine never uses Math.random. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ExplorationResult {
  readonly seed: number;
  readonly steps: number;
  readonly ending: string | null;
  readonly trace: readonly string[];
}

/**
 * Seeded, bounded random exploration. It looks for crashes and dead ends with a reproducible seed/trace;
 * it does NOT prove that no dead end exists.
 */
export function explore(chapter: CompiledChapter, seed: number, maxSteps = 400): ExplorationResult {
  const random = prng(seed);
  const player = new AutoPlayer(chapter);
  let steps = 0;
  while (player.ended === null && steps < maxSteps) {
    steps += 1;
    const wait = player.state.wait;
    if (wait.t === 'line') {
      player.act({ t: 'advance' });
      continue;
    }
    if (wait.t !== 'ce') throw new Error(`dead end: waiting for "${wait.t}" with no possible input\ntrace: ${player.trace.slice(-20).join(' > ')}`);
    const items = [...player.state.record.evidence, ...player.state.record.profiles];
    const roll = random();
    const action: Action = roll < 0.45 ? { t: 'advance' }
      : roll < 0.55 ? { t: 'cePrev' }
        : roll < 0.8 ? { t: 'press' }
          : { t: 'present', item: items[Math.floor(random() * items.length)] ?? 'none' };
    // Rejections (e.g. "previous" on the first statement) are legitimate; the state must simply not change.
    const before = player.state;
    if (player.tryAct(action) !== null && player.state !== before) throw new Error('a rejected input changed the state');
  }
  return { seed, steps, ending: player.ended, trace: player.trace };
}
