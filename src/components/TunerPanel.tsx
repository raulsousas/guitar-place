import { useId } from 'react';
import type { AudioCaptureApi } from '../hooks/useAudioCapture';
import { midiToFrequency } from '../music/notes';
import { STANDARD_TUNING } from '../music/tuning';
import { nearestString, needleAngle, splitNoteName, tuningAdvice } from '../music/tuner';
import { ChevronDownIcon, MicIcon, PlayIcon, StopIcon } from './icons';

const NEEDLE_MAX_DEG = 50;
const CX = 300;
const CY = 255;
const R_TICK_IN = 190;
const R_TICK_OUT = 208;
const NEEDLE_LEN = 215;

function polar(angleDeg: number, r: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
}

function fmtHz(hz: number): string {
  return hz.toFixed(2).replace('.', ',');
}

function fmtCents(c: number): string {
  const r = Math.round(c);
  return `${r > 0 ? '+' : ''}${r} cents`;
}

/** Marcações da escala: −50, −25, 0, +25, +50 cents. */
const TICKS = [-50, -25, 0, 25, 50];

function Gauge({ cents, state }: { cents: number | null; state: 'idle' | 'in-tune' | 'off' }) {
  const angle = cents === null ? 0 : needleAngle(cents, NEEDLE_MAX_DEG);
  const tip = polar(0, NEEDLE_LEN);
  return (
    <svg
      viewBox="0 0 600 290"
      className={`tuner-gauge ${state}`}
      role="img"
      aria-label={
        cents === null ? 'Ponteiro do afinador, sem leitura' : `Ponteiro do afinador em ${fmtCents(cents)}`
      }
      data-testid="tuner-gauge"
      data-angle={angle.toFixed(1)}
    >
      {TICKS.map((t) => {
        const a = needleAngle(t, NEEDLE_MAX_DEG);
        const p1 = polar(a, R_TICK_IN);
        const p2 = polar(a, t === 0 ? R_TICK_OUT + 14 : R_TICK_OUT);
        return (
          <line
            key={t}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            className={t === 0 ? 'tick center' : 'tick'}
          />
        );
      })}
      <text x={polar(-NEEDLE_MAX_DEG - 8, R_TICK_OUT + 22).x} y={polar(-NEEDLE_MAX_DEG - 8, R_TICK_OUT + 22).y} className="gauge-sym">
        ♭
      </text>
      <text x={polar(NEEDLE_MAX_DEG + 8, R_TICK_OUT + 22).x} y={polar(NEEDLE_MAX_DEG + 8, R_TICK_OUT + 22).y} className="gauge-sym">
        ♯
      </text>
      <g className="needle" style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
        <line x1={CX} y1={CY} x2={tip.x} y2={tip.y} />
      </g>
      <circle cx={CX} cy={CY} r={16} className="pivot-ring" />
      <circle cx={CX} cy={CY} r={5} className="pivot" />
    </svg>
  );
}

/** Ilustrações simples dos quatro passos (SVG próprio, sem imagens externas). */
function StepArt({ step }: { step: 1 | 2 | 3 | 4 }) {
  if (step === 1) {
    return (
      <svg viewBox="0 0 240 150" aria-hidden="true">
        <circle cx="120" cy="75" r="52" className="art-ring" />
        <circle cx="120" cy="75" r="34" className="art-fill" />
        <rect x="112" y="55" width="16" height="28" rx="8" fill="#141414" />
        <path d="M104 78a16 16 0 0 0 32 0M120 94v8" stroke="#141414" strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  if (step === 2) {
    return (
      <svg viewBox="0 0 240 150" aria-hidden="true">
        <rect x="30" y="52" width="6" height="46" className="art-fill" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <line key={i} x1="36" x2="214" y1={56 + i * 8} y2={56 + i * 8} className={i === 0 ? 'art-line strong' : 'art-line'} />
        ))}
        {[80, 125, 170].map((x) => (
          <line key={x} x1={x} x2={x} y1="52" y2="98" className="art-fret" />
        ))}
      </svg>
    );
  }
  if (step === 3) {
    const names = ['E', 'A', 'D', 'G', 'B', 'E'];
    return (
      <svg viewBox="0 0 240 150" aria-hidden="true">
        {names.map((n, i) => (
          <g key={i}>
            <text x="48" y={52 + i * 14} className="art-label">
              {n}
            </text>
            <line x1="64" x2="180" y1={49 + i * 14} y2={49 + i * 14} className="art-line" strokeWidth={4 - i * 0.55} />
            <text x="192" y={52 + i * 14} className="art-num">
              {6 - i}ª
            </text>
          </g>
        ))}
        <text x="120" y="142" textAnchor="middle" className="art-cap">
          DA MAIS GROSSA PARA A MAIS FINA
        </text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 240 150" aria-hidden="true">
      <path d="M52 108a68 68 0 0 1 136 0" className="art-arc" />
      <line x1="120" y1="106" x2="120" y2="52" className="art-needle" />
      <circle cx="120" cy="106" r="6" fill="#fff" />
      <text x="120" y="138" textAnchor="middle" className="art-note">
        E
      </text>
    </svg>
  );
}

