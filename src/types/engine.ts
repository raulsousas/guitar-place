import type { WindowSize } from './audio';

/** Algoritmo de estimativa de altura. MPM é o principal; YIN serve de referência. */
export type PitchAlgorithm = 'mpm' | 'yin';

/**
 * Parâmetros do detector. Valores padrão, efeito e custo de cada um estão em
 * `src/dsp/defaults.ts` e em `docs/detection.md`.
 */
export interface DetectorParams {
  algorithm: PitchAlgorithm;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  mpmCutoff: number;
  yinThreshold: number;
  minClarity: number;
  stableFrames: number;
  octaveJumpFrames: number;
  changeSemitones: number;
  onsetRiseDb: number;
  onsetLookbackMs: number;
  reattackMinMs: number;
  releaseMs: number;
  unpitchedReleaseMs: number;
  hysteresisDb: number;
  noiseMarginDb: number;

  energyWindowMs: number;
  highpassHz: number;
  lowpassHz: number;
}

export interface EngineConfig extends DetectorParams {
  sampleRate: number;
  /** Janela de análise em amostras (2048, 4096, 8192). */
  windowSize: WindowSize | number;
  /** Passo entre análises, em amostras. */
  hopSize: number;
  /** 0..100. Mais alto = limiar de silêncio mais baixo (mais sensível). */
  sensitivity: number;
  /** Filtros passa-faixa e limiar adaptativo ao ruído de fundo. */
  noiseFilter: boolean;
  /** Referência de afinação do A4. */
  a4Hz: number;
}

/** Resultado de uma análise (um por passo). Tempo no relógio do motor (s). */
export interface PitchFrame {
  /** Fim da janela analisada, em segundos desde o início do motor. */
  time: number;
  /** Energia (dBFS, RMS) dos últimos `energyWindowMs`. */
  energyDb: number;
  gateOpen: boolean;
  /** Limiar de abertura do portão neste quadro (dBFS), já com sensibilidade e ruído de fundo. */
  openDb: number;
  /** Ruído de fundo estimado (dBFS) usado no limiar quando o filtro de ruído está ligado. */
  noiseFloorDb: number;
  /** Frequência estimada, ou null quando não há altura válida. */
  frequency: number | null;
  /** Qualidade da periodicidade, 0..1. Não é probabilidade. */
  clarity: number;
  /** Tempo gasto nesta análise (ms, relógio de parede). */
  processingMs: number;
}

export type NoteEventType = 'onset' | 'change' | 'release';

export interface NoteEvent {
  type: NoteEventType;
  /** Quando o evento foi decidido (s, relógio do motor). */
  time: number;
  /** Instante estimado do ataque que originou a nota (s). */
  onsetTime: number;
  midi: number;
  frequency: number;
  /** Desvio da frequência em relação à nota MIDI, em cents. */
  cents: number;
  /**
   * Confiança da DETECÇÃO DA NOTA (altura). Independente da confiança de
   * corda/casa, que é calculada apenas na Fase 4.
   */
  pitchConfidence: number;
  levelDb: number;
  /** (time − onsetTime) em ms: atraso entre o ataque percebido e o evento. */
  latencyMs: number;
  /** Só em 'release'. */
  reason?: 'silence' | 'unpitched' | 'reattack';
  /** Só em 'release': duração da nota em segundos. */
  duration?: number;
}

/** Nota atualmente em andamento, para exibição ao vivo. */
export interface ActiveNote {
  midi: number;
  frequency: number;
  cents: number;
  /** Clareza suavizada das últimas análises com altura válida. */
  pitchConfidence: number;
  onsetTime: number;
  /** false quando o último quadro não teve altura válida (nota ainda sustentada). */
  pitched: boolean;
}

export interface EngineOutput {
  frame: PitchFrame;
  events: NoteEvent[];
}


