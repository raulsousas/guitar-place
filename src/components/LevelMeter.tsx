import type { MeterValue } from '../hooks/useAudioCapture';

const SEGMENTS = 28;

function formatDb(db: number): string {
  return Number.isFinite(db) ? `${db.toFixed(0)} dBFS` : '−∞ dBFS';
}

interface LevelMeterProps {
  meter: MeterValue;
  active: boolean;
}

/** Medidor alimentado exclusivamente pelas amostras reais do worklet. */
export function LevelMeter({ meter, active }: LevelMeterProps) {
  const lit = active ? Math.round(meter.level * SEGMENTS) : 0;
  const peakIdx = active ? Math.min(SEGMENTS - 1, Math.round(meter.peak * SEGMENTS) - 1) : -1;
  return (
    <div>
      <div
        className="meter"
        role="meter"
        aria-label="Nível do sinal"
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={active && Number.isFinite(meter.rmsDb) ? Math.round(meter.rmsDb) : -60}
        data-testid="level-meter"
        data-lit={lit}
      >
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const on = i < lit;
          const frac = i / SEGMENTS;
          const zone = frac > 0.9 ? 'hot' : frac > 0.72 ? 'warn' : '';
          const cls = [on ? 'on' : '', on ? zone : '', !on && i === peakIdx ? 'peak' : '']
            .filter(Boolean)
            .join(' ');
          return <i key={i} className={cls} />;
        })}
      </div>
      <div className="meter-readout">
        <span data-testid="level-db">{active ? formatDb(meter.rmsDb) : 'Sem captura'}</span>
        <span>{meter.clipping && active ? 'Sinal saturado (clipping)' : '−60 … 0 dBFS'}</span>
      </div>
    </div>
  );
}
