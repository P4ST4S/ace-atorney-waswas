import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (id: number, error: unknown) => void;

const fake = vi.hoisted(() => {
  /** Minimal stand-in for Howler's Howl: records instances and lets the test trigger load errors. */
  class FakeHowl {
    static readonly instances: FakeHowl[] = [];
    readonly src: readonly string[];
    readonly listeners = new Map<string, Listener[]>();
    unloaded = false;
    plays = 0;

    constructor(options: { src: string[] }) {
      this.src = options.src;
      FakeHowl.instances.push(this);
    }

    once(event: string, fn: Listener): this {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
      return this;
    }

    play(): number {
      this.plays += 1;
      return this.plays;
    }

    volume(): this {
      return this;
    }

    stop(): this {
      return this;
    }

    unload(): void {
      this.unloaded = true;
    }

    emit(event: string, error?: unknown): void {
      const listeners = this.listeners.get(event) ?? [];
      this.listeners.delete(event);
      for (const fn of listeners) fn(0, error);
    }
  }
  return { FakeHowl };
});

vi.mock('howler', () => ({ Howl: fake.FakeHowl, Howler: { ctx: undefined } }));

const { AudioService } = await import('./audio.ts');

describe('AudioService with a missing sound', () => {
  let now = 1000;

  beforeEach(() => {
    fake.FakeHowl.instances.length = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles the pending play, unloads the sound, and does not request it again for a while', async () => {
    const audio = new AudioService();
    const played = audio.play('https://assets.test/releases/0123456789abcdef/audio/sfx.missing.wav', 'sfx');
    const [howl] = fake.FakeHowl.instances;
    howl?.emit('loaderror', 'Failed loading audio file with status: 404.');
    await expect(played).resolves.toBeUndefined();
    expect(howl?.unloaded).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('sfx.missing.wav'));

    // Blips and plays during the back-off create no new request.
    for (let i = 0; i < 20; i += 1) {
      now += 50;
      audio.blip('https://assets.test/releases/0123456789abcdef/audio/sfx.missing.wav');
    }
    await expect(audio.play('https://assets.test/releases/0123456789abcdef/audio/sfx.missing.wav', 'voice')).resolves.toBeUndefined();
    expect(fake.FakeHowl.instances).toHaveLength(1);

    // After the back-off, the sound is requested again (the file may have been published since).
    now += 30_000;
    audio.blip('https://assets.test/releases/0123456789abcdef/audio/sfx.missing.wav');
    expect(fake.FakeHowl.instances).toHaveLength(2);
  });

  it('keeps one Howl per loaded sound', () => {
    const audio = new AudioService();
    audio.preload(['/generated/audio/blip.male.wav', '/generated/audio/blip.male.wav', '/generated/audio/sfx.gavel.wav']);
    void audio.play('/generated/audio/sfx.gavel.wav', 'sfx');
    expect(fake.FakeHowl.instances.map((h) => h.src[0])).toEqual(['/generated/audio/blip.male.wav', '/generated/audio/sfx.gavel.wav']);
  });
});
