import { useEffect, useRef } from 'react';
import { onTick } from '../ui/stage/ticker.ts';

const WINDOW = 240;
const FRAME_BUDGET_MS = 1000 / 60;

function readHeapMb(): number | null {
  // `performance.memory` is a non-standard Chrome API; decoded image memory is not exposed to JS at all.
  if (!('memory' in performance)) return null;
  const memory: unknown = performance.memory;
  if (typeof memory !== 'object' || memory === null || !('usedJSHeapSize' in memory)) return null;
  const used = memory.usedJSHeapSize;
  return typeof used === 'number' ? used / 1048576 : null;
}

/** Development HUD: frame regularity (p95 interval, dropped frames), long tasks and JS heap. */
export function PerfHud() {
  const textRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const intervals: number[] = [];
    let last = 0;
    let dropped = 0;
    let longTasks = 0;
    let lastPaint = 0;
    const observer = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')
      ? new PerformanceObserver((list) => { longTasks += list.getEntries().length; })
      : null;
    observer?.observe({ type: 'longtask', buffered: true });
    const unsubscribe = onTick((now) => {
      if (last > 0) {
        const dt = now - last;
        intervals.push(dt);
        if (intervals.length > WINDOW) intervals.shift();
        if (dt > FRAME_BUDGET_MS * 1.5) dropped += 1;
      }
      last = now;
      if (now - lastPaint < 250 || textRef.current === null) return;
      lastPaint = now;
      const sorted = [...intervals].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      const heap = readHeapMb();
      textRef.current.textContent =
        `frame p95 ${p95.toFixed(1)} ms\ndropped ${dropped}\nlong tasks ${longTasks}` + (heap === null ? '' : `\nJS heap ${heap.toFixed(0)} MB`);
      textRef.current.dataset.p95 = p95.toFixed(2);
      textRef.current.dataset.dropped = String(dropped);
      textRef.current.dataset.longtasks = String(longTasks);
    });
    return () => {
      unsubscribe();
      observer?.disconnect();
    };
  }, []);

  return <pre ref={textRef} className="fixed top-2 right-2 z-50 rounded bg-black/70 p-2 font-mono text-xs text-green-300" data-testid="perf-hud" />;
}
