import { useEffect, useRef, type RefObject } from 'react';
import { spriteRegistry } from '../stage/sprite-registry.ts';
import { Typewriter } from '../typewriter.ts';
import { useGame, useView } from './context.ts';

/** The typewriter of the line currently displayed, tagged with that line's key. */
export interface ActiveTypewriter {
  readonly lineKey: number;
  readonly typewriter: Typewriter;
}

interface DialogueProps {
  /** Shared with GameScreen so a click can complete the line before advancing. */
  readonly typewriterRef: RefObject<ActiveTypewriter | null>;
}

/** Dialogue box driven by the typewriter; React only re-renders when the line itself changes. */
export function Dialogue({ typewriterRef }: DialogueProps) {
  const { presenter, chapter, catalog, audio } = useGame();
  const line = useView((s) => s.line);
  const inputReady = useView((s) => s.inputReady);
  // As in the original games, the text box disappears while an interjection bubble is shown.
  const interjecting = useView((s) => s.interjection !== null);
  const textRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = textRef.current;
    const box = boxRef.current;
    if (container === null || box === null || line === null) return;
    const speaker = line.speaker;
    const blipAlias = speaker === null ? 'blip.typewriter' : `blip.${chapter.characters[speaker]?.blip ?? 'male'}`;
    const blipUrl = catalog.audio(blipAlias);
    const typewriter = new Typewriter(container, {
      onBlip: () => {
        if (blipUrl !== undefined) audio.blip(blipUrl);
      },
      onTalking: (talking) => {
        if (speaker !== null && line.style !== 'thought') spriteRegistry.setTalking(speaker, talking);
      },
      onInline: (token) => {
        if (token.t === 'shake') void presenter.shakeNow();
        else if (token.t === 'flash') void presenter.flashNow();
        else presenter.sound(token.sound);
      },
      onDone: () => {
        box.dataset.typed = '1';
      },
    });
    const active: ActiveTypewriter = { lineKey: line.key, typewriter };
    typewriterRef.current = active;
    const baseColor = line.style === 'thought' ? 'blue' : line.style === 'dialogue' ? 'white' : 'green';
    typewriter.start(line.tokens, presenter.fast, baseColor);
    return () => {
      typewriter.dispose();
      if (typewriterRef.current === active) typewriterRef.current = null;
    };
  }, [line, typewriterRef, presenter, chapter, catalog, audio]);

  if (line === null) return null;
  return (
    <div
      // Re-mounted for every line: its state (data-typed) can never leak from the previous line.
      key={line.key}
      ref={boxRef}
      className="group absolute right-[2%] bottom-[2.5%] left-[2%] h-[26%] rounded-[calc(14px*var(--scene-scale))] border-[max(1px,calc(3px*var(--scene-scale)))] border-box-edge bg-box px-[3%] pt-[max(10px,calc(26px*var(--scene-scale)))] font-game font-bold text-[max(16px,calc(44px*var(--scene-scale)))] leading-[1.35] text-white shadow-[0_0_0_2px_rgb(0_0_0/0.6)]"
      data-testid="dialogue-box"
      data-key={line.key}
      data-typed="0"
      data-ready={inputReady ? '1' : '0'}
      data-style={line.style}
      style={interjecting ? { visibility: 'hidden' } : undefined}
    >
      {line.name !== null && line.style !== 'thought' && (
        <div
          className="absolute top-0 left-[2.5%] -translate-y-[85%] rounded-t-[calc(10px*var(--scene-scale))] border-[max(1px,calc(3px*var(--scene-scale)))] border-b-0 border-box-edge bg-nameplate px-[max(10px,calc(28px*var(--scene-scale)))] py-[max(2px,calc(4px*var(--scene-scale)))] text-[max(14px,calc(36px*var(--scene-scale)))] font-extrabold"
          data-testid="nameplate"
        >
          {line.name}
        </div>
      )}
      <div ref={textRef} data-testid="dialogue-text" />
      <div
        className="absolute right-[2.5%] bottom-[10%] hidden h-0 w-0 animate-bounce border-x-[max(6px,calc(14px*var(--scene-scale)))] border-t-[max(9px,calc(20px*var(--scene-scale)))] border-x-transparent border-t-white group-data-[ready=1]:group-data-[typed=1]:block"
        data-testid="next-arrow"
      />
    </div>
  );
}
