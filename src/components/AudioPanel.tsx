import { WINDOW_SIZES, type ChannelMode, type WindowSize } from '../types/audio';
import { DEFAULT_PARAMS, sensitivityToOpenDb } from '../dsp/defaults';
import type { AudioCaptureApi } from '../hooks/useAudioCapture';
import { LevelMeter } from './LevelMeter';
import { Panel } from './Panel';
import {
  AlertIcon,
  ChevronDownIcon,
  ShieldIcon,
  StopIcon,
  PlayIcon,
  UsbIcon,
  WaveformIcon,
} from './icons';

function windowMs(size: WindowSize, sampleRate: number | null): string {
  const sr = sampleRate ?? 48000;
  return `${((size / sr) * 1000).toFixed(0)} ms`;
}

/** Menor frequência detectável: o maior entre o piso configurado e o limite da janela (2 períodos). */
function minHz(size: WindowSize, sampleRate: number | null): string {
  const sr = sampleRate ?? 48000;
  return `${Math.max(DEFAULT_PARAMS.minFrequencyHz, sr / (size / 2)).toFixed(0)} Hz`;
}

function thresholdDb(sensitivity: number): string {
  return sensitivityToOpenDb(sensitivity).toFixed(0);
}

const CHANNEL_OPTIONS: { mode: ChannelMode; label: string }[] = [
  { mode: 'ch1', label: 'Entrada 1' },
  { mode: 'ch2', label: 'Entrada 2' },
  { mode: 'sum', label: 'Soma' },
];

function fmtDb(db: number): string {
  return Number.isFinite(db) ? `${db.toFixed(0)} dBFS` : '−∞ dBFS';
}

/** Níveis reais de cada canal de entrada, para descobrir em qual a guitarra está ligada. */
function ChannelBars({
  channels,
  mode,
  active,
}: {
  channels: AudioCaptureApi['channelMeters'];
  mode: ChannelMode;
  active: boolean;
}) {
  if (!active) return null;
  if (channels.length < 2) {
    return (
      <p className="note-small" data-testid="channel-bars">
        O navegador entregou apenas 1 canal de entrada: a seleção de canal não tem efeito.
      </p>
    );
  }
  return (
    <div className="channel-bars" data-testid="channel-bars">
      {channels.map((c, i) => {
        const used = mode === 'sum' || (mode === 'ch1' ? i === 0 : i === 1);
        return (
          <div key={i} className={`channel-bar ${used ? 'used' : ''}`}>
            <span>Entrada {i + 1}</span>
            <div className="track">
              <div className={`fill ${c.clipping ? 'hot' : ''}`} style={{ width: `${c.level * 100}%` }} />
            </div>
            <output data-testid={`channel-db-${i + 1}`}>{fmtDb(c.rmsDb)}</output>
          </div>
        );
      })}
    </div>
  );
}

