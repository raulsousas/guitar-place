import type { StudioParams } from '../../fx/types';

export type BlockId = 'gate' | 'drive' | 'eq' | 'amp' | 'cabinet' | 'delay' | 'reverb';
export type BenchTab = 'effects' | 'amp' | 'cabinet' | 'mixer';

interface Gear {
  id: BlockId;
  label: string;
  /** Rótulo curto impresso no equipamento. */
  tag: string;
  kind: 'pedal' | 'amp' | 'cabinet';
  bench: BenchTab;
}

/** Ordem EXATA do processamento em src/fx/engine.ts: entrada, porta, drive, EQ, amplificador, gabinete, delay, reverb, saída. */
export const CHAIN: readonly Gear[] = [
  { id: 'gate', label: 'Portão de ruído', tag: 'GATE', kind: 'pedal', bench: 'effects' },
  { id: 'drive', label: 'Pedal de drive', tag: 'DRIVE', kind: 'pedal', bench: 'effects' },
  { id: 'eq', label: 'Equalizador', tag: 'EQ', kind: 'pedal', bench: 'effects' },
  { id: 'amp', label: 'Amplificador', tag: 'AMP', kind: 'amp', bench: 'amp' },
  { id: 'cabinet', label: 'Gabinete', tag: 'CAB', kind: 'cabinet', bench: 'cabinet' },
  { id: 'delay', label: 'Delay', tag: 'DELAY', kind: 'pedal', bench: 'effects' },
  { id: 'reverb', label: 'Reverb', tag: 'REVERB', kind: 'pedal', bench: 'effects' },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Valores reais (0..1) mostrados nos mini-indicadores de cada equipamento. Somente leitura. */
function readouts(id: BlockId, p: StudioParams): number[] {
  switch (id) {
    case 'gate':
      return [clamp01((p.gate.thresholdDb + 80) / 50)];
    case 'drive':
      return [p.drive.drive, p.drive.tone, p.drive.level];
    case 'eq':
      return [(p.eq.lowDb + 12) / 24, (p.eq.midDb + 12) / 24, (p.eq.highDb + 12) / 24].map(clamp01);
    case 'amp':
      return [p.amp.gain, p.amp.bass, p.amp.mid, p.amp.treble, p.amp.level];
    case 'cabinet':
      return [];
    case 'delay':
      return [clamp01((p.delay.timeMs - 40) / 960), clamp01(p.delay.feedback / 0.85), p.delay.mix];
    case 'reverb':
      return [clamp01((p.reverb.decayS - 0.3) / 3.7), p.reverb.mix];
  }
}

function MiniKnob({ value }: { value: number }) {
  const a = ((-135 + 270 * clamp01(value) - 90) * Math.PI) / 180;
  return (
    <svg viewBox="0 0 20 20" width={18} height={18} aria-hidden="true" className="mini-knob">
      <circle cx={10} cy={10} r={8.5} />
      <line x1={10} y1={10} x2={10 + Math.cos(a) * 6.5} y2={10 + Math.sin(a) * 6.5} />
    </svg>
  );
}

function Jack({ label }: { label: string }) {
  return (
    <div className="chain-jack">
      <svg viewBox="0 0 28 28" width={28} height={28} aria-hidden="true">
        <circle cx={14} cy={14} r={12} className="jack-ring" />
        <circle cx={14} cy={14} r={5} className="jack-hole" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

function Cable() {
  return (
    <svg className="chain-cable" viewBox="0 0 28 14" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 7 C 9 13, 19 13, 28 7" />
    </svg>
  );
}

interface SignalChainProps {
  params: StudioParams;
  selected: BlockId | null;
  /** Liga ou desliga o bloco (botão de pé). */
  onToggle: (id: BlockId) => void;
  /** Abre os controles do bloco na bancada abaixo. */
  onSelect: (id: BlockId, bench: BenchTab) => void;
}

/**
 * Cadeia de efeitos como uma bancada de equipamentos. É uma visão do estado real: o LED e o botão de pé refletem
 * `params[id].enabled`, os mini-indicadores refletem os valores atuais. A ordem é fixa porque o motor tem ordem fixa;
 * por isso não há arrastar para reordenar.
 */
export function SignalChain({ params, selected, onToggle, onSelect }: SignalChainProps) {
  return (
    <section className="signal-chain" aria-labelledby="signal-chain-title" data-testid="studio-bench">
      <header className="chain-head">
        <h2 id="signal-chain-title">Cadeia de efeitos</h2>
        <p>Ordem do processamento, da guitarra à saída. Toque num equipamento para ajustá-lo; o botão de pé liga e desliga o bloco.</p>
      </header>
      <ol className="chain-rail" data-testid="studio-chain">
        <li className="chain-end">
          <Jack label="Entrada" />
        </li>
        {CHAIN.map((g) => {
          const on = params[g.id].enabled;
          const vals = readouts(g.id, params);
          return (
            <li key={g.id} className={`chain-slot ${g.kind}`}>
              <Cable />
              <div className={`gear gear-${g.id} ${on ? 'on' : 'off'} ${selected === g.id ? 'selected' : ''}`.trim()}>
                <button
                  type="button"
                  className="gear-body"
                  aria-label={`Ajustar ${g.label}`}
                  aria-current={selected === g.id ? 'true' : undefined}
                  onClick={() => onSelect(g.id, g.bench)}
                  data-testid={`gear-select-${g.id}`}
                >
                  <span className="gear-readouts" aria-hidden="true">
                    {vals.map((v, i) => (
                      <MiniKnob key={i} value={v} />
                    ))}
                    {g.kind === 'cabinet' ? <span className="grille" /> : null}
                  </span>
                  <span className="gear-tag">{g.id === 'cabinet' ? params.cabinet.kind.toUpperCase() : g.tag}</span>
                </button>
                <button
                  type="button"
                  className="gear-foot"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${g.label}: ${on ? 'ligado' : 'desligado'}`}
                  onClick={() => onToggle(g.id)}
                  data-testid={`chain-${g.id}`}
                >
                  <span className="led" aria-hidden="true" />
                </button>
              </div>
              <span className="gear-name">{g.label}</span>
              <span className={on ? 'gear-state on' : 'gear-state'}>{on ? 'Ligado' : 'Desligado'}</span>
            </li>
          );
        })}
        <li className="chain-end">
          <Cable />
          <Jack label="Saída" />
        </li>
      </ol>
    </section>
  );
}
