import { use, useState } from 'react';
import { courtViews, type CourtPos } from '../../asset-meta/assets.ts';
import { AssetCatalog } from '../runtime/assets.ts';
import { DialogueBox } from '../ui/DialogueBox.tsx';
import { CharacterSprite } from '../ui/stage/CharacterSprite.tsx';
import { SceneViewport } from '../ui/stage/SceneViewport.tsx';
import { PerfHud } from './PerfHud.tsx';

const catalogPromise = AssetCatalog.load();

type ViewId = CourtPos | 'wide';
const VIEWS: readonly ViewId[] = ['defense', 'prosecution', 'witness', 'judge', 'cocounsel', 'wide'];

/** Who stands where in this test page (milestone 1). */
const CAST: Partial<Record<ViewId, { rig: string; name: string }>> = {
  witness: { rig: 'ron-delite', name: 'Wassim' },
  defense: { rig: 'phoenix-wright', name: 'Phoenix' },
  prosecution: { rig: 'miles-edgeworth', name: 'Mimi' },
  judge: { rig: 'judges', name: 'Le Juge' },
};

function readParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function isViewId(value: string | null): value is ViewId {
  return value !== null && (VIEWS as readonly string[]).includes(value);
}

/** Development page: composes courtroom views and characters to validate rendering (milestone 1). */
export function StagePage() {
  const catalog = use(catalogPromise);
  const initialView = readParam('view');
  const [view, setView] = useState<ViewId>(isViewId(initialView) ? initialView : 'witness');
  const [pose, setPose] = useState(readParam('pose') ?? 'normal');
  const [talking, setTalking] = useState(readParam('talk') === '1');
  const [cycling, setCycling] = useState(false);
  const [showUi, setShowUi] = useState(readParam('ui') !== '0');

  const layout = courtViews[view];
  const bg = catalog.image(layout.bg);
  const desk = layout.fg === undefined ? undefined : { ...layout.fg, image: catalog.image(layout.fg.image) };
  const cast = CAST[view];
  const poses = cast === undefined ? [] : catalog.poses(cast.rig);
  const activePose = cast === undefined ? undefined : catalog.pose(cast.rig, poses.includes(pose) ? pose : (poses[0] ?? 'normal'));

  const scene = (
    <>
      <img src={bg.url} width={bg.w} height={bg.h} alt="" className="absolute top-0 left-0 max-w-none" data-testid="background" />
      {cast !== undefined && activePose !== undefined && (
        <CharacterSprite pose={activePose} slot={layout.slot} talking={talking} cycling={cycling} seed={7} testId="character" />
      )}
      {desk !== undefined && (
        <img src={desk.image.url} width={desk.image.w} height={desk.image.h} alt="" className="absolute max-w-none" style={{ left: desk.x, top: desk.y }} data-testid="desk" />
      )}
    </>
  );

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <PerfHud />
      <div className="flex flex-wrap items-center gap-3 p-2 text-sm text-white" data-testid="controls">
        <select value={view} onChange={(e) => { if (isViewId(e.target.value)) setView(e.target.value); }} className="bg-neutral-800 p-1" aria-label="Vue">
          {VIEWS.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={pose} onChange={(e) => { setPose(e.target.value); }} className="bg-neutral-800 p-1" aria-label="Pose" disabled={poses.length === 0}>
          {poses.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label><input type="checkbox" checked={talking} onChange={(e) => { setTalking(e.target.checked); }} /> parle</label>
        <label><input type="checkbox" checked={cycling} onChange={(e) => { setCycling(e.target.checked); }} /> test de scintillement</label>
        <label><input type="checkbox" checked={showUi} onChange={(e) => { setShowUi(e.target.checked); }} /> UI</label>
      </div>
      <div className="min-h-0 flex-1">
        <SceneViewport
          scene={scene}
          ui={showUi ? (
            <DialogueBox name={cast?.name ?? 'Le Juge'}>
              J'étais chez moi toute la soirée, je vous le jure&#8239;! Demandez à mon chat&#8239;!
            </DialogueBox>
          ) : null}
        />
      </div>
    </div>
  );
}
