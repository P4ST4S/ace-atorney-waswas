import { lazy, Suspense, use, useState } from 'react';
import { getGame } from './boot.ts';
import { GameContext } from './ui/game/context.ts';
import { GameScreen } from './ui/game/GameScreen.tsx';

const StagePage = lazy(() => import('./dev/StagePage.tsx').then((m) => ({ default: m.StagePage })));

function Game() {
  const services = use(getGame());
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <button
        type="button"
        className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-6 bg-black font-game text-white"
        data-testid="start"
        onClick={() => {
          // The click is the user gesture browsers require before any audio can play.
          void services.audio.unlock().finally(() => {
            services.director.newGame();
            setStarted(true);
          });
        }}
      >
        <span className="text-4xl font-extrabold tracking-wide">{services.chapter.title}</span>
        <span className="animate-pulse text-xl">Cliquez pour commencer</span>
        <span className="absolute bottom-4 text-xs text-neutral-500">Fan-game non officiel, non affilié à Capcom.</span>
      </button>
    );
  }
  return (
    <GameContext value={services}>
      <GameScreen />
    </GameContext>
  );
}

export function App() {
  const devStage = import.meta.env.DEV && window.location.pathname === '/dev/stage';
  return (
    <Suspense fallback={<div className="p-4 text-white">Chargement…</div>}>
      {devStage ? <StagePage /> : <Game />}
    </Suspense>
  );
}
