import type { TextColor, TextToken } from '../engine/types.ts';
import { onTick } from './stage/ticker.ts';

/** Default delay between two characters at speed factor 1. */
export const BASE_CHAR_MS = 28;

const SILENT = /[\s\p{P}]/u;

const COLOR_CLASS: Readonly<Record<TextColor, string>> = {
  white: 'text-white',
  red: 'text-text-red',
  blue: 'text-text-blue',
  green: 'text-text-green',
};

type Step =
  | { readonly kind: 'char'; readonly span: HTMLSpanElement; readonly silent: boolean }
  | { readonly kind: 'pause'; readonly ms: number }
  | { readonly kind: 'speed'; readonly factor: number }
  | { readonly kind: 'inline'; readonly token: Extract<TextToken, { t: 'shake' | 'flash' | 'sfx' }> };

export interface TypewriterHooks {
  readonly onBlip: () => void;
  readonly onTalking: (talking: boolean) => void;
  readonly onInline: (token: Extract<TextToken, { t: 'shake' | 'flash' | 'sfx' }>) => void;
  readonly onDone: () => void;
}

/**
 * Imperative typewriter: every character is rendered up front (hidden) so the layout never moves while
 * typing; characters are revealed on animation frames. Never triggers a React render.
 */
export class Typewriter {
  private readonly container: HTMLElement;
  private readonly hooks: TypewriterHooks;
  private readonly charMs: number;
  private steps: Step[] = [];
  private index = 0;
  private speed = 1;
  private nextAt = 0;
  private talking = false;
  private unsubscribe: (() => void) | null = null;
  private finished = true;

  constructor(container: HTMLElement, hooks: TypewriterHooks, charMs = BASE_CHAR_MS) {
    this.container = container;
    this.hooks = hooks;
    this.charMs = charMs;
  }

  get done(): boolean {
    return this.finished;
  }

  /**
   * @param baseColor colour used for plain (white) text, e.g. green for testimony statements.
   */
  start(tokens: readonly TextToken[], instant = false, baseColor: TextColor = 'white'): void {
    this.stop();
    this.container.replaceChildren();
    this.steps = [];
    for (const token of tokens) {
      if (token.t === 'text') {
        for (const char of token.text) {
          const span = document.createElement('span');
          span.textContent = char;
          span.className = COLOR_CLASS[token.color === 'white' ? baseColor : token.color];
          span.style.visibility = 'hidden';
          this.container.appendChild(span);
          this.steps.push({ kind: 'char', span, silent: SILENT.test(char) });
        }
      } else if (token.t === 'pause') {
        this.steps.push({ kind: 'pause', ms: token.ms });
      } else if (token.t === 'speed') {
        this.steps.push({ kind: 'speed', factor: token.factor });
      } else {
        this.steps.push({ kind: 'inline', token });
      }
    }
    this.index = 0;
    this.speed = 1;
    this.nextAt = 0;
    this.finished = false;
    if (instant) {
      this.complete();
      return;
    }
    this.unsubscribe = onTick((now) => {
      this.tick(now);
    });
  }

  /** Reveals everything at once; remaining pauses and inline effects are skipped (decorative by contract). */
  complete(): void {
    for (const step of this.steps.slice(this.index)) {
      if (step.kind === 'char') step.span.style.visibility = 'visible';
    }
    this.index = this.steps.length;
    this.finish();
  }

  dispose(): void {
    this.stop();
    this.setTalking(false);
  }

  private tick(now: number): void {
    if (this.nextAt === 0) this.nextAt = now;
    while (this.index < this.steps.length && now >= this.nextAt) {
      const step = this.steps[this.index];
      this.index += 1;
      if (step === undefined) break;
      switch (step.kind) {
        case 'char':
          step.span.style.visibility = 'visible';
          if (!step.silent) this.hooks.onBlip();
          this.setTalking(true);
          this.nextAt += this.charMs / this.speed;
          break;
        case 'pause':
          this.setTalking(false);
          this.nextAt = now + step.ms;
          break;
        case 'speed':
          this.speed = step.factor;
          break;
        case 'inline':
          this.hooks.onInline(step.token);
          break;
      }
    }
    if (this.index >= this.steps.length) this.finish();
  }

  private finish(): void {
    this.stop();
    this.setTalking(false);
    if (!this.finished) {
      this.finished = true;
      this.hooks.onDone();
    }
  }

  private stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private setTalking(talking: boolean): void {
    if (this.talking === talking) return;
    this.talking = talking;
    this.hooks.onTalking(talking);
  }
}
