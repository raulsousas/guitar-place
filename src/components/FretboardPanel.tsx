import { useMemo, useState } from 'react';
import { midiToPtName } from '../music/notes';
import { STANDARD_TUNING } from '../music/tuning';
import type { FretRegion, PositionInference, PositionRevision } from '../types/position';
import { FretboardSvg, type FretMarker } from './FretboardSvg';
import { Panel } from './Panel';
import { GuitarIcon } from './icons';
import { positionLabel } from './positionLabel';

export const FRET_COUNT_OPTIONS = [12, 21, 22, 24] as const;
export const DEFAULT_FRET_COUNT = 24;

interface FretboardPanelProps {
  /** Nota MIDI em andamento, ou null (silêncio, captura parada, sem altura válida). */
  midi: number | null;
  /** Inferência de posição da nota em andamento (Etapa B), ou null. */
  inference: PositionInference | null;
  fretCount: number;
  onFretCountChange(n: number): void;
  /** Região do braço declarada pelo usuário (null = braço inteiro). */
  region: FretRegion | null;
  onRegionChange(r: FretRegion | null): void;
  /** Revisões recentes do decodificador (notas anteriores cuja posição mudou). */
  revisions?: readonly PositionRevision[];
}

const DEFAULT_REGION: FretRegion = { minFret: 1, maxFret: 5, includeOpen: true };

function regionText(r: FretRegion): string {
  return `casas ${r.minFret} a ${r.maxFret}${r.includeOpen ? ' e cordas soltas' : ', sem cordas soltas'}`;
}

/**
 * Painel do braço (renderiza o resultado da inferência; não calcula nada).
 *
 * - `unique` (posição única): verde sólido.
 * - `confident` (contexto + margem): verde sólido. Continua sendo estimativa.
 * - `ambiguous` (sem contexto ou candidatas próximas): melhor estimativa em verde claro tracejado.
 * - As demais candidatas (azul) só aparecem se o usuário ligar "Mostrar outras posições".
 */
