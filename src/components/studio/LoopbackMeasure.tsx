import { useState } from 'react';
import type { StudioApi } from '../../hooks/useStudio';
import { LOOPBACK, clickOffsets, type LoopbackOutcome } from '../../fx/loopback';
import { AlertIcon, InfoIcon } from '../icons';

const FAILURES = {
  unavailable: 'Inicie a captura para medir.',
  'output-on': 'Desligue a saída do Estúdio ("Ouvir a guitarra") antes de medir: com ela ligada, o clique que volta pela entrada seria reenviado à saída.',
  'worklet-failed': 'Não foi possível carregar o medidor neste navegador.',
  'no-signal': 'Nenhum clique voltou. Confira o cabo (saída da interface para uma entrada), a entrada escolhida, o botão de monitoramento e o volume da saída.',
  noisy: 'A entrada tinha sinal, mas não coincidiu com os cliques (ruído ou guitarra tocando). Pare de tocar, solte as cordas e meça de novo.',
  'too-few': `Menos de ${LOOPBACK.minMatched} dos ${LOOPBACK.clicks} cliques voltaram. Aumente o volume da saída da interface ou confira o cabo e meça de novo.`,
  'too-fast': 'O atraso medido é pequeno demais para ser real: o clique provavelmente passou por um atalho (monitoramento direto da interface ou som vazando) em vez de pelo cabo. Desative o monitoramento direto e meça de novo.',
  unstable: `Os tempos variaram mais de ${LOOPBACK.maxSpreadMs} ms entre os cliques. Feche outros programas de áudio e meça de novo.`,
} as const;

type State = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; outcome: LoopbackOutcome };

const ms = (v: number) => `${v.toFixed(1)} ms`;

/**
 * Mede a latência de ida e volta (saída do navegador, driver, interface, cabo, driver, entrada do navegador). É uma medida
 * real do conjunto computador + navegador + interface + taxa usados agora. Não inclui o detector nem os efeitos.
 */
export function LoopbackMeasure({ studio }: { studio: StudioApi }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const run = async () => {
    setState({ kind: 'running' });
    const outcome = await studio.measureLoopback();
    setState({ kind: 'done', outcome });
  };
  const o = state.kind === 'done' ? state.outcome : null;
  return (
    <section className="studio-loopback" aria-labelledby="studio-loopback-title" data-testid="studio-loopback">
      <h3 id="studio-loopback-title" className="section-title">
        Medir latência de ida e volta
      </h3>
      <ol className="note-small loopback-steps">
        <li>Use um cabo da SAÍDA da interface (linha, não o fone) para uma ENTRADA dela. Baixe o volume do fone e do monitor.</li>
        <li>Desligue o monitoramento direto da interface e a saída do Estúdio. Não toque a guitarra durante a medida.</li>
        <li>
          Clique em medir: o app toca {LOOPBACK.clicks} cliques curtos e baixos e mede quando cada um volta pela entrada. Leva cerca de{' '}
          {Math.round(LOOPBACK.ambientS + 0.3 + (clickOffsets().at(-1) ?? 0) + LOOPBACK.windowS)} s.
        </li>
      </ol>
      <button
        type="button"
        className="btn secondary"
        disabled={!studio.available || state.kind === 'running'}
        onClick={() => void run()}
        data-testid="loopback-btn"
      >
        {state.kind === 'running' ? 'Medindo…' : 'Medir latência'}
      </button>
      {!studio.available ? <p className="note-small">Indisponível: inicie a captura.</p> : null}

      {o && o.ok ? (
        <div className="info-box" role="status" data-testid="loopback-result">
          <InfoIcon size={16} />
          <span>
            <b>Mediana: {ms(o.medianMs)}</b> (mínimo {ms(o.minMs)}, máximo {ms(o.maxMs)}), com {o.matched} de {o.total} cliques
            {o.extraneous > 0 ? `, ${o.extraneous} detecção(ões) extra ignorada(s)` : ''}.
            <br />É o tempo de ida e volta desta combinação (computador, navegador, driver, interface, taxa e buffer). O tempo de
            guitarra até o fone no Estúdio é aproximadamente este valor, mais o atraso dos efeitos ligados. Não inclui o detector de
            notas. Anote junto com o navegador, a taxa e o buffer; não vale para outra combinação.
          </span>
        </div>
      ) : null}
      {o && !o.ok ? (
        <p className="meter-warn" role="alert" data-testid="loopback-error">
          <AlertIcon size={13} /> {FAILURES[o.reason]}
          {'latenciesMs' in o && o.latenciesMs.length > 0 ? ` (voltaram ${o.matched} de ${o.total}; tempos: ${o.latenciesMs.map((v) => v.toFixed(1)).join(', ')} ms)` : ''}
        </p>
      ) : null}
    </section>
  );
}
