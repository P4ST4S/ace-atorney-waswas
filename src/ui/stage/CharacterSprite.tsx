import { useEffect, useRef } from 'react';
import type { ManifestPose } from '../../../asset-meta/manifest-types.ts';
import { assetUrl } from '../../runtime/assets.ts';
import { imageCache } from '../../runtime/image-cache.ts';
import { mulberry32 } from './rng.ts';
import { SpritePlayer } from './sprite-player.ts';
import { spriteRegistry } from './sprite-registry.ts';
import { onTick } from './ticker.ts';

interface CharacterSpriteProps {
  /** Character id: registers the player so the typewriter can animate the mouth. */
  readonly char?: string;
  readonly pose: ManifestPose;
  /** Stage position of the pose anchor. */
  readonly slot: { readonly x: number; readonly y: number };
  readonly talking: boolean;
  readonly seed: number;
  readonly cycling?: boolean;
  readonly testId?: string;
}

/** Positions a pose on its anchor; the animation itself is driven imperatively by SpritePlayer. */
export function CharacterSprite({ char, pose, slot, talking, seed, cycling = false, testId }: CharacterSpriteProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<SpritePlayer | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const player = new SpritePlayer(root, mulberry32(seed));
    playerRef.current = player;
    const unregister = char === undefined ? null : spriteRegistry.register(char, player);
    const unsubscribe = onTick((now) => {
      player.tick(now);
    });
    return () => {
      unsubscribe();
      unregister?.();
      player.dispose();
      playerRef.current = null;
    };
  }, [seed, char]);

  useEffect(() => {
    let cancelled = false;
    const url = assetUrl(pose.url);
    // Only show the pose once its sheet is decoded, to avoid a blank or partially painted frame.
    void imageCache.load(url).then(() => {
      if (!cancelled) playerRef.current?.setPose(pose, url);
    });
    return () => {
      cancelled = true;
    };
  }, [pose, seed, char]);

  useEffect(() => {
    playerRef.current?.setTalking(talking);
  }, [talking, pose, seed, char]);

  useEffect(() => {
    playerRef.current?.setCycling(cycling);
  }, [cycling, pose, seed, char]);

  return (
    <div
      ref={rootRef}
      className="absolute"
      data-testid={testId}
      style={{
        left: slot.x - pose.anchor.x,
        top: slot.y - pose.anchor.y,
        width: pose.size.w,
        height: pose.size.h,
        transform: pose.scale === 1 ? undefined : `scale(${pose.scale})`,
        transformOrigin: `${pose.anchor.x}px ${pose.anchor.y}px`,
      }}
    />
  );
}
