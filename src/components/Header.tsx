import type { CaptureStatus } from '../types/audio';
import { GearIcon, GuitarIcon } from './icons';

interface HeaderProps {
  status: CaptureStatus;
  deviceLabel: string | null;
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

export function Header({ status, deviceLabel }: HeaderProps) {
  const s = statusText(status, deviceLabel);
  return (
    <header className="header">
      <div className="brand">
        <GuitarIcon size={34} />
        <h1>Guitar Tracker</h1>
      </div>
      <p className="subtitle">Rastreador de notas da guitarra em tempo real</p>
      <span className="header-spacer" />
      <div className="conn-status" role="status" data-testid="connection-status">
        <span className={`dot ${s.cls}`} />
        {s.text}
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
