import { courtViews, locationViews, type SceneView } from '../../asset-meta/assets.ts';
import type { ManifestImage, ManifestPose } from '../../asset-meta/manifest-types.ts';
import type { CompiledChapter, Stage } from '../engine/types.ts';
import { assetUrl, type AssetCatalog } from './assets.ts';

export interface ResolvedActor {
  readonly char: string;
  readonly pose: ManifestPose;
  readonly slot: { readonly x: number; readonly y: number };
}

/** A stage snapshot resolved to concrete images and sprite poses. */
export interface ResolvedScene {
  readonly bg: ManifestImage;
  readonly fg: { readonly image: ManifestImage; readonly x: number; readonly y: number } | null;
  readonly actors: readonly ResolvedActor[];
}

function isPlaceId(place: string): place is keyof typeof locationViews {
  return place in locationViews;
}

function viewOf(stage: Stage): SceneView | null {
  switch (stage.place.k) {
    case 'none':
      return null;
    case 'court':
      return courtViews[stage.place.view];
    case 'location':
      if (!isPlaceId(stage.place.place)) throw new Error(`Unknown place "${stage.place.place}"`);
      return locationViews[stage.place.place];
  }
}

export function resolveScene(stage: Stage, chapter: CompiledChapter, catalog: AssetCatalog): ResolvedScene | null {
  const view = viewOf(stage);
  if (view === null) return null;
  const actor = stage.place.k === 'court'
    ? (stage.place.view === 'wide' ? null : (stage.court[stage.place.view] ?? null))
    : stage.actor;
  const actors: ResolvedActor[] = [];
  if (actor !== null) {
    const def = chapter.characters[actor.char];
    if (def === undefined) throw new Error(`Unknown character "${actor.char}"`);
    actors.push({ char: actor.char, pose: catalog.pose(def.sprite, def.poses[actor.pose] ?? actor.pose), slot: view.slot });
  }
  return {
    bg: catalog.image(view.bg),
    fg: view.fg === undefined ? null : { image: catalog.image(view.fg.image), x: view.fg.x, y: view.fg.y },
    actors,
  };
}

/** Every image a scene needs (decoded before the scene is shown). */
export function sceneImageUrls(scene: ResolvedScene): string[] {
  return [scene.bg.url, ...(scene.fg === null ? [] : [scene.fg.image.url]), ...scene.actors.map((a) => a.pose.url)].map(assetUrl);
}