export function AudioPanel({ audio }: { audio: AudioCaptureApi }) {
  const { status, error, devices, selectedDeviceId, settings, info, meter } = audio;
  const active = status === 'active';
  const busy = status === 'requesting';
  const noDevices = devices.length === 0;

  const connection = active
    ? { cls: 'ok', text: 'Conectado e capturando' }
    : busy
      ? { cls: '', text: 'Solicitando acesso ao dispositivo…' }
      : status === 'error'
        ? { cls: 'err', text: 'Sem conexão' }
        : { cls: '', text: 'Captura parada' };

  return (
    <Panel title="Áudio" icon={<WaveformIcon size={22} />} testId="audio-panel">
      <label className="field-label" htmlFor="device-select">
        Dispositivo de entrada
      </label>
      <div style={{ position: 'relative' }}>
        <select
          id="device-select"
          className="select"
          value={selectedDeviceId}
          disabled={active || busy}
          onChange={(e) => audio.selectDevice(e.target.value)}
          title={audio.devices.find((d) => d.deviceId === selectedDeviceId)?.label}
          data-testid="device-select"
        >
          <option value="">Entrada padrão do sistema</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          size={16}
          style={{ position: 'absolute', right: 10, top: 12, pointerEvents: 'none' }}
        />
      </div>
      {!audio.labelsAvailable && audio.supported && status !== 'active' ? (
        <p className="note-small">
          Os nomes dos dispositivos só aparecem depois que você conceder a permissão de áudio.
        </p>
      ) : null}
      {noDevices && audio.supported ? (
        <p className="note-small" data-testid="no-devices-hint">
          Nenhuma entrada listada. Conecte a interface de áudio USB; a lista é atualizada
          automaticamente.
        </p>
      ) : null}

      <div className={`status-line ${connection.cls}`} data-testid="audio-connection">
        <UsbIcon size={16} />
        {connection.text}
      </div>
      {active ? (
        <div className="live-flag" role="status" data-testid="capture-active">
          Microfone em uso: a captura está ativa. Pare a qualquer momento.
        </div>
      ) : null}

      {error ? (
        <div className="alert" role="alert" data-testid="audio-error">
          <strong>
            <AlertIcon size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            {error.title}
          </strong>
          <p>{error.message}</p>
          <ul>
            {error.instructions.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {audio.contextSuspended && active ? (
        <div className="alert warn" role="alert" data-testid="context-suspended">
          <strong>Processamento de áudio suspenso</strong>
          <p>O navegador pausou o áudio.</p>
          <button type="button" className="btn secondary" onClick={() => void audio.resume()}>
            Retomar
          </button>
        </div>
      ) : null}

      <div className="divider" />
      <h3 className="section-title">Configurações</h3>

      <div className="slider-row">
        <span id="channel-label">Canal analisado</span>
      </div>
      <div className="seg" role="group" aria-labelledby="channel-label" data-testid="channel-mode">
        {CHANNEL_OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            aria-pressed={settings.channelMode === o.mode}
            onClick={() => audio.updateSettings({ channelMode: o.mode })}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="note-small">
        Escolha a entrada em que a guitarra está ligada. &quot;Soma&quot; faz a média dos dois
        canais; se só um tiver sinal, o nível cai 6 dB. Vale imediatamente.
      </p>

      <div className="slider-row">
        <label htmlFor="sensitivity">Sensibilidade</label>
        <output>{settings.sensitivity}%</output>
      </div>
      <input
        id="sensitivity"
        type="range"
        min={0}
        max={100}
        value={settings.sensitivity}
        onChange={(e) => audio.updateSettings({ sensitivity: Number(e.target.value) })}
      />
      <p className="note-small">
        Limiar de silêncio do detector: {thresholdDb(settings.sensitivity)} dBFS. Vale
        imediatamente.
      </p>

      <div className="slider-row">
        <span id="window-label">Janela de análise (latência)</span>
        <output data-testid="window-ms">{windowMs(settings.windowSize, info?.sampleRate ?? null)}</output>
      </div>
      <div className="seg" role="group" aria-labelledby="window-label" data-testid="window-size">
        {WINDOW_SIZES.map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={settings.windowSize === w}
            onClick={() => audio.updateSettings({ windowSize: w })}
          >
            {w}
          </button>
        ))}
      </div>
      <p className="note-small">
        Menor frequência detectável: {minHz(settings.windowSize, info?.sampleRate ?? null)}. Janela
        maior estabiliza mais e custa latência. Troca o motor na hora. Medições em docs/detection.md.
      </p>

      <div className="switch-row">
        <span id="df-label">Filtro de ruído do detector</span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.detectorNoiseFilter}
          aria-labelledby="df-label"
          className="switch"
          onClick={() =>
            audio.updateSettings({ detectorNoiseFilter: !settings.detectorNoiseFilter })
          }
          data-testid="detector-filter-switch"
        />
      </div>
      <p className="note-small">
        Passa-faixa 60 Hz a 2,5 kHz e limiar que acompanha o ruído de fundo. Vale imediatamente.
      </p>

      <div className="switch-row">
        <span id="ns-label">Redução de ruído do navegador</span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.browserNoiseReduction}
          aria-labelledby="ns-label"
          className="switch"
          disabled={active || busy}
          onClick={() =>
            audio.updateSettings({ browserNoiseReduction: !settings.browserNoiseReduction })
          }
          data-testid="noise-switch"
        />
      </div>
      <p className="note-small">
        Desligada por padrão: filtros de voz do navegador distorcem a forma de onda. Aplica-se ao
        iniciar a captura.
      </p>

      <div className="divider" />
      <h3 className="section-title">Nível de sinal</h3>
      <LevelMeter meter={meter} active={active} />
      <ChannelBars channels={audio.channelMeters} mode={settings.channelMode} active={active} />

      {active ? (
        <button type="button" className="btn" onClick={() => void audio.stop()} data-testid="stop-btn">
          <StopIcon size={16} /> Parar
        </button>
      ) : (
        <button
          type="button"
          className="btn"
          disabled={busy || !audio.supported}
          onClick={() => void audio.start()}
          data-testid="start-btn"
        >
          <PlayIcon size={16} /> {status === 'error' ? 'Tentar novamente' : 'Iniciar'}
        </button>
      )}

      {info ? (
        <ul className="capture-info" data-testid="capture-info">
          <li>
            <b>Taxa de amostragem:</b> {info.sampleRate} Hz
          </li>
          <li>
            <b>Latência base do contexto:</b>{' '}
            {info.baseLatencyMs !== null ? `${info.baseLatencyMs.toFixed(1)} ms` : 'n/d'} (não é a
            latência de detecção)
          </li>
          <li>
            <b>Processamento do navegador:</b> eco {String(info.appliedProcessing.echoCancellation)},
            ruído {String(info.appliedProcessing.noiseSuppression)}, ganho automático{' '}
            {String(info.appliedProcessing.autoGainControl)}
          </li>
          {audio.stats ? (
            <li data-testid="gate-diagnostics">
              <b>Portão de silêncio:</b> energia {fmtDb(audio.live.energyDb)} · limiar{' '}
              {fmtDb(audio.live.openDb)} (ruído de fundo {fmtDb(audio.live.noiseFloorDb)}) ·{' '}
              {audio.live.gateOpen ? 'ABERTO' : 'fechado'} · clareza da altura{' '}
              {audio.live.frequency !== null ? audio.live.clarity.toFixed(2) : 'sem altura'} (mínimo 0,80)
            </li>
          ) : null}
          {audio.stats ? (
            <li data-testid="engine-diagnostics">
              <b>Diagnóstico do motor:</b> {audio.stats.blocksPerSec.toFixed(0)} blocos/s ·{' '}
              {(audio.stats.bytesPerSec / 1024).toFixed(0)} KiB/s · entrega do worklet{' '}
              {audio.stats.transferMeanMs.toFixed(1)} ms · análise média{' '}
              {audio.stats.frameMeanMs.toFixed(2)} ms, máx. {audio.stats.frameMaxMs.toFixed(2)} ms ·
              tarefas longas (&gt;50 ms): {audio.stats.longTasks}
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="privacy">
        <ShieldIcon size={16} />
        <span>
          O áudio é processado apenas neste navegador. Nada é gravado, armazenado ou enviado. O
          navegador pede permissão antes de acessar a entrada.
        </span>
      </div>
    </Panel>
  );
}
