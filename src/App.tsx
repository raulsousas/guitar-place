import { useMemo, useState } from 'react';
import type { FretRegion } from './types/position';
import { useAudioCapture } from './hooks/useAudioCapture';
import { useStudio } from './hooks/useStudio';
import { inferenceForLiveNote, normalizeRegion } from './inference/position';
import { STANDARD_TUNING } from './music/tuning';
import { AudioPanel } from './components/AudioPanel';
import { DEFAULT_FRET_COUNT, FRET_COUNT_OPTIONS, FretboardPanel } from './components/FretboardPanel';
import { Header } from './components/Header';
import { HistoryPanel } from './components/HistoryPanel';
import { SuggestionsPanel, TipsPanel } from './components/Panels';
import { TablaturePanel } from './components/TablaturePanel';
import { StatusCards } from './components/StatusCards';
import { StudioPanel } from './components/studio/StudioPanel';
import { TunerPanel } from './components/TunerPanel';
import { TuningPanel } from './components/TuningPanel';

type View = 'tracker' | 'tuner' | 'studio';

const VIEWS: { id: View; label: string }[] = [
  { id: 'tracker', label: 'Rastreador' },
  { id: 'tuner', label: 'Afinador' },
  { id: 'studio', label: 'Estúdio' },
];

export function App() {
  const [requestedFretCount, setFretCount] = useState<number>(DEFAULT_FRET_COUNT);
  // Valor fora das opções (estado antigo, NaN, 0) deixaria o braço sem trastes: cai no padrão.
  const fretCount = (FRET_COUNT_OPTIONS as readonly number[]).includes(requestedFretCount) ? requestedFretCount : DEFAULT_FRET_COUNT;
  const [requestedRegion, setRegion] = useState<FretRegion | null>(null);
  const region = useMemo(() => normalizeRegion(requestedRegion, fretCount), [requestedRegion, fretCount]);
  const audio = useAudioCapture(fretCount, region);
  // O Estúdio vive no App (não na aba) para a saída e os ajustes sobreviverem à troca de aba.
  const studio = useStudio(audio.graph);
  const [view, setView] = useState<View>('tracker');
  const liveMidi = audio.status === 'active' ? (audio.live.note?.midi ?? null) : null;
  const inference = useMemo(
    () => inferenceForLiveNote(liveMidi, audio.lastInference, STANDARD_TUNING, fretCount, region),
    [liveMidi, audio.lastInference, fretCount, region],
  );
  return (
    <div className="app">
      <Header status={audio.status} deviceLabel={audio.info?.deviceLabel ?? null} />
      <div className="layout">
        <aside className="sidebar">
          <AudioPanel audio={audio} />
          <TuningPanel />
        </aside>
        <main className="main">
          <div className="view-tabs" role="tablist" aria-label="Modo">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                id={`tab-${v.id}`}
                aria-selected={view === v.id}
                aria-controls={`view-${v.id}`}
                className={view === v.id ? 'view-tab active' : 'view-tab'}
                onClick={() => setView(v.id)}
                data-testid={`tab-${v.id}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {view === 'tracker' ? (
            <div id="view-tracker" role="tabpanel" aria-labelledby="tab-tracker" className="view">
              <StatusCards audio={audio} inference={inference} />
              <FretboardPanel
                midi={liveMidi}
                inference={inference}
                fretCount={fretCount}
                onFretCountChange={setFretCount}
                region={region}
                onRegionChange={setRegion}
                revisions={audio.revisions}
              />
              <TablaturePanel
                items={audio.tabItems}
                paused={audio.tabPaused}
                capturing={audio.status === 'active'}
                onPausedChange={audio.setTabPaused}
                onClear={audio.clearEvents}
                onCorrect={audio.correctTab}
              />
              <div className="bottom">
                <HistoryPanel items={audio.tabItems} />
                <SuggestionsPanel inference={inference} />
                <TipsPanel />
              </div>
            </div>
          ) : view === 'tuner' ? (
            <div id="view-tuner" role="tabpanel" aria-labelledby="tab-tuner" className="view">
              <TunerPanel audio={audio} />
            </div>
          ) : (
            <div id="view-studio" role="tabpanel" aria-labelledby="tab-studio" className="view">
              <StudioPanel studio={studio} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}