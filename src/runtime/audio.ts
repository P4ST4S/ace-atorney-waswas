import { Howl, Howler } from 'howler';

export interface Volumes {
  readonly music: number;
  readonly sfx: number;
  readonly voice: number;
  readonly blip: number;
}

const BLIP_MIN_INTERVAL_MS = 45;
/** After a failed load, a sound is not requested again for this long (blips would otherwise retry ~20 times/s). */
const LOAD_RETRY_DELAY_MS = 30_000;

/** Howler creates its AudioContext lazily, so it may not exist yet despite its typing. */
function howlerContext(): AudioContext | undefined {
  return Howler.ctx;
}

/**
 * Audio on top of Howler: one music track at a time (cross-fades), one-shot sounds that stop when their
 * signal aborts, rate-limited text blips. Browsers only allow audio after a user gesture: call `unlock()`
 * from the "click to start" screen.
 */
export class AudioService {
  private volumes: Volumes = { music: 0.5, sfx: 0.8, voice: 1, blip: 0.4 };
  private music: { readonly url: string; readonly howl: Howl } | null = null;
  private readonly cache = new Map<string, Howl>();
  private readonly failedUntil = new Map<string, number>();
  private lastBlip = 0;

  async unlock(): Promise<void> {
    const ctx = howlerContext();
    if (ctx?.state === 'suspended') await ctx.resume();
  }

  setVolumes(volumes: Volumes): void {
    this.volumes = volumes;
    this.music?.howl.volume(volumes.music);
  }

  playMusic(url: string | null, fadeMs: number): void {
    if (this.music?.url === url) return;
    const previous = this.music;
    this.music = null;
    if (previous !== null) {
      if (fadeMs > 0) {
        previous.howl.once('fade', () => previous.howl.unload());
        previous.howl.fade(previous.howl.volume(), 0, fadeMs);
      } else {
        previous.howl.unload();
      }
    }
    if (url === null) return;
    // Long tracks stream through HTML5 audio; they loop as a whole (no loop points available).
    const howl = new Howl({ src: [url], loop: true, html5: true, volume: fadeMs > 0 ? 0 : this.volumes.music });
    howl.once('loaderror', (_id, error) => {
      console.warn(`[audio] cannot load music ${url}: ${String(error)}`);
    });
    howl.play();
    if (fadeMs > 0) howl.fade(0, this.volumes.music, fadeMs);
    this.music = { url, howl };
  }

  /** Plays a one-shot sound; resolves when it ends, fails to load, or `signal` aborts (which stops it). */
  play(url: string, kind: 'sfx' | 'voice', signal?: AbortSignal): Promise<void> {
    const howl = this.howl(url);
    return new Promise((resolve) => {
      if (howl === null || signal?.aborted === true) {
        resolve();
        return;
      }
      const id = howl.play();
      howl.volume(this.volumes[kind], id);
      const finish = (): void => {
        signal?.removeEventListener('abort', stop);
        resolve();
      };
      const stop = (): void => {
        howl.stop(id);
        finish();
      };
      howl.once('end', finish, id);
      howl.once('playerror', finish, id);
      howl.once('loaderror', finish);
      signal?.addEventListener('abort', stop, { once: true });
    });
  }

  blip(url: string): void {
    const now = performance.now();
    if (now - this.lastBlip < BLIP_MIN_INTERVAL_MS) return;
    this.lastBlip = now;
    const howl = this.howl(url);
    if (howl === null) return;
    const id = howl.play();
    howl.volume(this.volumes.blip, id);
  }

  preload(urls: readonly string[]): void {
    for (const url of urls) this.howl(url);
  }

  stopAll(): void {
    this.playMusic(null, 0);
    for (const howl of this.cache.values()) howl.stop();
  }

  /**
   * One-shot sounds go through Web Audio: Howler downloads them with XHR, which needs CORS when assets are
   * hosted on another origin (see docs/DEPLOYMENT_R2.md). A sound that fails to load is unloaded and skipped
   * (`null`) for LOAD_RETRY_DELAY_MS, then retried: a missing file never blocks or floods the game.
   */
  private howl(url: string): Howl | null {
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached;
    if ((this.failedUntil.get(url) ?? 0) > performance.now()) return null;
    const howl = new Howl({ src: [url], preload: true });
    howl.once('loaderror', (_id, error) => {
      if (this.cache.get(url) === howl) this.cache.delete(url);
      this.failedUntil.set(url, performance.now() + LOAD_RETRY_DELAY_MS);
      // Howler schedules every listener before calling them, so pending play() promises still settle.
      howl.unload();
      console.warn(`[audio] cannot load ${url}: ${String(error)}`);
    });
    this.cache.set(url, howl);
    return howl;
  }
}
