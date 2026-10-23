import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  icon?: ReactNode;
  /** Conteúdo à direita do título (legendas, controles). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
  testId?: string;
}

export function Panel({ title, icon, aside, className, children, testId }: PanelProps) {
  return (
    <section className={`panel ${className ?? ''}`.trim()} data-testid={testId}>
      <div className="panel-head">
        {icon}
        <h2>{title}</h2>
        <span className="grow" />
        {aside}
      </div>
      {children}
    </section>
  );
}

interface UnavailableProps {
  /** 'dev' = planejado para uma fase futura; 'off' = depende de captura ativa. */
  state?: 'dev' | 'off';
  detail?: string;
}

/** Estado padrão para elementos ainda sem motor real: nunca exibe dados inventados. */
export function Unavailable({ state = 'dev', detail }: UnavailableProps) {
  return (
    <div className="unavailable" data-testid="unavailable">
      <strong>{state === 'dev' ? 'Em desenvolvimento' : 'Indisponível'}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

export function DevBadge({ label = 'Em desenvolvimento' }: { label?: string }) {
  return <span className="badge">{label}</span>;
}
