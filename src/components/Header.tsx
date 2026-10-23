import type { CaptureStatus } from '../types/audio';
import { GearIcon, GuitarIcon, NoteIcon, SlidersIcon, TuningIcon } from './icons';

export type View = 'tracker' | 'tuner' | 'studio';

const VIEWS: { id: View; label: string; icon: typeof NoteIcon }[] = [
  { id: 'tracker', label: 'Rastreador', icon: GuitarIcon },
  { id: 'tuner', label: 'Afinador', icon: TuningIcon },
  { id: 'studio', label: 'Estúdio', icon: SlidersIcon },
];

interface HeaderProps {
  status: CaptureStatus;
  deviceLabel: string | null;
  /** Taxa real do AudioContext (Hz), ou null sem captura. Nada é inventado: sem captura, nada é mostrado. */
  sampleRate: number | null;
  view: View;
  onViewChange: (view: View) => void;
}

function statusText(status: CaptureStatus, deviceLabel: string | null): { text: string; cls: string } {
  switch (status) {
    case 'active':
      return { text: `Captura ativa${deviceLabel ? ` · ${deviceLabel}` : ''}`, cls: 'ok' };
    case 'requesting':
      return { text: 'Aguardando permissão…', cls: 'busy' };
    case 'error':
      return { text: 'Erro de áudio', cls: 'err' };
    default:
      return { text: 'Captura parada', cls: '' };
  }
}

export function Header({ status, deviceLabel, sampleRate, view, onViewChange }: HeaderProps) {
  const s = statusText(status, deviceLabel);
  return (
    <header className="header">
      <div className="brand">
        <GuitarIcon size={34} />
        <h1>Guitar Tracker</h1>
      </div>
      <p className="subtitle">Rastreador de notas da guitarra em tempo real</p>

      <div className="view-tabs main-nav" role="tablist" aria-label="Modo">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            id={`tab-${v.id}`}
            aria-selected={view === v.id}
            aria-controls={`view-${v.id}`}
            className={view === v.id ? 'view-tab active' : 'view-tab'}
            onClick={() => onViewChange(v.id)}
            data-testid={`tab-${v.id}`}
          >
            <v.icon size={16} />
            <span>{v.label}</span>
          </button>
        ))}
      </div>

      <span className="header-spacer" />
      <div className="conn-status" role="status" data-testid="connection-status">
        <span className={`dot ${s.cls}`} />
        {s.text}
        {status === 'active' && sampleRate ? <span className="conn-rate">{(sampleRate / 1000).toFixed(1)} kHz</span> : null}
      </div>
      <button
        type="button"
        className="icon-btn"
        disabled
        aria-label="Configurações (em desenvolvimento)"
        title="Configurações: em desenvolvimento"
      >
        <GearIcon size={22} />
      </button>
    </header>
  );
}
