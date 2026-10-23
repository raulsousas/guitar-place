import type { ChannelMode } from '../types/audio';

/**
 * Parâmetros do Estúdio. Todos têm faixa e efeito documentados em docs/studio.md.
 * Os nomes dos modelos são NEUTROS de propósito: nenhum bloco afirma reproduzir um equipamento real.
 */
export type AmpVoicing = 'clean' | 'crunch' | 'high';
export type CabinetKind = '1x12' | '4x12';

export interface StageToggle {
  enabled: boolean;
}

export interface GateParams extends StageToggle {
  /** -80..-30 dBFS: nivel da envoltoria do sinal em que o portao fica 100% aberto (fecha por completo 10 dB abaixo). */
  thresholdDb: number;
}

export interface DriveParams extends StageToggle {
  /** 0..1: ganho antes da saturação (1x a ~32x, ou 0 a 30 dB). */
  drive: number;
  /** 0..1: corte do filtro passa-baixa depois da saturação (1,5 kHz a 9 kHz). */
  tone: number;
  /** 0..1: volume depois da saturação (0 a +6 dB). */
  level: number;
}

export interface EqParams extends StageToggle {
  /** Prateleira de graves em 100 Hz, em dB (-12..+12). */
  lowDb: number;
  /** Faixa média em 800 Hz (Q 0,9), em dB (-12..+12). */
  midDb: number;
  /** Prateleira de agudos em 3 kHz, em dB (-12..+12). */
  highDb: number;
}

export interface AmpParams extends StageToggle {
  voicing: AmpVoicing;
  /** 0..1: ganho de entrada do amplificador. */
  gain: number;
  bass: number;
  mid: number;
  treble: number;
  /** 0..1: volume de saída do amplificador. */
  level: number;
}

export interface CabinetParams extends StageToggle {
  kind: CabinetKind;
}

export interface DelayParams extends StageToggle {
  /** 40..1000 ms. */
  timeMs: number;
  /** 0..0,85 (limitado abaixo de 1 para o eco sempre decair). */
  feedback: number;
  /** 0..1: quanto do eco entra na mistura. */
  mix: number;
}

export interface ReverbParams extends StageToggle {
  /** 0,3..4 s de decaimento. */
  decayS: number;
  mix: number;
}

export interface StudioParams {
  /** Canal de entrada usado para ouvir (independente do canal do detector). */
  inputChannel: ChannelMode;
  /** -20..+20 dB antes de todos os efeitos. */
  inputTrimDb: number;
  gate: GateParams;
  drive: DriveParams;
  eq: EqParams;
  amp: AmpParams;
  cabinet: CabinetParams;
  delay: DelayParams;
  reverb: ReverbParams;
  /** Volume de saída em dB (-40..0). */
  masterDb: number;
}

export interface StudioLevels {
  inputPeakDb: number;
  /** RMS do sinal de entrada depois do ganho de entrada (dBFS). Usado para medir o ruído de fundo. */
  inputRmsDb: number;
  /** 0 (portão fechado) a 1 (aberto): ganho do portão de ruído no último bloco. Sem sinal na entrada vale 0. */
  gateOpen: number;
  outputPeakDb: number;
  outputRmsDb: number;
  inputClip: boolean;
  outputClip: boolean;
}