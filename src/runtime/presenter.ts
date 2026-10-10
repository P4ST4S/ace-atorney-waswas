import type { CompiledChapter, Effect, InterjectionKind, Stage } from '../engine/types.ts';
import type { AssetCatalog, ImageCache } from './assets.ts';
import type { AudioService } from './audio.ts';
import type { EffectOutcome, EffectPlayer, PlayContext } from './director.ts';
import { resolveScene, sceneImageUrls } from './scene.ts';
import type { ViewStore } from './store.ts';

const INTERJECTION_MS = 1100;
const FADE_HALF_MS = 220;
const TOAST_MS = 2600;
const BANNER_MS = 1700;
const VERDICT_MS = 2800;
const DAMAGE_MS = 900;
const RECORD_POPUP_MS = 1800;
/** Sounds the presenter plays by itself, and the overlay images of the first cosmetic effects. */
const PRESENTER_SOUNDS = ['sfx.objection', 'sfx.evidence', 'sfx.damage', 'sfx.testimony', 'sfx.guilty', 'blip.typewriter'] as const;
const OVERLAY_IMAGES = ['ui.objection', 'ui.holdit', 'ui.takethat', 'ui.evidence-frame'] as const;

export interface PresenterDeps {
  readonly store: ViewStore;
  readonly chapter: CompiledChapter;
  readonly catalog: AssetCatalog;
  readonly images: ImageCache;
  readonly audio: AudioService;
  /** Test/preview mode: animations take no time. */
  readonly fast: boolean;
}

/** Reads `signal.aborted` without letting TypeScript narrow it across awaits (it changes asynchronously). */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Resolves after `ms`, or immediately when `signal` aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

