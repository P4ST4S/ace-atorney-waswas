import { useGame, useView } from './context.ts';

const INTERJECTION_IMAGE = { objection: 'ui.objection', holdit: 'ui.holdit', takethat: 'ui.takethat' } as const;

/** Full-screen interjection bubble ("Objection !", "Un instant !", "Prends ça !"). */
export function InterjectionOverlay() {
  const { catalog } = useGame();
  const interjection = useView((s) => s.interjection);
  if (interjection === null) return null;
  const image = catalog.image(INTERJECTION_IMAGE[interjection.kind]);
  return (
    <div key={interjection.key} className="pointer-events-none absolute inset-0 flex items-center justify-center" data-testid="interjection" data-kind={interjection.kind}>
      <img src={image.url} alt="" className="interjection-pop h-[92%] w-auto max-w-none" draggable={false} />
    </div>
  );
}

export function Toasts() {
  const toasts = useView((s) => s.toasts);
  return (
    <div className="pointer-events-none absolute top-[4%] right-0 left-0 flex flex-col items-center gap-2">
      {toasts.map((toast) => (
        <div key={toast.key} className="toast-in rounded-full border-2 border-amber-300 bg-black/75 px-[max(12px,calc(30px*var(--scene-scale)))] py-1 text-[max(14px,calc(34px*var(--scene-scale)))] font-extrabold text-amber-300" data-testid="toast">
          {toast.text}
        </div>
      ))}
    </div>
  );
}

/** Content errors, retry prompts for essential resources, and the end screen. */
export function StatusOverlays({ onRestart }: { readonly onRestart: () => void }) {
  const { chapter } = useGame();
  const error = useView((s) => s.error);
  const retry = useView((s) => s.retry);
  const ended = useView((s) => s.ended);
  if (error !== null) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6 text-center" data-testid="error">
        <p className="max-w-[80%] text-[max(14px,calc(30px*var(--scene-scale)))] text-red-300">{error}</p>
      </div>
    );
  }
  if (retry !== null) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80" data-testid="retry">
        <p className="text-[max(14px,calc(30px*var(--scene-scale)))]">{retry.message}</p>
        <button type="button" className="rounded border-2 border-white px-6 py-2 font-bold" onClick={retry.onRetry}>Réessayer</button>
      </div>
    );
  }
  if (ended !== null) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/80" data-testid="ended" data-ending={ended}>
        <p className="text-[max(18px,calc(64px*var(--scene-scale)))] font-extrabold">{chapter.endings[ended]?.title ?? ended}</p>
        <button type="button" className="rounded border-2 border-white px-6 py-2 font-bold" onClick={onRestart}>Recommencer</button>
      </div>
    );
  }
  return null;
}
