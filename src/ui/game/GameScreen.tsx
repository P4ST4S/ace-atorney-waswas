import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerInput } from '../../engine/types.ts';
import { SceneViewport } from '../stage/SceneViewport.tsx';
import { useGame } from './context.ts';
import { CourtRecord } from './CourtRecord.tsx';
import { Dialogue, type ActiveTypewriter } from './Dialogue.tsx';
import { InterjectionOverlay, StatusOverlays, Toasts } from './Overlays.tsx';
import { StageView } from './StageView.tsx';
import { Banner, CrossExamBar, HealthBar, RecordButton, RecordPopup, Verdict } from './TrialHud.tsx';

const ADVANCE_KEYS = new Set(['Enter', ' ', 'Spacebar']);

type Action = { readonly t: 'advance' } | { readonly t: 'cePrev' } | { readonly t: 'press' } | { readonly t: 'present'; readonly item: string };

/** The playing screen: scene, dialogue, trial HUD, Court Record, and player input. */
export function GameScreen() {
  const { director, store } = useGame();
  const typewriterRef = useRef<ActiveTypewriter | null>(null);
  const [recordMode, setRecordMode] = useState<'view' | 'present' | null>(null);
  const recordOpen = recordMode !== null;

  /**
   * Sends an action for the line currently displayed. The wait revision is captured now, when the action is
   * created, and passed through unchanged: a late or duplicated action is rejected by the engine.
   */
  const act = useCallback((action: Action) => {
    const { line, inputReady } = store.getState();
    if (line === null || !inputReady) return;
    const input: PlayerInput = { ...action, rev: line.rev };
    director.input(input);
  }, [director, store]);

  /** True when the displayed line is fully typed (its own typewriter, not the previous line's). */
  const lineTyped = useCallback((): boolean => {
    const { line } = store.getState();
    const active = typewriterRef.current;
    return line !== null && active !== null && active.lineKey === line.key && active.typewriter.done;
  }, [store]);

  /**
   * A click while text is typing completes the line and is consumed here; otherwise it advances.
   * A click before the new line's typewriter has started is ignored (it must not skip an unseen line).
   */
  const advance = useCallback(() => {
    const { line } = store.getState();
    const active = typewriterRef.current;
    if (line === null || active === null || active.lineKey !== line.key) return;
    if (!active.typewriter.done) {
      active.typewriter.complete();
      return;
    }
    act({ t: 'advance' });
  }, [act, store]);

  const inCrossExam = useCallback(() => {
    const { line, inputReady } = store.getState();
    return inputReady && line?.ce !== null && line?.ce !== undefined && lineTyped();
  }, [store, lineTyped]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat || recordOpen) return;
      if (ADVANCE_KEYS.has(event.key) || (event.key === 'ArrowRight' && inCrossExam())) {
        event.preventDefault();
        advance();
      } else if (event.key === 'ArrowLeft' && inCrossExam()) {
        act({ t: 'cePrev' });
      } else if ((event.key === 'q' || event.key === 'Q') && inCrossExam()) {
        act({ t: 'press' });
      } else if ((event.key === 'e' || event.key === 'E') && inCrossExam()) {
        setRecordMode('present');
      } else if ((event.key === 'r' || event.key === 'R') && store.getState().inputReady) {
        setRecordMode('view');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [advance, act, inCrossExam, recordOpen, store]);

  return (
    <div className="h-full w-full select-none" onPointerDown={(event) => { if (event.button === 0 && !recordOpen) advance(); }} data-testid="game">
      <SceneViewport
        scene={(
          <>
            <StageView />
            <InterjectionOverlay />
          </>
        )}
        ui={(
          <>
            <HealthBar />
            <Toasts />
            <Banner />
            <RecordPopup />
            <Dialogue typewriterRef={typewriterRef} />
            <CrossExamBar
              onPress={() => { act({ t: 'press' }); }}
              onPresent={() => { setRecordMode('present'); }}
              onPrev={() => { act({ t: 'cePrev' }); }}
              onNext={advance}
            />
            <RecordButton onOpen={() => { setRecordMode('view'); }} />
            <Verdict />
            {recordMode !== null && (
              <CourtRecord
                mode={recordMode}
                onClose={() => { setRecordMode(null); }}
                onPresent={(item) => {
                  setRecordMode(null);
                  act({ t: 'present', item });
                }}
              />
            )}
            <StatusOverlays onRestart={() => { director.newGame(); }} />
          </>
        )}
      />
    </div>
  );
}
