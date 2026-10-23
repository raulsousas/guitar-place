import type { AudioBlock } from '../types/audio';
import type { ActiveNote, EngineConfig, NoteEvent, PitchFrame } from '../types/engine';
import { PitchEngine } from '../dsp/pitch-engine';

/**
 * Latência de uma nota detectada, decomposta. Nada aqui inclui a latência de
 * hardware da entrada (conversor, driver, buffer do WASAPI), que o navegador não expõe.
 */
export interface DetectionLatency {
  /** Do ataque estimado até a decisão do detector, em tempo de ÁUDIO (inclui enchimento da janela). */
  algorithmicMs: number;
  /** Atraso aproximado de entrega do bloco do worklet à thread principal. */
  transferMs: number;
  /** Tempo de CPU gasto no processamento do bloco que gerou o evento. */
  processingMs: number;
  /** Soma das três partes. */
  totalMs: number;
}

export interface EngineStats {
  sampleRate: number;
  windowSize: number;
  /** Latência estrutural: tempo para encher a janela. Não é a latência medida. */
  windowLatencyMs: number;
  blocksPerSec: number;
  bytesPerSec: number;
  framesPerSec: number;
  /** Tempo de CPU por bloco processado (inclui todos os quadros de análise do bloco). */
  blockMeanMs: number;
  blockMaxMs: number;
  /** Tempo por quadro de análise. */
  frameMeanMs: number;
  frameMaxMs: number;
  transferMeanMs: number;
  longTasks: number;
  /** Última latência medida de um ataque (null até o primeiro). */
  lastLatency: DetectionLatency | null;
}

export interface EngineHostCallbacks {
  onFrame?(frame: PitchFrame, active: ActiveNote | null): void;
  onEvent(event: NoteEvent, latency: DetectionLatency | null): void;
}

/**
 * Liga blocos de áudio ao `PitchEngine`, mede custo e latência e entrega eventos.
 * Sem React e sem Web Audio: pode ser testado com blocos sintéticos.
 */
export class EngineHost {
  readonly engine: PitchEngine;
  private lastLatency: DetectionLatency | null = null;
  private longTasks = 0;
  private observer: PerformanceObserver | null = null;

  private windowStart = 0;
  private blocks = 0;
  private bytes = 0;
  private frames = 0;
  private blockSum = 0;
  private blockMax = 0;
  private frameSum = 0;
  private frameMax = 0;
  private transferSum = 0;
  private cached: EngineStats | null = null;

  constructor(
    readonly config: EngineConfig,
    private readonly callbacks: EngineHostCallbacks,
    now: () => number = () => performance.now(),
  ) {
    this.engine = new PitchEngine(config);
    this.now = now;
    this.windowStart = now();
  }

  private readonly now: () => number;

  /** Conta tarefas longas (>50 ms) da thread principal, quando o navegador permite. */
  observeLongTasks(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      this.observer = new PerformanceObserver((list) => {
        this.longTasks += list.getEntries().length;
      });
      this.observer.observe({ entryTypes: ['longtask'] });
    } catch {
      this.observer = null;
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  pushBlock(block: AudioBlock): void {
    const t0 = this.now();
    const outputs = this.engine.process(block.samples);
    const blockMs = this.now() - t0;

    const transferMs = Math.max(0, (block.contextNow - block.frameTime) * 1000);
    this.blocks++;
    this.bytes += block.samples.byteLength;
    this.blockSum += blockMs;
    this.blockMax = Math.max(this.blockMax, blockMs);
    this.transferSum += transferMs;

    for (const out of outputs) {
      this.frames++;
      this.frameSum += out.frame.processingMs;
      this.frameMax = Math.max(this.frameMax, out.frame.processingMs);
      this.callbacks.onFrame?.(out.frame, this.engine.activeNote);
      for (const ev of out.events) {
        let latency: DetectionLatency | null = null;
        if (ev.type !== 'release') {
          latency = {
            algorithmicMs: ev.latencyMs,
            transferMs,
            processingMs: blockMs,
            totalMs: ev.latencyMs + transferMs + blockMs,
          };
          this.lastLatency = latency;
        }
        this.callbacks.onEvent(ev, latency);
      }
    }
  }

  /** Estatísticas da última janela de ~1 s. Recalcula no máximo uma vez por segundo. */
  stats(): EngineStats {
    const now = this.now();
    const elapsed = (now - this.windowStart) / 1000;
    if (elapsed >= 1 || !this.cached) {
      const sec = Math.max(elapsed, 1e-3);
      this.cached = {
        sampleRate: this.config.sampleRate,
        windowSize: this.config.windowSize,
        windowLatencyMs: this.engine.windowLatencyMs,
        blocksPerSec: this.blocks / sec,
        bytesPerSec: this.bytes / sec,
        framesPerSec: this.frames / sec,
        blockMeanMs: this.blocks ? this.blockSum / this.blocks : 0,
        blockMaxMs: this.blockMax,
        frameMeanMs: this.frames ? this.frameSum / this.frames : 0,
        frameMaxMs: this.frameMax,
        transferMeanMs: this.blocks ? this.transferSum / this.blocks : 0,
        longTasks: this.longTasks,
        lastLatency: this.lastLatency,
      };
      if (elapsed >= 1) {
        this.windowStart = now;
        this.blocks = this.bytes = this.frames = 0;
        this.blockSum = this.blockMax = this.frameSum = this.frameMax = this.transferSum = 0;
      }
    } else {
      this.cached = { ...this.cached, longTasks: this.longTasks, lastLatency: this.lastLatency };
    }
    return this.cached;
  }
}
