import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { CompiledChapter } from '../../engine/types.ts';
import type { AssetCatalog } from '../../runtime/assets.ts';
import type { AudioService } from '../../runtime/audio.ts';
import type { Director } from '../../runtime/director.ts';
import type { Presenter } from '../../runtime/presenter.ts';
import type { ViewState, ViewStore } from '../../runtime/store.ts';

/** Services created once at boot, outside React (see docs/ARCHITECTURE.md §8.4). */
export interface GameServices {
  readonly director: Director;
  readonly store: ViewStore;
  readonly presenter: Presenter;
  readonly catalog: AssetCatalog;
  readonly chapter: CompiledChapter;
  readonly audio: AudioService;
}

export const GameContext = createContext<GameServices | null>(null);

export function useGame(): GameServices {
  const services = useContext(GameContext);
  if (services === null) throw new Error('useGame() must be used inside <GameContext>');
  return services;
}

/** Subscribes to a slice of the view state (re-renders only when the slice changes). */
export function useView<T>(selector: (state: ViewState) => T): T {
  return useStore(useGame().store, selector);
}
