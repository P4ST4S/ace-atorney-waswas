/** One shared requestAnimationFrame loop for every imperative animation (sprites, typewriter, HUD). */
type TickFn = (now: number) => void;

const subscribers = new Set<TickFn>();
let handle: number | null = null;

function loop(now: number): void {
  for (const fn of subscribers) fn(now);
  handle = subscribers.size > 0 ? requestAnimationFrame(loop) : null;
}

/** Subscribes to animation frames; returns an unsubscribe function (idempotent). */
export function onTick(fn: TickFn): () => void {
  subscribers.add(fn);
  handle ??= requestAnimationFrame(loop);
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && handle !== null) {
      cancelAnimationFrame(handle);
      handle = null;
    }
  };
}
