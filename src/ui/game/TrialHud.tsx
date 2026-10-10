import { useGame, useView } from './context.ts';
import { FramedIcon, recordItem } from './CourtRecord.tsx';

const stop = (event: { stopPropagation: () => void }): void => {
  event.stopPropagation();
};

/** Health bar (AA2/AA3 style) and labelled counters such as Wassim's EXP. */
export function HealthBar() {
  const { chapter } = useGame();
  const visible = useView((s) => s.healthBar);
  const health = useView((s) => s.health);
  const max = useView((s) => s.healthMax);
  const damageKey = useView((s) => s.damageKey);
  const vars = useView((s) => s.vars);
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute top-[3%] left-[2%] flex w-[30%] flex-col gap-1">
      <div
        key={damageKey}
        className={`h-[max(10px,calc(28px*var(--scene-scale)))] overflow-hidden rounded-full border-[max(2px,calc(3px*var(--scene-scale)))] border-white bg-black/70 ${damageKey > 0 ? 'damage-flash' : ''}`}
        data-testid="health"
        data-health={health}
      >
        <div className="h-full bg-linear-to-r from-emerald-500 to-lime-300 transition-[width] duration-700 ease-out" style={{ width: `${(health / max) * 100}%` }} />
      </div>
      {Object.entries(vars).map(([name, value]) => (
        <div key={name} className="w-fit rounded-full bg-black/70 px-3 text-[max(12px,calc(26px*var(--scene-scale)))] font-extrabold text-amber-300" data-testid={`var-${name}`}>
          {chapter.vars[name]?.label ?? name} : {String(value)}
        </div>
      ))}
    </div>
  );
}

interface CrossExamBarProps {
  readonly onPress: () => void;
  readonly onPresent: () => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
}

/** Cross-examination controls: statement navigation, Press and Present. */
export function CrossExamBar({ onPress, onPresent, onPrev, onNext }: CrossExamBarProps) {
  const ce = useView((s) => s.line?.ce ?? null);
  const ready = useView((s) => s.inputReady);
  if (ce === null || !ready) return null;
  const button = 'rounded-[calc(10px*var(--scene-scale))] border-[max(2px,calc(4px*var(--scene-scale)))] px-[1.1em] py-[0.15em] font-extrabold shadow-lg';
  return (
    <div onPointerDown={stop} className="absolute right-[2%] bottom-[36%] left-[2%] flex items-end text-[max(14px,calc(38px*var(--scene-scale)))]" data-testid="ce-bar" data-stmt={ce.stmt}>
      <button type="button" className={`${button} mr-auto border-white bg-sky-700`} onClick={onPress} data-testid="ce-press">
        Presser
      </button>
      <div className="flex gap-3">
        <button type="button" disabled={ce.isFirst} className={`${button} border-white bg-black/70 disabled:opacity-30`} onClick={onPrev} aria-label="Déclaration précédente" data-testid="ce-prev">
          ◀
        </button>
        <button type="button" className={`${button} border-white bg-black/70`} onClick={onNext} aria-label="Déclaration suivante" data-testid="ce-next">
          ▶
        </button>
      </div>
      <button type="button" className={`${button} ml-auto border-red-300 bg-red-600`} onClick={onPresent} data-testid="ce-present">
        Présenter
      </button>
    </div>
  );
}

/** "Témoignage" / "Contre-interrogatoire" banner. */
export function Banner() {
  const banner = useView((s) => s.banner);
  if (banner === null) return null;
  return (
    <div key={banner.key} className="pointer-events-none absolute inset-x-0 top-[34%] flex flex-col items-center" data-testid="banner" data-kind={banner.kind}>
      <div className="banner-slide w-full bg-linear-to-r from-transparent via-black/85 to-transparent py-[1.2%] text-center">
        <p className="text-[max(22px,calc(84px*var(--scene-scale)))] font-extrabold tracking-wider text-amber-300 drop-shadow-[0_3px_0_#7a2d00]">
          {banner.kind === 'testimony' ? '~ Témoignage ~' : '~ Contre-interrogatoire ~'}
        </p>
        {banner.kind === 'testimony' && <p className="text-[max(14px,calc(40px*var(--scene-scale)))] font-bold text-white">{banner.title}</p>}
      </div>
    </div>
  );
}

/** Verdict letters ("Coupable", "Non coupable") revealed one by one. */
export function Verdict() {
  const verdict = useView((s) => s.verdict);
  if (verdict === null) return null;
  const guilty = !verdict.text.toLowerCase().startsWith('non');
  return (
    <div key={verdict.key} className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35" data-testid="verdict">
      <p className={`flex flex-wrap justify-center gap-x-[0.06em] text-[max(28px,calc(150px*var(--scene-scale)))] font-black uppercase ${guilty ? 'text-red-600' : 'text-white'} drop-shadow-[0_6px_0_rgb(0_0_0/0.8)]`}>
        {Array.from(new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment(verdict.text), (s) => s.segment).map((char, i) => (
          <span key={i} className="verdict-letter" style={{ animationDelay: `${i * 110}ms` }}>
            {char === ' ' ? '\u00A0' : char}
          </span>
        ))}
      </p>
    </div>
  );
}

/** "X ajouté au Dossier" popup. */
export function RecordPopup() {
  const { chapter, catalog } = useGame();
  const popup = useView((s) => s.recordPopup);
  const record = useView((s) => s.record);
  if (popup === null) return null;
  const item = recordItem(popup.item, popup.kind, chapter, catalog, record);
  if (item === null) return null;
  return (
    <div key={popup.key} className="toast-in pointer-events-none absolute top-[12%] left-1/2 flex w-[60%] -translate-x-1/2 items-center gap-[4%] rounded-xl border-[max(2px,calc(4px*var(--scene-scale)))] border-box-edge bg-box p-[2%] text-[max(14px,calc(34px*var(--scene-scale)))]" data-testid="record-popup">
      <FramedIcon src={item.icon} className="w-[22%] shrink-0" />
      <div>
        <p className="font-extrabold text-amber-300">{item.name}</p>
        <p className="font-semibold">{popup.act === 'add' ? 'ajouté au Dossier.' : 'mis à jour dans le Dossier.'}</p>
      </div>
    </div>
  );
}

/** Opens the Court Record (always available outside effects). */
export function RecordButton({ onOpen }: { readonly onOpen: () => void }) {
  const ready = useView((s) => s.inputReady);
  const hasRecord = useView((s) => s.record.evidence.length + s.record.profiles.length > 0);
  if (!ready || !hasRecord) return null;
  return (
    <button
      type="button"
      onPointerDown={stop}
      onClick={onOpen}
      className="absolute top-[3%] right-[2%] rounded-[calc(10px*var(--scene-scale))] border-[max(2px,calc(4px*var(--scene-scale)))] border-white bg-amber-600 px-[1em] py-[0.15em] text-[max(13px,calc(32px*var(--scene-scale)))] font-extrabold shadow-lg"
      data-testid="record-button"
    >
      Dossier
    </button>
  );
}
