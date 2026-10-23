import type { AudioCaptureApi } from '../hooks/useAudioCapture';
import { midiToPtName } from '../music/notes';
import type { PositionInference } from '../types/position';
import { Panel, Unavailable } from './Panel';
import { NoteIcon, TargetIcon, WaveformIcon } from './icons';
import { positionLabel } from './positionLabel';

const QUALIFIER: Record<PositionInference['state'], string> = {
  unique: 'Posição única possível',
  confident: 'Estimada pelo contexto (sem confirmação física)',
  ambiguous: 'Ambígua: melhor estimativa, não confirmada',
  unknown: 'Fora do alcance do braço',
};

function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  return `${rounded > 0 ? '+' : ''}${rounded} cents`;
}

/**
 * Quatro cartões da referência. Nota, frequência e confiança vêm do motor de detecção.
 * A confiança da NOTA (altura) e a da POSIÇÃO (corda/casa, Fase 4) são campos independentes.
 */
export function StatusCards({
  audio,
  inference,
}: {
  audio: AudioCaptureApi;
  /** Inferência de posição da nota ao vivo (Etapa B), ou null. */
  inference: PositionInference | null;
}) {
  const { status, live, stats, lastNote } = audio;
  const capturing = status === 'active';
  const note = live.note;

  let noteState: string | null = null;
  if (!capturing) noteState = 'Inicie a captura';
  else if (!note) noteState = live.gateOpen ? 'Sem nota válida' : 'Silêncio';

  const confidence = note ? Math.round(note.pitchConfidence * 100) : null;
  const latency = lastNote?.latency ?? null;

  return (
    <div className="cards">
      <Panel title="Nota detectada" icon={<NoteIcon size={26} />} className="card" testId="card-note">
        {note && capturing ? (
          <>
            <p className="value live" data-testid="note-value">
              {midiToPtName(note.midi)}
            </p>
            <p className="hint strong" data-testid="note-frequency">
              {note.frequency.toFixed(2)} Hz · {formatCents(note.cents)}
            </p>
            {!note.pitched ? <p className="hint">Sustentando, sem altura clara no momento</p> : null}
          </>
        ) : (
          <>
            <p className="value" data-testid="note-value">
              —
            </p>
            <p className="hint" data-testid="note-state">
              {noteState}
            </p>
          </>
        )}
      </Panel>

      <Panel title="Posição estimada" icon={<TargetIcon size={26} />} className="card" testId="card-position">
        {capturing && note && inference?.primary ? (
          <>
            <p
              className={`value ${inference.state === 'ambiguous' ? 'tentative' : 'live'}`}
              data-testid="position-value"
              data-state={inference.state}
            >
              {positionLabel(inference.primary.position)}
            </p>
            <p className="hint strong" data-testid="position-qualifier">
              {QUALIFIER[inference.state]}
            </p>
            <p className="hint" data-testid="position-confidence">
              Confiança da posição (índice do algoritmo): {Math.round(inference.positionConfidence * 100)}%
            </p>
          </>
        ) : (
          <>
            <p className="value" data-testid="position-value" data-state="none">
              —
            </p>
            <p className="hint" data-testid="position-confidence">
              Confiança da posição: indisponível sem nota
            </p>
            <p className="hint">Estimativa a partir da altura e do contexto, não confirmação física.</p>
          </>
        )}
      </Panel>

      <Panel title="Confiança da nota" className="card" testId="card-confidence">
        <p className={`value ${confidence !== null ? 'live' : ''}`} data-testid="confidence-value">
          {confidence !== null ? `${confidence}%` : '—'}
        </p>
        <div className="bar" aria-hidden="true">
          <div className="bar-fill" style={{ width: `${confidence ?? 0}%` }} />
        </div>
        <p className="hint">
          Qualidade da altura detectada (não é probabilidade). Não vale para a posição.
        </p>
      </Panel>

      <Panel title="Tempo real" icon={<WaveformIcon size={26} />} className="card" testId="card-latency">
        {capturing && stats ? (
          <>
            <p className="kv" data-testid="latency-total">
              Última nota:{' '}
              <b>{latency ? `${latency.totalMs.toFixed(0)} ms` : 'aguardando'}</b>
            </p>
            <p className="kv">
              Janela ({stats.windowSize}): <b>{stats.windowLatencyMs.toFixed(0)} ms</b>
            </p>
            <p className="kv">
              Análise: <b>{stats.frameMeanMs.toFixed(2)} ms</b>/quadro ·{' '}
              <b>{stats.framesPerSec.toFixed(0)}</b>/s
            </p>
            <p className="hint">Exclui a latência do hardware e do driver.</p>
          </>
        ) : (
          <Unavailable state="off" detail="Inicie a captura para medir" />
        )}
      </Panel>
    </div>
  );
}
