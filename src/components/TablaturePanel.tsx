import { useEffect, useMemo, useRef, useState } from 'react';
import { exportAscii } from '../tablature/ascii';
import {
  TAB_LEFT,
  TAB_ROW_GAP,
  TAB_TOP,
  formatTime,
  layoutColumns,
  visibleItems,
} from '../tablature/layout';
import { BUCKET_LABEL } from '../tablature/quantize';
import { midiToScientificName } from '../music/notes';
import type { FretPosition } from '../music/fretmap';
import { STANDARD_TUNING } from '../music/tuning';
import type { TabItem, TabNote } from '../types/tablature';
import { Panel } from './Panel';
import { positionLabel } from './positionLabel';
import { SlidersIcon } from './icons';

export const TAB_COUNT_OPTIONS = [8, 16, 32, Infinity] as const;
const countLabel = (n: number) => (Number.isFinite(n) ? `${n}` : 'Todas');

export interface TablaturePanelProps {
  items: readonly TabItem[];
  paused: boolean;
  /** A captura está ativa (sem captura não há nada novo para gravar). */
  capturing: boolean;
  onPausedChange(paused: boolean): void;
  onClear(): void;
  /** Corrige a posição de uma nota (null = voltar à estimativa). Devolve se entrou no decodificador. */
  onCorrect(id: number, position: FretPosition | null): { propagated: boolean } | null;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Estado visual de uma nota, na ordem de precedência: manual > incerta > estabelecida. */
function noteClass(n: TabNote): string {
  if (n.manual) return 'tab-note manual';
  if (n.uncertain) return 'tab-note uncertain';
  return 'tab-note';
}

function noteTitle(n: TabNote): string {
  const name = midiToScientificName(n.midi);
  const where = n.position ? positionLabel(n.position) : 'fora do alcance do braço';
  const kind = n.manual
    ? 'posição corrigida por você'
    : n.uncertain
      ? 'posição INCERTA (palpite do algoritmo)'
      : 'posição estimada pelo contexto';
  return `${name}, ${where}: ${kind}`;
}

export function TablaturePanel({ items, paused, capturing, onPausedChange, onClear, onCorrect }: TablaturePanelProps) {
  const [count, setCount] = useState<number>(16);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const shown = useMemo(() => visibleItems(items, count), [items, count]);
  const { columns, width } = useMemo(() => layoutColumns(shown), [shown]);
  const strings = STANDARD_TUNING.strings;
  const height = TAB_TOP + TAB_ROW_GAP * (strings.length - 1) + 30;
  const noteCount = items.filter((i) => i.kind === 'note').length;
  const selected = items.find((i): i is TabNote => i.kind === 'note' && i.id === selectedId) ?? null;

  // Acompanha as notas novas, a menos que o usuário tenha rolado para trás para revisar.
  useEffect(() => {
    const el = scroller.current;
    if (el && follow) el.scrollLeft = el.scrollWidth;
  }, [columns, follow]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setFollow(el.scrollWidth - el.scrollLeft - el.clientWidth < 24);
  };

  const correct = (position: FretPosition | null) => {
    if (!selected) return;
    const result = onCorrect(selected.id, position);
    if (!result) return;
    setMessage(
      position === null
        ? 'Voltou à estimativa do algoritmo.'
        : result.propagated
          ? 'Correção registrada e usada como evidência forte para as notas seguintes.'
          : 'Correção registrada só nesta entrada (a nota já saiu da janela de revisão do decodificador).',
    );
  };

  const ascii = () => exportAscii(items, STANDARD_TUNING, { header: 'Exportado do Guitar Tracker' });

  return (
    <Panel
      title="Tablatura em tempo real"
      icon={<SlidersIcon size={22} />}
      testId="tablature-panel"
      aside={
        <div className="tab-controls">
          <label className="fret-count">
            <span>Últimas notas</span>
            <select
              className="select"
              aria-label="Quantidade de notas exibidas"
              data-testid="tab-count"
              value={String(count)}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {TAB_COUNT_OPTIONS.map((n) => (
                <option key={String(n)} value={String(n)}>
                  {countLabel(n)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-small"
            onClick={() => onPausedChange(!paused)}
            aria-pressed={paused}
            data-testid="tab-pause"
          >
            {paused ? 'Retomar gravação' : 'Pausar gravação'}
          </button>
          <button
            type="button"
            className="btn-small"
            disabled={noteCount === 0}
            onClick={() => {
              void navigator.clipboard?.writeText(ascii());
              setMessage('Tablatura copiada como texto.');
            }}
            data-testid="tab-copy"
          >
            Copiar
          </button>
          <button
            type="button"
            className="btn-small"
            disabled={noteCount === 0}
            onClick={() => download('tablatura.txt', ascii())}
            data-testid="tab-download"
          >
            Baixar .txt
          </button>
          <button
            type="button"
            className="btn-small"
            disabled={items.length === 0}
            onClick={() => {
              onClear();
              setSelectedId(null);
              setMessage(null);
              setFollow(true);
            }}
            data-testid="tab-clear"
          >
            Limpar
          </button>
        </div>
      }
    >
      <div className="tab-scroll" ref={scroller} onScroll={onScroll} data-testid="tab-scroll">
        <svg
          viewBox={`0 0 ${Math.max(width, 600)} ${height}`}
          width={Math.max(width, 600)}
          height={height}
          role="img"
          aria-label={`Tablatura com seis linhas, uma por corda, e ${noteCount} nota(s) registradas`}
          data-testid="tablature-svg"
          data-notes={noteCount}
        >
          {strings.map((s, i) => (
            <g key={s.stringNumber}>
              <text x={14} y={TAB_TOP + i * TAB_ROW_GAP + 4} className="tab-string-label">
                {s.label}
              </text>
              <line
                x1={TAB_LEFT}
                x2={Math.max(width, 600) - 6}
                y1={TAB_TOP + i * TAB_ROW_GAP}
                y2={TAB_TOP + i * TAB_ROW_GAP}
                className="tab-line"
              />
            </g>
          ))}
          <line
            x1={TAB_LEFT}
            x2={TAB_LEFT}
            y1={TAB_TOP}
            y2={TAB_TOP + TAB_ROW_GAP * (strings.length - 1)}
            className="tab-bar"
          />
          {columns.map(({ item, x, width: w, timeLabel }) => {
            const key = `${item.kind}-${item.id}`;
            const time = timeLabel ? (
              <text x={x} y={12} className="tab-time" textAnchor="middle">
                {timeLabel}
              </text>
            ) : null;
            if (item.kind === 'rest') {
              return (
                <g key={key} data-testid="tab-rest" data-bucket={item.bucket}>
                  {time}
                  <title>{`Pausa de cerca de ${item.duration.toFixed(1)} s`}</title>
                  <text
                    x={x}
                    y={TAB_TOP + TAB_ROW_GAP * 2.5 + 4}
                    className="tab-rest"
                    textAnchor="middle"
                  >
                    {'\u2022'}
                  </text>
                </g>
              );
            }
            const y = item.position
              ? TAB_TOP + item.position.stringIndex * TAB_ROW_GAP
              : TAB_TOP + TAB_ROW_GAP * (strings.length - 1) + 20;
            const label = item.position ? `${item.position.fret}${item.uncertain && !item.manual ? '?' : ''}` : '\u00d7';
            const rw = Math.max(22, label.length * 9 + 12);
            return (
              <g
                key={key}
                className={`${noteClass(item)}${item.id === selectedId ? ' selected' : ''}${item.id === columns.at(-1)?.item.id ? ' latest' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={noteTitle(item)}
                aria-pressed={item.id === selectedId}
                onClick={() => {
                  setSelectedId(item.id === selectedId ? null : item.id);
                  setMessage(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(item.id === selectedId ? null : item.id);
                    setMessage(null);
                  }
                }}
                data-testid="tab-note"
                data-uncertain={item.uncertain}
                data-manual={item.manual}
                data-state={item.state}
                data-fret={item.position?.fret ?? ''}
                data-string={item.position?.stringNumber ?? ''}
                data-midi={item.midi}
                data-revised={item.revisionCount > 0}
              >
                {time}
                <title>{noteTitle(item)}</title>
                <rect x={x - rw / 2} y={y - 10} width={rw} height={20} rx={7} className="tab-chip" />
                <text x={x} y={y + 4.5} textAnchor="middle" className="tab-fret">
                  {label}
                </text>
                {item.revisionCount > 0 && <circle cx={x + rw / 2 - 1} cy={y - 9} r={3} className="tab-revised" />}
                {/* Larga área de clique, mesmo para a coluna estreita. */}
                <rect x={x - w / 2} y={TAB_TOP - 14} width={w} height={TAB_ROW_GAP * 5 + 44} fill="transparent" />
              </g>
            );
          })}
        </svg>
      </div>

      {noteCount === 0 ? (
        <p className="note-small" data-testid="tab-empty">
          {capturing
            ? paused
              ? 'Gravação pausada: as notas detectadas não estão sendo registradas.'
              : 'Aguardando a primeira nota. Toque uma corda.'
            : 'Nenhuma nota registrada. Inicie a captura e toque uma corda.'}
        </p>
      ) : (
        <p className="note-small" data-testid="tab-legend">
          <span className="tab-key"><i className="tab-key-sure" /> estimada pelo contexto</span>
          <span className="tab-key"><i className="tab-key-unsure" /> incerta (palpite, marcada com ?)</span>
          <span className="tab-key"><i className="tab-key-manual" /> corrigida por você</span>
          <span className="tab-key"><i className="tab-key-revised" /> revisada pelo decodificador</span>
          {paused && <strong data-testid="tab-paused-note"> Gravação pausada.</strong>}
        </p>
      )}

      {selected && (
        <div className="tab-detail" data-testid="tab-detail" aria-live="polite">
          <div className="tab-detail-head">
            <strong>
              {midiToScientificName(selected.midi)} · {selected.frequency.toFixed(2).replace('.', ',')} Hz
            </strong>
            <span>
              {formatTime(selected.onsetTime)}
              {selected.bucket ? ` · duração ${BUCKET_LABEL[selected.bucket]} (aprox.)` : ' · em andamento'}
            </span>
            <span>Nota: {Math.round(selected.pitchConfidence * 100)}%</span>
            <span title="Índice heurístico do algoritmo, não é probabilidade">
              Posição: índice {Math.round(selected.positionConfidence * 100)}
            </span>
          </div>
          {selected.candidates.length === 0 ? (
            <p className="note-small">Esta nota está fora do alcance do braço configurado: não há posição para corrigir.</p>
          ) : (
            <>
              <p className="note-small">
                {selected.manual
                  ? 'Posição corrigida por você. As posições abaixo são as alternativas compatíveis.'
                  : selected.uncertain
                    ? 'Posição incerta: o áudio sozinho não confirma a casa. Escolha a posição que você tocou para corrigir.'
                    : 'Posição estimada pelo contexto (não confirmada). Você pode corrigi-la.'}
              </p>
              <div className="tab-choices" role="group" aria-label="Posições compatíveis">
                {selected.candidates.map((c) => {
                  const current =
                    selected.position?.stringIndex === c.position.stringIndex &&
                    selected.position?.fret === c.position.fret;
                  return (
                    <button
                      key={`${c.position.stringIndex}-${c.position.fret}`}
                      type="button"
                      className={current ? 'btn-small choice current' : 'btn-small choice'}
                      aria-pressed={current}
                      onClick={() => correct(c.position)}
                      data-testid="tab-choice"
                      title="Pontuação relativa do algoritmo (estimativa, não probabilidade)"
                    >
                      {c.position.stringNumber}ª corda · {c.position.fret === 0 ? 'solta' : `casa ${c.position.fret}`}
                      <span className="choice-score">{Math.round(c.score * 100)}</span>
                    </button>
                  );
                })}
                {selected.manual && (
                  <button type="button" className="btn-small" onClick={() => correct(null)} data-testid="tab-reset">
                    Voltar à estimativa
                  </button>
                )}
              </div>
            </>
          )}
          {message && (
            <p className="note-small" data-testid="tab-message" role="status">
              {message}
            </p>
          )}
        </div>
      )}
      {!selected && message && (
        <p className="note-small" role="status" data-testid="tab-message">
          {message}
        </p>
      )}
    </Panel>
  );
}
