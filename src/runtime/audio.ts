import { Howl, Howler } from 'howler';

export interface Volumes {
  readonly music: number;
  readonly sfx: number;
  readonly voice: number;
  readonly blip: number;
}

const BLIP_MIN_INTERVAL_MS = 45;

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
    howl.play();
    if (fadeMs > 0) howl.fade(0, this.volumes.music, fadeMs);
    this.music = { url, howl };
  }

  /** Plays a one-shot sound; resolves when it ends, fails to load, or `signal` aborts (which stops it). */
  play(url: string, kind: 'sfx' | 'voice', signal?: AbortSignal): Promise<void> {
    const howl = this.howl(url);
    return new Promise((resolve) => {
      if (signal?.aborted === true) {
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

  private howl(url: string): Howl {
    let howl = this.cache.get(url);
    if (howl === undefined) {
      howl = new Howl({ src: [url], preload: true });
      this.cache.set(url, howl);
    }
    return howl;
  }
}
