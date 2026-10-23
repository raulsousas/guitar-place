import type { Tuning } from '../types/music';
import { frequencyToMidiFloat, midiToFrequency, midiToScientificName, A4_HZ } from './notes';

/**
 * Lógica pura do afinador (sem React, sem áudio). Recebe a frequência estimada pelo
 * detector e devolve a nota cromática mais próxima e o desvio em cents.
 */

/** Tolerância para considerar "afinado". 5 cents é difícil de ouvir e comum em afinadores de consumo. */
export const IN_TUNE_CENTS = 5;
/** Meia escala do ponteiro: o ponteiro encosta no limite acima de ±50 cents (meio semitom). */
export const GAUGE_RANGE_CENTS = 50;

export interface TunerReading {
  /** Nota MIDI cromática mais próxima. */
  midi: number;
  /** Desvio em relação a essa nota, em cents (−50..+50). Negativo = abaixo (grave demais). */
  cents: number;
  /** Frequência medida (suavizada), em Hz. */
  frequency: number;
  /** Frequência exata da nota alvo em temperamento igual, em Hz. */
  targetHz: number;
  inTune: boolean;
  /** true quando o sinal sumiu e a última leitura está sendo mantida por um instante. */
  held: boolean;
}

export function readTuner(midiFloat: number, a4Hz: number = A4_HZ): TunerReading {
  const midi = Math.round(midiFloat);
  const cents = (midiFloat - midi) * 100;
  return {
    midi,
    cents,
    frequency: a4Hz * Math.pow(2, (midiFloat - 69) / 12),
    targetHz: midiToFrequency(midi, a4Hz),
    inTune: Math.abs(cents) <= IN_TUNE_CENTS,
    held: false,
  };
}

/** Nome dividido em partes para exibição: letra, sustenido e oitava ("A#4" → A, true, 4). */
export function splitNoteName(midi: number): { letter: string; sharp: boolean; octave: number } {
  const m = /^([A-G])(#?)(-?\d+)$/.exec(midiToScientificName(midi));
  if (!m) return { letter: '?', sharp: false, octave: 0 };
  return { letter: m[1]!, sharp: m[2] === '#', octave: Number(m[3]) };
}

export type TuningAdvice = 'in-tune' | 'too-low' | 'too-high';

/** Abaixo da nota alvo = corda frouxa (aperte); acima = corda tensa demais (afrouxe). */
export function tuningAdvice(cents: number): TuningAdvice {
  if (Math.abs(cents) <= IN_TUNE_CENTS) return 'in-tune';
  return cents < 0 ? 'too-low' : 'too-high';
}

/** Ângulo do ponteiro (graus a partir da vertical) para um desvio em cents, limitado à escala. */
export function needleAngle(cents: number, maxAngleDeg = 50): number {
  const c = Math.max(-GAUGE_RANGE_CENTS, Math.min(GAUGE_RANGE_CENTS, cents));
  return (c / GAUGE_RANGE_CENTS) * maxAngleDeg;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface SmootherOptions {
  /** Quantidade de estimativas na mediana. Maior = ponteiro mais calmo e mais lento. */
  size: number;
  /** Tempo mantendo a última leitura após o sinal sumir (ms). Evita o ponteiro piscar no decaimento. */
  holdMs: number;
  /** Clareza mínima da estimativa de altura (mesma escala do detector, não é probabilidade). */
  minClarity: number;
  /** Salto (semitons) em relação à mediana que indica outra nota e reinicia o histórico. */
  jumpSemitones: number;
  a4Hz: number;
}

export const DEFAULT_SMOOTHER: SmootherOptions = {
  size: 5,
  holdMs: 600,
  minClarity: 0.8,
  jumpSemitones: 0.6,
  a4Hz: A4_HZ,
};

/**
 * Suaviza as estimativas quadro a quadro do detector com uma mediana curta, para o ponteiro
 * não tremer. Não usa o rastreador de notas: o afinador precisa do desvio contínuo em cents,
 * não de eventos de nota.
 */
export class TunerSmoother {
  private hist: number[] = [];
  private last: TunerReading | null = null;
  private lastValidAt = -Infinity;
  private readonly o: SmootherOptions;

  constructor(options: Partial<SmootherOptions> = {}) {
    this.o = { ...DEFAULT_SMOOTHER, ...options };
  }

  push(frequency: number | null, clarity: number, nowMs: number): TunerReading | null {
    const o = this.o;
    if (frequency !== null && frequency > 0 && clarity >= o.minClarity) {
      const mf = frequencyToMidiFloat(frequency, o.a4Hz);
      if (this.hist.length > 0 && Math.abs(mf - median(this.hist)) > o.jumpSemitones) this.hist = [];
      this.hist.push(mf);
      if (this.hist.length > o.size) this.hist.shift();
      this.last = readTuner(median(this.hist), o.a4Hz);
      this.lastValidAt = nowMs;
      return this.last;
    }
    if (this.last && nowMs - this.lastValidAt <= o.holdMs) return { ...this.last, held: true };
    this.reset();
    return null;
  }

  reset(): void {
    this.hist = [];
    this.last = null;
    this.lastValidAt = -Infinity;
  }
}

/** Distância máxima (cents) até uma corda solta para sugerir essa corda. Acima disso, nenhuma é indicada. */
export const STRING_HINT_MAX_CENTS = 150;

export interface NearestString {
  stringNumber: number;
  /** Nome científico da corda solta, por exemplo "G3". */
  name: string;
  midi: number;
  /** Desvio da altura medida em relação à corda solta, em cents (negativo = abaixo). */
  cents: number;
}

/**
 * Corda solta da afinação mais próxima da altura medida. É só uma sugestão de alvo para o
 * afinador: o áudio não diz qual corda foi tocada. Devolve null se nenhuma estiver a menos de
 * STRING_HINT_MAX_CENTS.
 */
export function nearestString(midiFloat: number, tuning: Tuning): NearestString | null {
  let best: NearestString | null = null;
  for (const s of tuning.strings) {
    const cents = (midiFloat - s.midi) * 100;
    if (!best || Math.abs(cents) < Math.abs(best.cents)) {
      best = { stringNumber: s.stringNumber, name: midiToScientificName(s.midi), midi: s.midi, cents };
    }
  }
  return best && Math.abs(best.cents) <= STRING_HINT_MAX_CENTS ? best : null;
}
