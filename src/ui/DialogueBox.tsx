import type { ReactNode } from 'react';

interface DialogueBoxProps {
  readonly name: string | null;
  readonly children: ReactNode;
}

/** Dialogue box in the HD-trilogy style: translucent panel at the bottom with a name tab. */
export function DialogueBox({ name, children }: DialogueBoxProps) {
  return (
    <div
      className="absolute right-[2%] bottom-[2.5%] left-[2%] h-[26%] rounded-[calc(14px*var(--scene-scale))] border-[max(1px,calc(3px*var(--scene-scale)))] border-box-edge bg-box px-[3%] pt-[max(10px,calc(26px*var(--scene-scale)))] font-game font-bold text-[max(16px,calc(44px*var(--scene-scale)))] leading-[1.35] text-white shadow-[0_0_0_2px_rgb(0_0_0_/_0.6)]"
      data-testid="dialogue-box"
    >
      {name !== null && (
        <div
          className="absolute top-0 left-[2.5%] -translate-y-[85%] rounded-t-[calc(10px*var(--scene-scale))] border-[max(1px,calc(3px*var(--scene-scale)))] border-b-0 border-box-edge bg-nameplate px-[max(10px,calc(28px*var(--scene-scale)))] py-[max(2px,calc(4px*var(--scene-scale)))] text-[max(14px,calc(36px*var(--scene-scale)))] font-extrabold"
          data-testid="nameplate"
        >
          {name}
        </div>
      )}
      <div data-testid="dialogue-text">{children}</div>
    </div>
  );
}
