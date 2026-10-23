import { formatTime } from '../tablature/layout';
import { midiToScientificName } from '../music/notes';
import type { TabItem, TabNote } from '../types/tablature';
import { Panel, Unavailable } from './Panel';
import { positionLabel } from './positionLabel';
import { ClockIcon } from './icons';

/** Quantidade de linhas mantidas na lista (o histórico completo continua na tablatura). */
const HISTORY_LIMIT = 60;

function where(n: TabNote): string {
  if (!n.position) return 'fora do braço';
  const base = positionLabel(n.position);
  return n.manual ? base : n.uncertain ? `${base} ?` : base;
}

/**
 * Histórico de notas (mais recente primeiro). Lê as mesmas entradas da tablatura, então reflete
 * revisões do decodificador e correções manuais. Uma posição com "?" é um palpite, não confirmada.
 */
export function HistoryPanel({ items }: { items: readonly TabItem[] }) {
  const notes = items.filter((i): i is TabNote => i.kind === 'note').slice(-HISTORY_LIMIT).reverse();
  return (
    <Panel title="Histórico de notas" icon={<ClockIcon size={20} />} testId="history-panel">
      {notes.length === 0 ? (
        <Unavailable state="off" detail="As notas detectadas aparecem aqui" />
      ) : (
        <ul className="list history" data-testid="history-list">
          {notes.map((n) => (
            <li
              key={n.id}
              className="history-row"
              data-testid="history-item"
              data-uncertain={n.uncertain}
              data-manual={n.manual}
            >
              <span className="h-time">{formatTime(n.onsetTime)}</span>
              <span className="h-note">{midiToScientificName(n.midi)}</span>
              <span className="h-hz">{n.frequency.toFixed(1).replace('.', ',')} Hz</span>
              <span
                className={n.manual ? 'h-pos manual' : n.uncertain ? 'h-pos uncertain' : 'h-pos'}
                title={
                  n.manual
                    ? 'Posição corrigida por você'
                    : n.uncertain
                      ? 'Posição incerta: palpite do algoritmo'
                      : 'Posição estimada pelo contexto (não confirmada)'
                }
              >
                {where(n)}
              </span>
              <span className="h-conf" title="Confiança da detecção da NOTA (não da posição)">
                {Math.round(n.pitchConfidence * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