export function FretboardPanel({
  midi,
  inference,
  fretCount,
  onFretCountChange,
  region,
  onRegionChange,
  revisions = [],
}: FretboardPanelProps) {
  const [showOthers, setShowOthers] = useState(false);
  const tuning = STANDARD_TUNING;

  // O aviso aparece enquanto a nota ao vivo é a que provocou a revisão, e some quando outra nota chega.
  const revision = useMemo(() => {
    const last = revisions.at(-1);
    return last && inference && inference.noteId === last.triggeredBy ? last : null;
  }, [revisions, inference]);

  const { markers, summary } = useMemo(() => {
    const out: FretMarker[] = [];
    if (midi === null || !inference) {
      return { markers: out, summary: 'Sem nota em andamento: nenhuma posição destacada.' };
    }
    const name = midiToPtName(midi);
    if (inference.state === 'unknown' || !inference.primary) {
      return {
        markers: out,
        summary: `${name} está fora do alcance do braço com ${fretCount} casas na afinação atual.`,
      };
    }
    const prim = inference.primary.position;
    out.push({
      stringIndex: prim.stringIndex,
      fret: prim.fret,
      variant: inference.state === 'ambiguous' ? 'tentative' : 'current',
    });
    if (showOthers) {
      for (const c of inference.candidates.slice(1)) {
        out.push({ stringIndex: c.position.stringIndex, fret: c.position.fret, variant: 'alternative' });
      }
    }
    const others = inference.candidates.length - 1;
    let text: string;
    if (inference.state === 'unique') {
      text = `${name}: única posição possível, ${positionLabel(prim)}.`;
    } else if (inference.state === 'confident' && inference.restrictedByRegion && !inference.hasContext) {
      text = `${name}: posição ${positionLabel(prim)}, a única candidata dentro da região que você declarou. Depende dessa informação, o áudio não confirma a casa.`;
    } else if (inference.state === 'confident') {
      text = `${name}: posição estimada ${positionLabel(prim)}, a partir do contexto das notas anteriores. É uma estimativa, o áudio não confirma a casa pressionada.`;
    } else {
      text = `${name}: posição ambígua. Melhor estimativa ${positionLabel(prim)} (tracejado), ${others} ${others === 1 ? 'alternativa' : 'alternativas'}.`;
    }
    if (others > 0 && !showOthers) text += ' Ative "Mostrar outras posições" para ver as alternativas.';
    if (inference.outsideRegion) {
      text += ' Esta nota não existe na região declarada; as posições do braço inteiro foram consideradas.';
    } else if (inference.primaryOutsideRegion) {
      text += ' Atenção: a melhor estimativa está FORA da região que você declarou (a região é uma preferência, não um filtro).';
    }
    return { markers: out, summary: text };
  }, [midi, inference, fretCount, showOthers]);

  return (
    <Panel
      title="Braço da guitarra"
      icon={<GuitarIcon size={22} />}
      testId="fretboard-panel"
      aside={
        <>
          <div className="legend" aria-label="Legenda">
            <span>
              <i style={{ background: 'var(--green)' }} /> Posição estimada
            </span>
            <span>
              <i className="legend-tentative" /> Ambígua
            </span>
            <span>
              <i style={{ background: 'var(--blue)' }} /> Outras posições possíveis
            </span>
            <span>
              <i style={{ background: '#8fa0bf' }} /> Casas
            </span>
          </div>
          <div className="switch-inline">
            <span id="show-others-label">Mostrar outras posições</span>
            <button
              type="button"
              role="switch"
              aria-checked={showOthers}
              aria-labelledby="show-others-label"
              className="switch"
              onClick={() => setShowOthers((v) => !v)}
              data-testid="show-others-switch"
            />
          </div>
          <label className="fret-count">
            <span>Casas</span>
            <select
              className="select"
              aria-label="Quantidade de casas"
              data-testid="fret-count"
              value={fretCount}
              onChange={(e) => onFretCountChange(Number(e.target.value))}
            >
              {FRET_COUNT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </>
      }
    >
      <div className="fretboard-wrap">
        <FretboardSvg
          region={region}
          tuning={tuning}
          fretCount={fretCount}
          markers={markers}
          ariaLabel={`Braço da guitarra com seis cordas e ${fretCount} casas. ${summary}`}
        />
      </div>
      <div className="region-row" data-testid="region-controls">
        <div className="switch-inline">
          <span id="region-label">Informar região do braço</span>
          <button
            type="button"
            role="switch"
            aria-checked={region !== null}
            aria-labelledby="region-label"
            className="switch"
            onClick={() => onRegionChange(region ? null : { ...DEFAULT_REGION, maxFret: Math.min(5, fretCount) })}
            data-testid="region-switch"
          />
        </div>
        {region ? (
          <>
            <label className="fret-count">
              <span>De</span>
              <select
                className="select"
                aria-label="Primeira casa da região"
                data-testid="region-min"
                value={region.minFret}
                onChange={(e) => {
                  const min = Number(e.target.value);
                  onRegionChange({ ...region, minFret: min, maxFret: Math.max(region.maxFret, min) });
                }}
              >
                {Array.from({ length: fretCount }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="fret-count">
              <span>até</span>
              <select
                className="select"
                aria-label="Última casa da região"
                data-testid="region-max"
                value={region.maxFret}
                onChange={(e) => {
                  const max = Number(e.target.value);
                  onRegionChange({ ...region, maxFret: max, minFret: Math.min(region.minFret, max) });
                }}
              >
                {Array.from({ length: fretCount }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="fret-count">
              <input
                type="checkbox"
                checked={region.includeOpen}
                onChange={(e) => onRegionChange({ ...region, includeOpen: e.target.checked })}
                data-testid="region-open"
              />
              <span>Incluir cordas soltas</span>
            </label>
            <span className="region-note" data-testid="region-note">
              Informado por você ({regionText(region)}). Não é detectado pelo áudio.
            </span>
          </>
        ) : (
          <span className="region-note" data-testid="region-note">
            Sem região: o app considera o braço inteiro. Se uma nota sair sempre na corda errada, informe onde está
            tocando.
          </span>
        )}
      </div>
      <p className="fret-summary" data-testid="fret-summary">
        {summary}
      </p>
      {revision && (
        <p className="revision-note" data-testid="revision-note" role="status">
          Posição revisada: {midiToPtName(revision.midi)} passou de {positionLabel(revision.from)} para{' '}
          {positionLabel(revision.to)} porque as notas seguintes combinam melhor com essa posição. Continua sendo uma
          estimativa.
        </p>
      )}
    </Panel>
  );
}
