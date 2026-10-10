import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CourtRecord, CrossExamLineInfo, InterjectionKind, LineStyle, Stage, TextToken, Transition, VarValue } from '../engine/types.ts';

/** A line as displayed; `rev` is the engine wait revision it answers to (captured by the UI on click). */
export interface LineView {
  readonly key: number;
  readonly rev: number;
  readonly speaker: string | null;
  readonly name: string | null;
  readonly tokens: readonly TextToken[];
  readonly style: LineStyle;
  /** Present on cross-examination statements. */
  readonly ce: CrossExamLineInfo | null;
}

export interface Toast {
  readonly key: number;
  readonly text: string;
}

/** Everything the UI renders. Written by the Director/presenter, read by React through selectors. */
export interface ViewState {
  readonly runId: number;
  readonly stage: Stage | null;
  readonly stageTransition: Transition;
  readonly line: LineView | null;
  /** True when the engine waits for the player and every queued effect has been played. */
  readonly inputReady: boolean;
  readonly interjection: { readonly key: number; readonly kind: InterjectionKind; readonly by: string } | null;
  readonly banner: { readonly key: number; readonly kind: 'testimony' | 'crossExam'; readonly title: string } | null;
  readonly verdict: { readonly key: number; readonly text: string } | null;
  readonly recordPopup: { readonly key: number; readonly kind: 'evidence' | 'profile'; readonly item: string; readonly act: 'add' | 'update' } | null;
  readonly record: CourtRecord;
  readonly healthBar: boolean;
  readonly health: number;
  readonly healthMax: number;
  /** Incremented on each penalty (drives the damage animation). */
  readonly damageKey: number;
  /** Labelled variables shown in the HUD (e.g. Wassim's EXP). */
  readonly vars: Readonly<Record<string, VarValue>>;
  readonly toasts: readonly Toast[];
  readonly ended: string | null;
  /** Content bug or unrecoverable error. */
  readonly error: string | null;
  /** An essential resource failed to load; the game waits for the player to retry. */
  readonly retry: { readonly message: string; readonly onRetry: () => void } | null;
}

export type ViewStore = StoreApi<ViewState>;

export const INITIAL_VIEW: ViewState = {
  runId: 0,
  stage: null,
  stageTransition: 'cut',
  line: null,
  inputReady: false,
  interjection: null,
  banner: null,
  verdict: null,
  recordPopup: null,
  record: { evidence: [], profiles: [], variants: {} },
  healthBar: false,
  health: 100,
  healthMax: 100,
  damageKey: 0,
  vars: {},
  toasts: [],
  ended: null,
  error: null,
  retry: null,
};

export function createViewStore(): ViewStore {
  return createStore<ViewState>()(() => INITIAL_VIEW);
}
