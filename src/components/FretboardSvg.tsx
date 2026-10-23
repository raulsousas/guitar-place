import { inlayFrets } from '../fretboard/geometry';
import { createLayout, fretCenterX, fretEdgeX, positionXY, stringY } from '../fretboard/layout';
import type { Tuning } from '../types/music';
import type { FretRegion } from '../types/position';

/**
 * Marcador sobre o braço. `current` = verde (posição única ou inferida com contexto);
 * `tentative` = verde claro tracejado (melhor estimativa AMBÍGUA); `alternative` = azul.
 */
export interface FretMarker {
  stringIndex: number;
  /** 0 = corda solta. */
  fret: number;
  variant: 'current' | 'tentative' | 'alternative';
}

interface FretboardSvgProps {
  tuning: Tuning;
  fretCount: number;
  markers: readonly FretMarker[];
  ariaLabel: string;
  /** Região declarada pelo usuário (faixa destacada), ou null. */
  region?: FretRegion | null;
}

/**
 * Renderização pura do braço: recebe afinação, número de casas e marcadores.
 * Não conhece áudio, detecção nem inferência.
 */
export function FretboardSvg({ tuning, fretCount, markers, ariaLabel, region = null }: FretboardSvgProps) {
  const l = createLayout(fretCount, tuning.strings.length);
  const midY = stringY(l, 0) + 2.5 * l.stringGap;
  const numberSize = fretCount > 21 ? 11 : 12;

  return (
    <svg
      viewBox={`0 0 ${l.width} ${l.height}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
      data-testid="fretboard-svg"
      data-fret-count={fretCount}
      style={{ minWidth: 760, display: 'block' }}
    >
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5a3a29" />
          <stop offset="0.5" stopColor="#4a2f21" />
          <stop offset="1" stopColor="#3b2419" />
        </linearGradient>
      </defs>

      {/* numeração das casas */}
      {l.centers.map((_, i) => (
        <text
          key={i}
          x={fretCenterX(l, i + 1)}
          y={20}
          textAnchor="middle"
          fontSize={numberSize}
          fill="#9fb0cf"
          data-testid="fret-number"
        >
          {i + 1}
        </text>
      ))}

      <rect x={l.nutX} y={l.top} width={l.boardWidth} height={l.boardHeight} rx={4} fill="url(#wood)" />

      {/* região declarada pelo usuário */}
      {region && (
        <rect
          x={fretEdgeX(l, region.minFret - 1)}
          y={l.top}
          width={fretEdgeX(l, region.maxFret) - fretEdgeX(l, region.minFret - 1)}
          height={l.boardHeight}
          fill="var(--blue)"
          opacity={0.14}
          data-testid="region-band"
        />
      )}

      {/* marcações de referência */}
      {inlayFrets(fretCount).map(({ fret, double }) => {
        const cx = fretCenterX(l, fret);
        return double ? (
          <g key={fret} fill="#c9b79c" opacity={0.75} data-testid="inlay">
            <circle cx={cx} cy={l.top + l.boardHeight * 0.28} r={5} />
            <circle cx={cx} cy={l.top + l.boardHeight * 0.72} r={5} />
          </g>
        ) : (
          <circle key={fret} cx={cx} cy={midY} r={5} fill="#c9b79c" opacity={0.75} data-testid="inlay" />
        );
      })}

      {/* pestana */}
      <rect x={l.nutX - 8} y={l.top - 2} width={8} height={l.boardHeight + 4} fill="#d9d3c4" rx={2} />

      {/* trastes */}
      {l.edges.slice(1).map((_, i) => (
        <line
          key={i}
          x1={fretEdgeX(l, i + 1)}
          x2={fretEdgeX(l, i + 1)}
          y1={l.top}
          y2={l.top + l.boardHeight}
          stroke="#b8c2d6"
          strokeWidth={2.2}
        />
      ))}

      {/* cordas (da 1ª, fina, no topo, até a 6ª, grossa, embaixo) */}
      {tuning.strings.map((s, i) => (
        <g key={s.stringNumber}>
          <line
            x1={l.nutX}
            x2={l.nutX + l.boardWidth}
            y1={stringY(l, i)}
            y2={stringY(l, i)}
            stroke="#d5dbe8"
            strokeWidth={1 + i * 0.45}
            opacity={0.9}
          />
          <text x={l.nutX - 46} y={stringY(l, i) + 5} textAnchor="middle" fontSize={15} fontWeight={600} fill="#e8eefb">
            {s.label}
          </text>
          {/* círculo de corda solta, à esquerda da pestana */}
          <circle cx={l.nutX - 22} cy={stringY(l, i)} r={8} fill="none" stroke="#8fa0bf" strokeWidth={1.6} />
        </g>
      ))}

      {/* marcadores: alternativos primeiro, para o verde ficar por cima */}
      {[...markers]
        .sort((a, b) => (a.variant === b.variant ? 0 : a.variant === 'alternative' ? -1 : 1))
        .map((m) => {
          const { x, y } = positionXY(l, m.stringIndex, m.fret);
          const tentative = m.variant === 'tentative';
          const current = m.variant === 'current' || tentative;
          const color = current ? 'var(--green)' : 'var(--blue)';
          return (
            <g
              key={`${m.stringIndex}-${m.fret}`}
              className="fret-marker"
              data-testid="fret-marker"
              data-variant={m.variant}
              data-string-index={m.stringIndex}
              data-fret={m.fret}
            >
              <circle cx={x} cy={y} r={current ? 19 : 16} fill={color} opacity={tentative ? 0.12 : 0.22} />
              {tentative ? (
                <circle
                  cx={x}
                  cy={y}
                  r={12}
                  fill="#a9f5cd"
                  fillOpacity={0.55}
                  stroke="var(--green)"
                  strokeWidth={2}
                  strokeDasharray="3.5 3"
                />
              ) : (
                <circle cx={x} cy={y} r={current ? 11 : 10} fill={color} stroke="#04141f" strokeWidth={1.5} />
              )}
              <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="#04141f"
                pointerEvents="none"
              >
                {m.fret}
              </text>
            </g>
          );
        })}
    </svg>
  );
}
