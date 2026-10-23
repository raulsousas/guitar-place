import { useEffect, useRef, useState } from 'react';
import type { StudioApi } from '../../hooks/useStudio';
import type { StudioLevels } from '../../fx/types';
import { AlertIcon, InfoIcon } from '../icons';

const FLOOR_DB = -60;
const fmt = (db: number): string => (Number.isFinite(db) ? `${db.toFixed(0)} dBFS` : '−∞ dBFS');
const meterFrac = (db: number): number => (Number.isFinite(db) ? Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB)) : 0);

function Bar({ label, db, hot, testId }: { label: string; db: number; hot: boolean; testId: string }) {
  return (
    <div className="studio-bar" data-testid={testId} data-level={meterFrac(db).toFixed(3)}>
      <span>{label}</span>
      <div className="track">
        <div className={hot ? 'fill hot' : 'fill'} style={{ width: `${meterFrac(db) * 100}%` }} />
      </div>
      <output>{fmt(db)}</output>
    </div>
  );
}

/** Níveis reais lidos do motor (picos do último bloco). Sem captura: nada é exibido. */
export function StudioMeters({ studio }: { studio: StudioApi }) {
  const [levels, setLevels] = useState<StudioLevels | null>(null);
  const read = useRef(studio.readLevels);
  useEffect(() => {
    read.current = studio.readLevels;
  }, [studio.readLevels]);

  useEffect(() => {
    if (!studio.available) return undefined; // sem captura: o render mostra o aviso, ignorando níveis antigos
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      // ~30 quadros/s bastam para um medidor; o custo é uma leitura de 1024 amostras por analisador.
      if (now - last > 33) {
        last = now;
        setLevels(read.current());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [studio.available]);

  if (!studio.available || !levels) {
    return (
      <p className="note-small" data-testid="studio-meters-off">
        Medidores indisponíveis: inicie a captura.
      </p>
    );
  }
  return (
    <div className="studio-meters" data-testid="studio-meters">
      <Bar label="Entrada" db={levels.inputPeakDb} hot={levels.inputClip} testId="studio-meter-in" />
      <Bar label="Saída" db={levels.outputPeakDb} hot={levels.outputClip} testId="studio-meter-out" />
      {studio.params.gate.enabled ? (
        <p className="note-small" data-testid="studio-gate-state" data-open={levels.gateOpen.toFixed(2)}>
          Portão de ruído: {levels.gateOpen > 0.9 ? 'aberto' : levels.gateOpen < 0.05 ? 'fechado' : 'abrindo/fechando'}
        </p>
      ) : null}
      {levels.inputClip ? (
        <p className="meter-warn" role="status" data-testid="studio-clip-in">
          <AlertIcon size={13} /> Entrada saturada: reduza o ganho da interface ou o ganho de entrada.
        </p>
      ) : null}
      {levels.outputClip ? (
        <p className="meter-warn" role="status" data-testid="studio-clip-out">
          <AlertIcon size={13} /> Saída no limite: reduza o volume ou o nível dos blocos.
        </p>
      ) : null}
    </div>
  );
}

/** Seção de saída: segurança primeiro (desligada por padrão, aviso de realimentação, volume baixo). */
export function OutputSection({ studio }: { studio: StudioApi }) {
  const { params } = studio;
  const off = !studio.available;
  return (
    <section className="studio-output" aria-labelledby="studio-output-title" data-testid="studio-output">
      <h3 id="studio-output-title" className="section-title">
        Saída de áudio
      </h3>

      <div className="studio-feedback-warn" role="note" data-testid="studio-feedback-warning">
        <AlertIcon size={16} />
        <span>
          Use <b>fones de ouvido</b>. Com caixas de som, o microfone ou a guitarra podem captar a saída e gerar
          realimentação (apito alto). O volume começa baixo ({params.masterDb} dB) e a saída começa desligada.
        </span>
      </div>

      <div className="switch-row">
        <span id="studio-out-label">Ouvir a guitarra</span>
        <button
          type="button"
          role="switch"
          aria-checked={studio.outputEnabled}
          aria-labelledby="studio-out-label"
          className="switch"
          disabled={off}
          onClick={() => studio.setOutputEnabled(!studio.outputEnabled)}
          data-testid="studio-output-switch"
        />
      </div>
      <p className="note-small" data-testid="studio-output-state">
        {off
          ? 'Indisponível: inicie a captura no painel Áudio. A saída sempre recomeça desligada.'
          : studio.outputEnabled
            ? 'Saída LIGADA: você está ouvindo o som processado.'
            : 'Saída desligada. Ligue só depois de conferir o volume e os fones.'}
      </p>

      <div className="slider-row">
        <label htmlFor="studio-master">Volume geral</label>
        <output data-testid="studio-master-value">{params.masterDb.toFixed(0)} dB</output>
      </div>
      <input
        id="studio-master"
        type="range"
        min={-40}
        max={0}
        step={1}
        value={params.masterDb}
        onChange={(e) => studio.update((p) => ({ ...p, masterDb: Number(e.target.value) }))}
        data-testid="studio-master"
      />

      <label className="field-label" htmlFor="studio-device">
        Dispositivo de saída
      </label>
      {studio.outputSelectionSupported ? (
        <select
          id="studio-device"
          className="select"
          value={studio.outputDeviceId}
          onChange={(e) => studio.selectOutputDevice(e.target.value)}
          data-testid="studio-device"
        >
          <option value="">Saída padrão do sistema</option>
          {studio.outputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      ) : (
        <p className="note-small" data-testid="studio-device-unsupported">
          {off
            ? 'A lista aparece depois de iniciar a captura.'
            : 'Indisponível neste navegador: ele não permite escolher a saída pelo aplicativo. Use a saída padrão do sistema operacional.'}
        </p>
      )}
      {studio.outputError ? (
        <p className="meter-warn" role="alert" data-testid="studio-output-error">
          <AlertIcon size={13} /> {studio.outputError}
        </p>
      ) : null}

      <button type="button" className="btn secondary" disabled={off} onClick={studio.playTestTone} data-testid="studio-test-tone">
        Tocar tom de teste
      </button>
      <p className="note-small">Tom de 440 Hz por 0,5 s direto na saída, sem passar pelos efeitos. Confira o fone antes de ligar a guitarra.</p>

      <StudioMeters studio={studio} />
    </section>
  );
}

/** Latência: só o que o navegador reporta, rotulado como estimativa, e a alternativa sem atraso. */
export function LatencySection({ studio }: { studio: StudioApi }) {
  const l = studio.readLatency();
  const show = (v: number | null) => (v !== null ? `${v.toFixed(1)} ms` : 'n/d');
  return (
    <section className="studio-latency" data-testid="studio-latency">
      <h3 className="section-title">Latência desta saída</h3>
      <ul className="capture-info">
        <li>
          <b>Latência base reportada pelo navegador:</b> {l ? show(l.baseMs) : 'n/d'}
        </li>
        <li>
          <b>Latência de saída reportada pelo navegador:</b> {l ? show(l.outputMs) : 'n/d'}
        </li>
      </ul>
      <p className="note-small">
        São estimativas do navegador, não medições: não incluem o buffer da interface de áudio nem o driver.
        A latência de ida e volta (guitarra até o fone) só se conhece medindo; o procedimento de medição por
        loopback está em docs/studio.md. Este aplicativo não mede nem promete um valor.
      </p>
      <div className="info-box" data-testid="studio-direct-monitoring">
        <InfoIcon size={16} />
        <span>
          Navegadores não usam ASIO. Se o atraso incomodar, use o <b>monitoramento direto</b> da própria
          interface de áudio (botão Direct Monitor / mistura de entrada): o som da guitarra vai ao fone sem
          passar pelo computador, com atraso zero. Nesse caso, os efeitos deste painel não são aplicados ao som
          que você ouve.
        </span>
      </div>
    </section>
  );
}
