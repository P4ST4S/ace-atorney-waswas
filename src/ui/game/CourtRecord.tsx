import { useEffect, useState } from 'react';
import type { CompiledChapter, CourtRecord as Record_ } from '../../engine/types.ts';
import type { AssetCatalog } from '../../runtime/assets.ts';
import { useGame, useView } from './context.ts';

export interface RecordItemView {
  readonly id: string;
  readonly kind: 'evidence' | 'profile';
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly detail: string | null;
}

/** Resolves an evidence (with its current variant) or a profile into what the Court Record displays. */
export function recordItem(id: string, kind: 'evidence' | 'profile', chapter: CompiledChapter, catalog: AssetCatalog, record: Record_): RecordItemView | null {
  if (kind === 'profile') {
    const profile = chapter.profiles[id];
    if (profile === undefined) return null;
    return { id, kind, name: chapter.characters[id]?.name ?? id, description: profile.description, icon: catalog.image(profile.portrait).url, detail: null };
  }
  const def = chapter.evidence[id];
  if (def === undefined) return null;
  const variantKey = record.variants[id];
  const variant = variantKey === undefined ? undefined : def.variants?.[variantKey];
  const detail = variant?.detail ?? def.detail;
  return {
    id,
    kind,
    name: variant?.name ?? def.name,
    description: variant?.description ?? def.description,
    icon: catalog.image(variant?.icon ?? def.icon).url,
    detail: detail === undefined ? null : catalog.image(detail).url,
  };
}

/** Icon inside the original evidence frame. */
export function FramedIcon({ src, className = '' }: { readonly src: string; readonly className?: string }) {
  const { catalog } = useGame();
  const frame = catalog.image('ui.evidence-frame').url;
  return (
    <div className={`relative aspect-square ${className}`}>
      <img src={frame} alt="" className="absolute inset-0 h-full w-full" draggable={false} />
      <img src={src} alt="" className="absolute inset-[16%] h-[68%] w-[68%] object-contain" draggable={false} />
    </div>
  );
}

interface CourtRecordProps {
  readonly mode: 'view' | 'present';
  readonly onClose: () => void;
  readonly onPresent: (item: string) => void;
}

const stop = (event: { stopPropagation: () => void }): void => {
  event.stopPropagation();
};

/** The Court Record ("Dossier"): evidence and profiles, detail view, and presenting in cross-examination. */
export function CourtRecord({ mode, onClose, onPresent }: CourtRecordProps) {
  const { chapter, catalog } = useGame();
  const record = useView((s) => s.record);
  const [tab, setTab] = useState<'evidence' | 'profile'>('evidence');
  const ids = tab === 'evidence' ? record.evidence : record.profiles;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const items = ids.map((id) => recordItem(id, tab, chapter, catalog, record)).filter((i): i is RecordItemView => i !== null);
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (detail !== null) setDetail(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [detail, onClose]);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/55" onPointerDown={stop} data-testid="court-record" data-mode={mode}>
      <div className="flex h-[78%] w-[86%] flex-col gap-[3%] rounded-[calc(16px*var(--scene-scale))] border-[max(2px,calc(4px*var(--scene-scale)))] border-box-edge bg-[#13204a]/95 p-[2.5%] text-[max(14px,calc(32px*var(--scene-scale)))]">
        <div className="flex items-center gap-3">
          <span className="mr-auto font-extrabold tracking-wide">{mode === 'present' ? 'Présenter une preuve' : 'Dossier'}</span>
          {(['evidence', 'profile'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`rounded-full border-2 px-[1.2em] py-[0.15em] font-bold ${tab === t ? 'border-amber-300 bg-amber-300 text-black' : 'border-white/70'}`}
              onClick={() => { setTab(t); setSelectedId(null); }}
              data-testid={`record-tab-${t}`}
            >
              {t === 'evidence' ? 'Preuves' : 'Profils'}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 gap-[3%]">
          <div className="grid w-[45%] auto-rows-min grid-cols-4 content-start gap-[6%] overflow-y-auto">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rounded-lg p-[6%] ${selected?.id === item.id ? 'bg-amber-300/40 ring-2 ring-amber-300' : 'hover:bg-white/10'}`}
                onClick={() => { setSelectedId(item.id); }}
                aria-label={item.name}
                data-testid={`record-item-${item.id}`}
              >
                <FramedIcon src={item.icon} />
              </button>
            ))}
            {items.length === 0 && <p className="col-span-4 text-white/60">Vide.</p>}
          </div>
          {selected !== null && (
            <div className="flex min-w-0 flex-1 flex-col gap-[4%]" data-testid="record-selected" data-item={selected.id}>
              <div className="flex gap-[4%]">
                <FramedIcon src={selected.icon} className="w-[34%] shrink-0" />
                <div className="min-w-0">
                  <p className="font-extrabold text-amber-300">{selected.name}</p>
                  <p className="mt-2 leading-snug font-semibold">{selected.description}</p>
                </div>
              </div>
              <div className="mt-auto flex flex-wrap justify-end gap-3">
                {selected.detail !== null && (
                  <button type="button" className="rounded border-2 border-white px-[1em] py-[0.2em] font-bold" onClick={() => { setDetail(selected.detail); }} data-testid="record-examine">
                    Examiner
                  </button>
                )}
                {mode === 'present' && (
                  <button
                    type="button"
                    className="rounded border-2 border-red-400 bg-red-600 px-[1em] py-[0.2em] font-extrabold"
                    onClick={() => { onPresent(selected.id); }}
                    data-testid="record-present"
                  >
                    Présenter
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <button type="button" className="rounded border-2 border-white/70 px-[1em] py-[0.2em] font-bold" onClick={onClose} data-testid="record-close">
            Retour
          </button>
        </div>
      </div>
      {detail !== null && <EvidenceDetail src={detail} onClose={() => { setDetail(null); }} />}
    </div>
  );
}

/**
 * Full-screen detail of an evidence image, sized to the device (not to the 1920x1080 scene):
 * tall screenshots fit the width and scroll; a click toggles zoom.
 */
export function EvidenceDetail({ src, onClose }: { readonly src: string; readonly onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/92" onPointerDown={stop} data-testid="evidence-detail">
      <div className="flex justify-end gap-2 p-3">
        <button type="button" className="rounded border-2 border-white px-4 py-1 font-bold" onClick={() => { setZoomed((z) => !z); }} data-testid="detail-zoom">
          {zoomed ? 'Dézoomer' : 'Zoomer'}
        </button>
        <button type="button" className="rounded border-2 border-white px-4 py-1 font-bold" onClick={onClose} data-testid="detail-close">
          Fermer
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3" data-testid="detail-scroll">
        <img
          src={src}
          alt="Preuve"
          className={`mx-auto block cursor-zoom-in ${zoomed ? 'w-[200%] max-w-none' : 'w-full max-w-[min(100%,720px)]'}`}
          onClick={() => { setZoomed((z) => !z); }}
          draggable={false}
        />
      </div>
    </div>
  );
}
