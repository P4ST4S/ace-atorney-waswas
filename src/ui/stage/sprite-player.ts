import type { PoseLayout, SpriteFrame } from '../../../asset-meta/manifest-types.ts';

const BLINK_FRAME_MS = 55;
const BLINK_MIN_INTERVAL_MS = 2200;
const BLINK_MAX_INTERVAL_MS = 5200;
const TALK_FRAME_MS = 90;
const DEBUG_CYCLE_FRAME_MS = 140;

type Mode =
  | { kind: 'idle'; nextBlinkAt: number }
  | { kind: 'blink'; index: number; nextAt: number }
  | { kind: 'talk'; index: number; nextAt: number }
  | { kind: 'cycle'; index: number; nextAt: number };

/**
 * Imperative sprite animation: swaps the background-position of a small pool of absolutely positioned
 * <div>s (one per piece of the current frame). Never triggers a React render.
 */
export class SpritePlayer {
  private readonly pool: HTMLDivElement[] = [];
  private pose: PoseLayout | null = null;
  private sheetUrl = '';
  private talking = false;
  private cycling = false;
  private mode: Mode = { kind: 'idle', nextBlinkAt: 0 };
  private lastNow = 0;
  private readonly root: HTMLElement;
  private readonly random: () => number;

  constructor(root: HTMLElement, random: () => number) {
    this.root = root;
    this.random = random;
  }

  setPose(pose: PoseLayout, sheetUrl: string): void {
    this.pose = pose;
    this.sheetUrl = sheetUrl;
    this.resetMode(this.lastNow);
  }

  setTalking(talking: boolean): void {
    if (this.talking === talking) return;
    this.talking = talking;
    this.resetMode(this.lastNow);
  }

  /** Debug aid ("flicker test"): cycles through every frame of the pose to reveal misaligned pieces. */
  setCycling(cycling: boolean): void {
    this.cycling = cycling;
    this.resetMode(this.lastNow);
  }

  tick(now: number): void {
    this.lastNow = now;
    const pose = this.pose;
    if (pose === null) return;
    const mode = this.mode;
    switch (mode.kind) {
      case 'idle':
        if (pose.blink.length > 0 && now >= mode.nextBlinkAt) this.enter({ kind: 'blink', index: 0, nextAt: now + BLINK_FRAME_MS });
        return;
      case 'blink':
        if (now < mode.nextAt) return;
        if (mode.index + 1 < pose.blink.length) this.enter({ kind: 'blink', index: mode.index + 1, nextAt: now + BLINK_FRAME_MS });
        else this.enter({ kind: 'idle', nextBlinkAt: now + this.blinkDelay() });
        return;
      case 'talk':
        if (now >= mode.nextAt) this.enter({ kind: 'talk', index: (mode.index + 1) % pose.talk.length, nextAt: now + TALK_FRAME_MS });
        return;
      case 'cycle': {
        if (now < mode.nextAt) return;
        const count = 1 + pose.blink.length + pose.talk.length;
        this.enter({ kind: 'cycle', index: (mode.index + 1) % count, nextAt: now + DEBUG_CYCLE_FRAME_MS });
        return;
      }
    }
  }

  dispose(): void {
    for (const el of this.pool) el.remove();
    this.pool.length = 0;
    this.pose = null;
  }

  private resetMode(now: number): void {
    const pose = this.pose;
    if (pose === null) return;
    if (this.cycling) this.enter({ kind: 'cycle', index: 0, nextAt: now + DEBUG_CYCLE_FRAME_MS });
    else if (this.talking && pose.talk.length > 0) this.enter({ kind: 'talk', index: 0, nextAt: now + TALK_FRAME_MS });
    else this.enter({ kind: 'idle', nextBlinkAt: now + this.blinkDelay() });
  }

  private blinkDelay(): number {
    return BLINK_MIN_INTERVAL_MS + this.random() * (BLINK_MAX_INTERVAL_MS - BLINK_MIN_INTERVAL_MS);
  }

  private enter(mode: Mode): void {
    this.mode = mode;
    const pose = this.pose;
    if (pose === null) return;
    this.show(this.frameFor(pose, mode));
  }

  private frameFor(pose: PoseLayout, mode: Mode): SpriteFrame {
    switch (mode.kind) {
      case 'idle':
        return pose.idle;
      case 'blink':
        return pose.blink[mode.index] ?? pose.idle;
      case 'talk':
        return pose.talk[mode.index] ?? pose.idle;
      case 'cycle': {
        const all = [pose.idle, ...pose.blink, ...pose.talk];
        return all[mode.index] ?? pose.idle;
      }
    }
  }

  private show(frame: SpriteFrame): void {
    while (this.pool.length < frame.length) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.backgroundRepeat = 'no-repeat';
      this.root.appendChild(el);
      this.pool.push(el);
    }
    this.pool.forEach((el, i) => {
      const piece = frame[i];
      if (piece === undefined) {
        el.style.display = 'none';
        return;
      }
      const [sx, sy, w, h] = piece.s;
      const [ax, ay] = piece.a;
      el.style.display = 'block';
      el.style.backgroundImage = `url("${this.sheetUrl}")`;
      el.style.left = `${ax}px`;
      el.style.top = `${ay}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.backgroundPosition = `${-sx}px ${-sy}px`;
    });
  }
}