const STEPS: { n: 1 | 2 | 3 | 4; text: string }[] = [
  {
    n: 1,
    text: 'Clique em Iniciar e permita o acesso ao áudio quando o navegador pedir. É por essa entrada que o afinador escuta a guitarra.',
  },
  {
    n: 2,
    text: 'Ligue a guitarra à interface de áudio e toque uma corda solta, uma de cada vez, deixando a nota soar.',
  },
  {
    n: 3,
    text: 'O afinador usa a afinação padrão (E A D G B E, da 6ª para a 1ª corda). Afine cada corda para a nota correspondente.',
  },
  {
    n: 4,
    text: 'Gire a tarraxa até o ponteiro ficar no centro e a nota aparecer em verde. Se o ponteiro está à esquerda, aperte; à direita, afrouxe.',
  },
];

/**
 * Afinador. Usa a MESMA captura e o MESMO detector de altura (MPM) do rastreador: nenhum
 * segundo acesso ao microfone. Mostra a nota cromática mais próxima e o desvio em cents.
 */
export function TunerPanel({ audio }: { audio: AudioCaptureApi }) {
  const { status, tuner, devices, selectedDeviceId, meter } = audio;
  const active = status === 'active';
  const busy = status === 'requesting';
  const deviceId = useId();

  const note = tuner ? splitNoteName(tuner.midi) : null;
  const state: 'idle' | 'in-tune' | 'off' = !tuner ? 'idle' : tuner.inTune ? 'in-tune' : 'off';
  const advice = tuner ? tuningAdvice(tuner.cents) : null;
  const hint = tuner ? nearestString(tuner.midi + tuner.cents / 100, STANDARD_TUNING) : null;

  const neighbours = tuner
    ? [-2, -1, 0, 1, 2].map((d) => ({ d, ...splitNoteName(tuner.midi + d) }))
    : [];

  let message: string;
  if (!active) message = 'Inicie a captura para afinar.';
  else if (!tuner) message = 'Toque uma corda solta.';
  else if (advice === 'in-tune') message = 'Afinada.';
  else if (advice === 'too-low') message = 'Abaixo do tom: aperte a corda (suba a tarraxa).';
  else message = 'Acima do tom: afrouxe a corda.';

  const levelPct = Math.round(Math.max(0, Math.min(1, meter.level)) * 100);

  return (
    <section className="tuner-section" data-testid="tuner-panel" aria-labelledby="tuner-title">
      <h2 id="tuner-title" className="tuner-title">
        Afinador
      </h2>

      <div className={`tuner-stage ${state}`} data-testid="tuner-stage" data-state={state}>
        <div className="tuner-notes" aria-live="polite" data-testid="tuner-notes">
          {tuner && note ? (
            neighbours.map((n) => (
              <span key={n.d} className={n.d === 0 ? 'tn current' : 'tn'} data-testid={n.d === 0 ? 'tuner-note' : undefined}>
                <span className="letter">{n.letter}</span>
                <sup>
                  {n.sharp ? <span className="sharp">#</span> : null}
                  <span className="oct">{n.octave}</span>
                </sup>
              </span>
            ))
          ) : (
            <span className="tn idle" data-testid="tuner-note">
              <span className="letter">—</span>
            </span>
          )}
        </div>

        <p className="tuner-hz" data-testid="tuner-hz">
          {tuner ? `${fmtHz(tuner.frequency)} Hz` : '— Hz'}
        </p>
        <p className="tuner-sub" data-testid="tuner-cents">
          {tuner
            ? `${fmtCents(tuner.cents)} · alvo ${fmtHz(midiToFrequency(tuner.midi))} Hz`
            : 'Sem leitura'}
        </p>

        <Gauge cents={tuner ? tuner.cents : null} state={state} />

        <div className="tuner-level" aria-hidden="true">
          <div className="tuner-level-fill" style={{ height: `${active ? levelPct : 0}%` }} />
        </div>

        <div className="tuner-controls">
          <label htmlFor={deviceId} className="visually-hidden">
            Entrada de áudio do afinador
          </label>
          <MicIcon size={20} />
          <div className="tuner-select-wrap">
            <select
              id={deviceId}
              className="tuner-select"
              value={selectedDeviceId}
              disabled={active || busy}
              onChange={(e) => audio.selectDevice(e.target.value)}
              data-testid="tuner-device"
              title={devices.find((d) => d.deviceId === selectedDeviceId)?.label}
            >
              <option value="">Entrada padrão do sistema</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            <ChevronDownIcon size={14} />
          </div>
          {active ? (
            <button type="button" className="tuner-btn" onClick={() => void audio.stop()} data-testid="tuner-stop">
              <StopIcon size={16} /> Parar
            </button>
          ) : (
            <button
              type="button"
              className="tuner-btn"
              disabled={busy || !audio.supported}
              onClick={() => void audio.start()}
              data-testid="tuner-start"
            >
              <PlayIcon size={16} /> {busy ? 'Aguardando…' : 'Iniciar'}
            </button>
          )}
        </div>

        <div className="tuner-message" role="status" data-testid="tuner-message">
          {message}
          {hint && tuner && advice !== 'in-tune' ? (
            <span className="tuner-hint" data-testid="tuner-string-hint">
              {' '}
              Corda solta mais próxima: {hint.stringNumber}ª ({hint.name}), {fmtCents(hint.cents)} (sugestão pela
              altura; o áudio não identifica a corda).
            </span>
          ) : null}
        </div>
      </div>

      <h3 className="tuner-steps-title">Veja como afinar em 4 passos</h3>
      <div className="tuner-steps" data-testid="tuner-steps">
        {STEPS.map((s) => (
          <article key={s.n} className="tuner-step">
            <div className="art">
              <span className="step-badge">Passo {s.n}</span>
              <StepArt step={s.n} />
            </div>
            <p>{s.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
