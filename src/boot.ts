import { demoChapter } from './content/demo/chapter.ts';
import { compileChapter } from './engine/compile.ts';
import { AssetCatalog } from './runtime/assets.ts';
import { AudioService } from './runtime/audio.ts';
import { Director } from './runtime/director.ts';
import { imageCache } from './runtime/image-cache.ts';
import { Presenter } from './runtime/presenter.ts';
import { createViewStore } from './runtime/store.ts';
import type { GameServices } from './ui/game/context.ts';

/** `?fast=1`: instant text and zero-length animations (tests, quick previews). */
export const FAST_MODE = new URLSearchParams(window.location.search).has('fast');

/**
 * Creates the game services once, outside React (the Director must survive React Strict Mode
 * double mounting and re-renders).
 */
async function createGame(): Promise<GameServices> {
  const catalog = await AssetCatalog.load();
  const chapter = compileChapter(demoChapter);
  const store = createViewStore();
  const audio = new AudioService();
  const presenter = new Presenter({ store, chapter, catalog, images: imageCache, audio, fast: FAST_MODE });
  const director = new Director(chapter, store, presenter, {
    onRejected: (input, reason) => {
      if (import.meta.env.DEV) console.debug('[director] input rejected', input, reason);
    },
  });
  return { director, store, presenter, catalog, chapter, audio };
}

let game: Promise<GameServices> | null = null;

export function getGame(): Promise<GameServices> {
  game ??= createGame();
  return game;
}
