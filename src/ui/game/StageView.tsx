import { useCallback, useMemo } from 'react';
import { assetUrl } from '../../runtime/assets.ts';
import { resolveScene } from '../../runtime/scene.ts';
import { CharacterSprite } from '../stage/CharacterSprite.tsx';
import { useGame, useView } from './context.ts';

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Renders the displayed stage snapshot: background, characters, foreground, flash layer. */
export function StageView() {
  const { presenter, chapter, catalog } = useGame();
  const stage = useView((s) => s.stage);
  const scene = useMemo(() => (stage === null ? null : resolveScene(stage, chapter, catalog)), [stage, chapter, catalog]);

  const sceneRef = useCallback((el: HTMLDivElement | null) => {
    presenter.attachScene(el);
  }, [presenter]);
  const flashRef = useCallback((el: HTMLDivElement | null) => {
    presenter.attachFlash(el);
  }, [presenter]);

  const place = stage === null ? 'none' : stage.place.k === 'court' ? `court:${stage.place.view}` : stage.place.k === 'location' ? `location:${stage.place.place}` : 'none';
  const actors = stage === null ? '' : Object.entries(stage.court).map(([pos, a]) => `${pos}=${a.char}:${a.pose}`).sort().join(',');

  return (
    <div ref={sceneRef} className="absolute inset-0" data-testid="stage" data-place={place} data-actors={actors}>
      {scene !== null && (
        <>
          <img src={assetUrl(scene.bg.url)} width={scene.bg.w} height={scene.bg.h} alt="" className="absolute top-0 left-0 max-w-none" draggable={false} />
          {scene.actors.map((actor) => (
            <CharacterSprite key={actor.char} char={actor.char} pose={actor.pose} slot={actor.slot} talking={false} seed={seedOf(actor.char)} testId={`actor-${actor.char}`} />
          ))}
          {scene.fg !== null && (
            <img
              src={assetUrl(scene.fg.image.url)}
              width={scene.fg.image.w}
              height={scene.fg.image.h}
              alt=""
              className="absolute max-w-none"
              style={{ left: scene.fg.x, top: scene.fg.y }}
              draggable={false}
            />
          )}
        </>
      )}
      <div ref={flashRef} className="pointer-events-none absolute inset-0 bg-white opacity-0" />
    </div>
  );
}
