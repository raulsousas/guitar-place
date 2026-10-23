import type { EngineConfig, EngineOutput, PitchFrame, ActiveNote } from '../types/engine';
import { Biquad } from './biquad';
import { sensitivityToOpenDb } from './defaults';
import { MpmDetector, type PitchDetector } from './mpm';
import { NoteTracker } from './note-tracker';
import { YinDetector } from './yin';

/** Piso numérico para evitar log(0). */
const FLOOR_DB = -120;
/** Subida lenta do ruído de fundo (dB/s) e descida rápida: o piso segue o mínimo recente. */
const NOISE_RISE_DB_PER_S = 3;
const NOISE_FALL_ALPHA = 0.2;

export function createDetector(cfg: EngineConfig): PitchDetector {
  const base = {
    sampleRate: cfg.sampleRate,
    windowSize: cfg.windowSize,
    minFrequencyHz: cfg.minFrequencyHz,
    maxFrequencyHz: cfg.maxFrequencyHz,
  };
  return cfg.algorithm === 'yin'
    ? new YinDetector({ ...base, threshold: cfg.yinThreshold })
    : new MpmDetector({ ...base, cutoff: cfg.mpmCutoff });
}

function toDb(meanSquare: number): number {
  return meanSquare > 1e-12 ? 10 * Math.log10(meanSquare) : FLOOR_DB;
}

/**
 * Motor de detecção: recebe blocos mono e devolve, a cada `hopSize` amostras,
 * um quadro de análise e os eventos de nota correspondentes.
 *
 * Não depende de React, do DOM nem do Web Audio, então roda em testes, na
 * thread principal, em um Worker ou, no futuro, no próprio worklet.
 */
export class PitchEngine {
  private readonly detector: PitchDetector;
  private readonly tracker: NoteTracker;
  private readonly hp: Biquad | null;
  private readonly lp: Biquad | null;
  private readonly ring: Float32Array;
  private readonly win: Float32Array;
  private readonly tmp: Float32Array;
  private readonly energyLen: number;
  private writePos = 0;
  private total = 0;
  private sinceAnalysis = 0;
  private noiseFloorDb = FLOOR_DB;
  private noiseInitialised = false;
  private gateOpen = false;
  private config: EngineConfig;

  constructor(config: EngineConfig) {
    this.config = config;
    this.detector = createDetector(config);
    this.tracker = new NoteTracker(config);
    this.ring = new Float32Array(config.windowSize);
    this.win = new Float32Array(config.windowSize);
    this.tmp = new Float32Array(Math.max(config.hopSize, 4096));
    this.energyLen = Math.max(8, Math.round((config.energyWindowMs / 1000) * config.sampleRate));
    this.hp = config.noiseFilter ? new Biquad('highpass', config.highpassHz, config.sampleRate) : null;
    this.lp = config.noiseFilter ? new Biquad('lowpass', config.lowpassHz, config.sampleRate) : null;
  }

  get minDetectableHz(): number {
    return this.detector.minDetectableHz;
  }

  get activeNote(): ActiveNote | null {
    return this.tracker.active;
  }

  /** Atraso estrutural: tempo necessário para preencher a janela de análise (ms). */
  get windowLatencyMs(): number {
    return (this.config.windowSize / this.config.sampleRate) * 1000;
  }

  /** Alterações de sensibilidade têm efeito imediato. Outras mudanças exigem novo motor. */
  setSensitivity(sensitivity: number): void {
    this.config = { ...this.config, sensitivity };
  }

  /** Quantidade de amostras já processadas. */
  get processedSamples(): number {
    return this.total;
  }

  process(input: Float32Array): EngineOutput[] {
    const out: EngineOutput[] = [];
    let offset = 0;
    while (offset < input.length) {
      const n = Math.min(input.length - offset, this.config.hopSize - this.sinceAnalysis, this.tmp.length);
      const chunk = this.tmp.subarray(0, n);
      chunk.set(input.subarray(offset, offset + n));
      this.hp?.processInPlace(chunk);
      this.lp?.processInPlace(chunk);
      for (let i = 0; i < n; i++) {
        this.ring[this.writePos] = chunk[i]!;
        this.writePos = (this.writePos + 1) % this.ring.length;
      }
      this.total += n;
      this.sinceAnalysis += n;
      offset += n;
      if (this.sinceAnalysis >= this.config.hopSize) {
        this.sinceAnalysis = 0;
        if (this.total >= this.config.windowSize) out.push(this.analyse());
      }
    }
    return out;
  }

  private energyDbNow(): number {
    const len = this.ring.length;
    let sum = 0;
    for (let i = 1; i <= this.energyLen; i++) {
      const v = this.ring[(this.writePos - i + len) % len]!;
      sum += v * v;
    }
    return toDb(sum / this.energyLen);
  }

  private analyse(): EngineOutput {
    const cfg = this.config;
    const t0 = performance.now();
    const time = this.total / cfg.sampleRate;
    const energyDb = this.energyDbNow();

    // Limiar do portão: sensibilidade e, com o filtro de ruído, o ruído de fundo medido.
    const hop = cfg.hopSize / cfg.sampleRate;
    if (!this.noiseInitialised) {
      this.noiseFloorDb = energyDb;
      this.noiseInitialised = true;
    } else if (!this.gateOpen) {
      this.noiseFloorDb =
        energyDb < this.noiseFloorDb
          ? this.noiseFloorDb + NOISE_FALL_ALPHA * (energyDb - this.noiseFloorDb)
          : this.noiseFloorDb + NOISE_RISE_DB_PER_S * hop;
      this.noiseFloorDb = Math.min(this.noiseFloorDb, energyDb + 40);
    }
    let openDb = sensitivityToOpenDb(cfg.sensitivity);
    if (cfg.noiseFilter) openDb = Math.max(openDb, this.noiseFloorDb + cfg.noiseMarginDb);
    const closeDb = openDb - cfg.hysteresisDb;
    this.gateOpen = this.gateOpen ? energyDb >= closeDb : energyDb >= openDb;

    let frequency: number | null = null;
    let clarity = 0;
    if (this.gateOpen) {
      // Reordena o anel em janela linear (a mais antiga primeiro).
      const len = this.ring.length;
      const first = this.writePos;
      this.win.set(this.ring.subarray(first), 0);
      this.win.set(this.ring.subarray(0, first), len - first);
      const est = this.detector.detect(this.win);
      if (est) {
        frequency = est.frequency;
        clarity = est.clarity;
      }
    }

    const frame: PitchFrame = {
      time,
      energyDb,
      gateOpen: this.gateOpen,
      openDb,
      noiseFloorDb: this.noiseFloorDb,
      frequency,
      clarity,
      processingMs: 0,
    };
    const events = this.tracker.update(frame);
    frame.processingMs = performance.now() - t0;
    return { frame, events };
  }
}
