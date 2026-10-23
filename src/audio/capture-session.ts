import type {
  AudioBlock,
  AudioErrorKind,
  BlockMessage,
  CaptureGraph,
  CaptureInfo,
  CaptureSettings,
  ChannelMode,
  LevelReading,
} from '../types/audio';
import { AudioCaptureError } from './errors';
import { isCaptureSupported } from './devices';
import workletUrl from './capture-processor.worklet.ts?worker&url';

export interface CaptureSessionCallbacks {
  /** Bloco mono (buffer transferido; quem recebe é o dono) com a leitura de nível correspondente. */
  onBlock(block: AudioBlock, level: LevelReading): void;
  /** Disparado quando a captura termina sem pedido do usuário (ex.: dispositivo desconectado). */
  onInterrupted(kind: AudioErrorKind): void;
}

export interface StartOptions {
  /** Vazio = entrada padrão do sistema. */
  deviceId: string;
  settings: Pick<CaptureSettings, 'browserNoiseReduction' | 'channelMode'>;
}

/**
 * Uma sessão de captura: MediaStream -> AudioContext -> AudioWorklet.
 *
 * - O áudio nunca é gravado, armazenado nem enviado; os blocos existem só em memória,
 *   para a análise, e são descartados.
 * - O nó do worklet NÃO é conectado ao destino. A reprodução (Estúdio) é um ramo separado, ligado
 *   à mesma fonte por `src/fx`, desligado até o usuário ativar a saída.
 * - Eco, redução de ruído e controle automático de ganho ficam DESLIGADOS por
 *   padrão: esses filtros do navegador foram pensados para voz e distorcem a
 *   forma de onda, prejudicando a estimativa de altura.
 * - Pede até 2 canais (ideal) para interfaces estéreo como a M-Track Duo; o worklet
 *   escolhe o canal 1, o 2 ou a média, conforme `setChannelMode`.
 */
export class CaptureSession {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private stopped = false;
  private info: CaptureInfo | null = null;

  constructor(private readonly callbacks: CaptureSessionCallbacks) {}

  get captureInfo(): CaptureInfo | null {
    return this.info;
  }

  /** Contexto e fonte da captura ativa (null antes de iniciar ou depois de parar). */
  get graph(): CaptureGraph | null {
    return this.context && this.source ? { context: this.context, source: this.source } : null;
  }

  get sampleRate(): number | null {
    return this.context?.sampleRate ?? null;
  }

  async start(options: StartOptions): Promise<CaptureInfo> {
    if (!isCaptureSupported()) throw new AudioCaptureError('unsupported');

    try {
      const audio: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: options.settings.browserNoiseReduction,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      };
      if (options.deviceId) audio.deviceId = { exact: options.deviceId };

      this.stream = await navigator.mediaDevices.getUserMedia({ audio });

      this.context = new AudioContext({ latencyHint: 'interactive' });
      const ctx = this.context;

      try {
        await ctx.audioWorklet.addModule(workletUrl);
      } catch (e) {
        throw new AudioCaptureError('worklet-failed', e instanceof Error ? e.message : undefined);
      }

      this.source = ctx.createMediaStreamSource(this.stream);
      // channelCountMode 'max' (padrão): o nó recebe o número real de canais da fonte.
      this.node = new AudioWorkletNode(ctx, 'capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      this.node.port.postMessage({ type: 'mode', mode: options.settings.channelMode });
      this.node.port.onmessage = (ev: MessageEvent<BlockMessage>) => {
        const m = ev.data;
        if (m.type !== 'block') return;
        const receivedAt = performance.now();
        this.callbacks.onBlock(
          {
            samples: m.samples,
            endSample: m.endSample,
            frameTime: m.frameTime,
            contextNow: ctx.currentTime,
            receivedAt,
          },
          {
            rms: m.rms,
            peak: m.peak,
            channels: m.channels,
            samples: m.samples.length,
            frameTime: m.frameTime,
            receivedAt,
          },
        );
      };
      this.source.connect(this.node);

      if (ctx.state === 'suspended') await ctx.resume();
      if (ctx.state !== 'running') throw new AudioCaptureError('context-suspended');

      const track = this.stream.getAudioTracks()[0];
      if (!track) throw new AudioCaptureError('device-not-found');
      track.addEventListener('ended', this.handleTrackEnded);
      ctx.addEventListener('statechange', this.handleContextState);

      const applied = track.getSettings();
      // Alguns navegadores reportam echoCancellation como string ('all', 'remote-only').
      const asBool = (v: boolean | string | undefined): boolean | null =>
        v === undefined ? null : typeof v === 'string' ? v !== 'none' : v;
      const info: CaptureInfo = {
        deviceLabel: track.label || 'Entrada de áudio',
        sampleRate: ctx.sampleRate,
        baseLatencyMs: Number.isFinite(ctx.baseLatency) ? ctx.baseLatency * 1000 : null,
        outputLatencyMs:
          'outputLatency' in ctx && Number.isFinite(ctx.outputLatency)
            ? ctx.outputLatency * 1000
            : null,
        appliedProcessing: {
          echoCancellation: asBool(applied.echoCancellation),
          noiseSuppression: asBool(applied.noiseSuppression),
          autoGainControl: asBool(applied.autoGainControl),
        },
        channelCount: applied.channelCount ?? null,
      };
      this.info = info;
      return info;
    } catch (e) {
      await this.release();
      throw e;
    }
  }

  /** Troca o canal usado pelo detector sem reiniciar a captura. */
  setChannelMode(mode: ChannelMode): void {
    this.node?.port.postMessage({ type: 'mode', mode });
  }

  /** Para a captura imediatamente e libera o dispositivo. */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.release();
  }

  /** Retoma um AudioContext suspenso pelo navegador. */
  async resume(): Promise<void> {
    if (!this.context) return;
    await this.context.resume();
    if (this.context.state !== 'running') throw new AudioCaptureError('context-suspended');
  }

  private readonly handleTrackEnded = (): void => {
    if (this.stopped) return;
    this.stopped = true;
    void this.release().then(() => this.callbacks.onInterrupted('device-disconnected'));
  };

  private readonly handleContextState = (): void => {
    if (this.stopped || !this.context) return;
    if (this.context.state === 'suspended') this.callbacks.onInterrupted('context-suspended');
  };

  private async release(): Promise<void> {
    const stream = this.stream;
    const ctx = this.context;
    const node = this.node;
    const source = this.source;
    this.stream = null;
    this.context = null;
    this.node = null;
    this.source = null;

    if (node) {
      node.port.onmessage = null;
      node.disconnect();
    }
    source?.disconnect();
    if (stream) {
      for (const track of stream.getTracks()) {
        track.removeEventListener('ended', this.handleTrackEnded);
        track.stop();
      }
    }
    if (ctx) {
      ctx.removeEventListener('statechange', this.handleContextState);
      if (ctx.state !== 'closed') await ctx.close().catch(() => undefined);
    }
  }
}
