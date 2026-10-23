import { useState } from 'react';
import type { StudioApi } from '../../hooks/useStudio';
import { MEASURE_MS } from '../../hooks/useStudio';
import { AlertIcon } from '../icons';

const REASONS = {
  unavailable: 'Ligue a saída (painel ao lado) para medir: só então o sinal da guitarra chega ao Estúdio.',
  'no-signal': 'Nenhum sinal chegou. Confira o canal de entrada, o cabo e o ganho da interface.',
  'too-loud': 'Havia som alto demais. Abafe as cordas com a mão e meça de novo.',
  unstable: 'O nível variou durante a medida (uma corda soou?). Abafe todas as cordas e meça de novo.',
  'too-few': 'Poucas leituras. Tente de novo.',
} as const;

type State = { kind: 'idle' } | { kind: 'measuring' } | { kind: 'done'; noiseDb: number; thresholdDb: number } | { kind: 'error'; message: string };

/**
 * Mede o ruído de fundo (cordas abafadas) e define o limiar do portão. Mostra o que foi medido; não promete nada sobre o resultado
 * de ouvido. O portão só fecha de verdade se o limiar ficar acima do ruído e abaixo das notas mais fracas que você toca.
 */
export function NoiseMeasureControl({ studio }: { studio: StudioApi }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const run = async () => {
    setState({ kind: 'measuring' });
    const r = await studio.measureNoise();
    if (!r.ok) {
      setState({ kind: 'error', message: REASONS[r.reason] });
      return;
    }
    studio.update((p) => ({ ...p, gate: { enabled: true, thresholdDb: r.thresholdDb } }));
    setState({ kind: 'done', noiseDb: r.noiseDb, thresholdDb: r.thresholdDb });
  };
  return (
    <div className="noise-measure" data-testid="noise-measure">
      <button type="button" className="btn secondary" disabled={state.kind === 'measuring'} onClick={() => void run()} data-testid="noise-measure-btn">
        {state.kind === 'measuring' ? 'Medindo…' : 'Medir ruído de fundo'}
      </button>
      <p className="note-small">
        Abafe todas as cordas com a mão e clique. O Estúdio lê o nível por {MEASURE_MS / 1000} s e ajusta o limiar acima dele. A saída precisa estar ligada.
      </p>
      {state.kind === 'done' ? (
        <p className="note-small" role="status" data-testid="noise-measure-result">
          Ruído medido: {state.noiseDb.toFixed(0)} dBFS (RMS). Limiar definido em {state.thresholdDb} dB e portão ligado. Se notas fracas forem cortadas,
          baixe o limiar.
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p className="meter-warn" role="alert" data-testid="noise-measure-error">
          <AlertIcon size={13} /> {state.message}
        </p>
      ) : null}
    </div>
  );
}