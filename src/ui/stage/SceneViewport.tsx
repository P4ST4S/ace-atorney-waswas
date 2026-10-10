import { useLayoutEffect, useRef, type ReactNode } from 'react';

export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

interface SceneViewportProps {
  /** Scene content in fixed 1920x1080 stage coordinates. */
  readonly scene: ReactNode;
  /** UI overlay laid out in CSS pixels over the scene rectangle; reads `--scene-scale`. */
  readonly ui?: ReactNode;
}

/**
 * Letterboxed 16:9 viewport. The scene is scaled uniformly; the UI layer is not transformed so text keeps
 * a readable minimum size (it derives its sizes from the `--scene-scale` CSS variable).
 */
export function SceneViewport({ scene, ui }: SceneViewportProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const frame = frameRef.current;
    const sceneEl = sceneRef.current;
    if (outer === null || frame === null || sceneEl === null) return;
    const apply = (): void => {
      const { width, height } = outer.getBoundingClientRect();
      const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
      frame.style.width = `${STAGE_WIDTH * scale}px`;
      frame.style.height = `${STAGE_HEIGHT * scale}px`;
      frame.style.left = `${(width - STAGE_WIDTH * scale) / 2}px`;
      frame.style.top = `${(height - STAGE_HEIGHT * scale) / 2}px`;
      frame.style.setProperty('--scene-scale', String(scale));
      sceneEl.style.transform = `scale(${scale})`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(outer);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={outerRef} className="relative h-full w-full overflow-hidden bg-black" data-testid="viewport">
      <div ref={frameRef} className="absolute overflow-hidden" data-testid="scene-frame">
        <div
          ref={sceneRef}
          className="absolute top-0 left-0 origin-top-left overflow-hidden"
          style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}
          data-testid="scene"
        >
          {scene}
        </div>
        <div className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto">{ui}</div>
      </div>
    </div>
  );
}