/** Awaits a Web Animation, cancelling it when `signal` aborts. */
async function animate(el: HTMLElement | null, keyframes: Keyframe[], ms: number, signal: AbortSignal): Promise<void> {
  if (el === null || ms <= 0 || signal.aborted) return;
  const animation = el.animate(keyframes, { duration: ms, easing: 'linear' });
  const cancel = (): void => {
    animation.cancel();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await animation.finished;
  } catch {
    // A cancelled animation rejects; nothing else to clean up.
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

function shakeFrames(): Keyframe[] {
  const offsets = [[-18, 8], [16, -10], [-12, 6], [10, -6], [-6, 4], [4, -2], [0, 0]];
  return offsets.map(([x, y]) => ({ transform: `translate(${x ?? 0}px, ${y ?? 0}px)` }));
}

/**
 * Plays engine effects in the browser (DOM, images, audio). The Director owns ordering, timeouts and
 * cancellation; the presenter only has to stop promptly when the signal aborts.
 */
export class Presenter implements EffectPlayer {
  private readonly deps: PresenterDeps;
  private sceneEl: HTMLElement | null = null;
  private flashEl: HTMLElement | null = null;
  private keys = 0;

  constructor(deps: PresenterDeps) {
    this.deps = deps;
  }

  get fast(): boolean {
    return this.deps.fast;
  }

  /**
   * Starts downloading what cosmetic effects need (sound effects, voices, blips, interjection bubbles) so that
   * remote assets are ready before their effect times out. Best effort: each effect still handles a missing
   * resource itself. Call after the user gesture that unlocks audio.
   */
  warmUp(): void {
    const { audio, catalog, chapter, images } = this.deps;
    const sounds = new Set<string>(PRESENTER_SOUNDS);
    for (const character of Object.values(chapter.characters)) {
      sounds.add(`blip.${character.blip}`);
      for (const voice of Object.values(character.voices)) if (typeof voice === 'string') sounds.add(voice);
    }
    audio.preload([...sounds].flatMap((alias) => catalog.audio(alias) ?? []));
    for (const alias of OVERLAY_IMAGES) {
      try {
        images.load(catalog.image(alias).url).catch(() => undefined);
      } catch {
        // Unknown alias: the overlay itself reports it when shown.
      }
    }
  }

  /** Registered by the UI (idempotent: React Strict Mode may attach twice). */
  attachScene(el: HTMLElement | null): void {
    this.sceneEl = el;
  }

  attachFlash(el: HTMLElement | null): void {
    this.flashEl = el;
  }

  reset(): void {
    this.deps.audio.stopAll();
  }

  async play(effect: Effect, ctx: PlayContext): Promise<EffectOutcome> {
    const { store, audio, chapter } = this.deps;
    switch (effect.fx) {
      case 'stage':
        await this.showStage(effect.stage, effect.transition, ctx.signal);
        return 'done';
      case 'line':
        store.setState({
          line: { key: this.nextKey(), rev: ctx.rev, speaker: effect.speaker, name: effect.name, tokens: effect.tokens, style: effect.style, ce: effect.ce ?? null },
        });
        return 'done';
      case 'interjection':
        await this.interjection(effect.kind, effect.by, ctx.signal);
        return 'done';
      case 'music':
        audio.playMusic(effect.track === null ? null : this.audioUrl(effect.track), this.fast ? 0 : effect.fadeMs);
        return 'done';
      case 'sfx':
        this.sound(effect.sound, ctx.runSignal);
        return 'done';
      case 'shake':
        await this.shakeNow(effect.ms, ctx.signal);
        return 'done';
      case 'flash':
        await this.flashNow(effect.ms, ctx.signal);
        return 'done';
      case 'wait':
        await delay(this.fast ? 0 : effect.ms, ctx.signal);
        return 'done';
      case 'var':
        if (chapter.vars[effect.name]?.label !== undefined) store.setState((s) => ({ vars: { ...s.vars, [effect.name]: effect.value } }));
        if (effect.toast !== null) this.toast(effect.toast);
        return 'done';
      case 'record':
        store.setState({ record: effect.record });
        if (effect.fxId !== undefined && effect.act !== 'remove') {
          store.setState({ recordPopup: { key: this.nextKey(), kind: effect.kind, item: effect.item, act: effect.act }, line: null });
          this.sound('sfx.evidence', ctx.runSignal);
          await delay(this.fast ? 0 : RECORD_POPUP_MS, ctx.signal);
          store.setState({ recordPopup: null });
        }
        return 'done';
      case 'healthBar':
        store.setState({ healthBar: effect.visible });
        return 'done';
      case 'damage':
        store.setState((s) => ({ health: effect.health, healthMax: effect.max, healthBar: true, damageKey: s.damageKey + 1 }));
        this.sound('sfx.damage', ctx.runSignal);
        void this.flashNow(160, ctx.signal);
        await this.shakeNow(400, ctx.signal);
        await delay(this.fast ? 0 : DAMAGE_MS, ctx.signal);
        return 'done';
      case 'banner':
        store.setState({ banner: { key: this.nextKey(), kind: effect.kind, title: effect.title }, line: null });
        this.sound('sfx.testimony', ctx.runSignal);
        await delay(this.fast ? 0 : BANNER_MS, ctx.signal);
        store.setState({ banner: null });
        return 'done';
      case 'verdict':
        store.setState({ verdict: { key: this.nextKey(), text: effect.text }, line: null });
        this.sound('sfx.guilty', ctx.runSignal);
        await delay(this.fast ? 0 : VERDICT_MS, ctx.signal);
        store.setState({ verdict: null });
        return 'done';
      case 'ended':
        store.setState({ ended: effect.ending, line: null });
        return 'done';
    }
  }

  // Inline effects triggered by the typewriter (decorative by contract).

  shakeNow(ms = 400, signal: AbortSignal = new AbortController().signal): Promise<void> {
    return animate(this.sceneEl, shakeFrames(), this.fast ? 0 : ms, signal);
  }

  flashNow(ms = 200, signal: AbortSignal = new AbortController().signal): Promise<void> {
    return animate(this.flashEl, [{ opacity: 0.95 }, { opacity: 0 }], this.fast ? 0 : ms, signal);
  }

  sound(alias: string, signal?: AbortSignal): void {
    const url = this.audioUrl(alias);
    if (url !== null) void this.deps.audio.play(url, 'sfx', signal);
  }

  private nextKey(): number {
    this.keys += 1;
    return this.keys;
  }

  private audioUrl(alias: string): string | null {
    return this.deps.catalog.audio(alias) ?? null;
  }

  private async showStage(stage: Stage, transition: 'cut' | 'fade', signal: AbortSignal): Promise<void> {
    const { store, chapter, catalog } = this.deps;
    const scene = resolveScene(stage, chapter, catalog);
    if (scene !== null) await this.loadEssential(sceneImageUrls(scene), signal);
    if (isAborted(signal)) return;
    if (transition === 'fade' && !this.fast) {
      await animate(this.sceneEl, [{ opacity: 1 }, { opacity: 0 }], FADE_HALF_MS, signal);
      store.setState({ stage, stageTransition: 'fade' });
      await animate(this.sceneEl, [{ opacity: 0 }, { opacity: 1 }], FADE_HALF_MS, signal);
    } else {
      store.setState({ stage, stageTransition: 'cut' });
    }
  }

  /** Essential images: on failure, ask the player to retry instead of continuing with a broken scene. */
  private async loadEssential(urls: readonly string[], signal: AbortSignal): Promise<void> {
    const { images, store } = this.deps;
    for (;;) {
      try {
        await Promise.all(urls.map((url) => images.load(url)));
        return;
      } catch {
        if (signal.aborted) return;
        await new Promise<void>((resolve) => {
          const done = (): void => {
            store.setState({ retry: null });
            resolve();
          };
          store.setState({ retry: { message: 'Une image du décor n’a pas pu être chargée.', onRetry: done } });
          signal.addEventListener('abort', done, { once: true });
        });
        if (isAborted(signal)) return;
      }
    }
  }

  private async interjection(kind: InterjectionKind, by: string, signal: AbortSignal): Promise<void> {
    const { store, chapter, audio } = this.deps;
    store.setState({ interjection: { key: this.nextKey(), kind, by } });
    const voice = chapter.characters[by]?.voices[kind] ?? null;
    const voiceUrl = voice === null ? null : this.audioUrl(voice);
    const impactUrl = this.audioUrl('sfx.objection');
    if (impactUrl !== null) void audio.play(impactUrl, 'sfx', signal);
    if (voiceUrl !== null) void audio.play(voiceUrl, 'voice', signal);
    void this.shakeNow(350, signal);
    await delay(this.fast ? 0 : INTERJECTION_MS, signal);
    store.setState({ interjection: null });
  }

  private toast(text: string): void {
    const { store } = this.deps;
    const toast = { key: this.nextKey(), text };
    store.setState((s) => ({ toasts: [...s.toasts, toast] }));
    setTimeout(() => {
      store.setState((s) => ({ toasts: s.toasts.filter((t) => t.key !== toast.key) }));
    }, this.fast ? 50 : TOAST_MS);
  }
}
