import { LagTerms } from './lag-terms';

export interface PitchEstimate {
  frequency: number;
  /** 0..1. Altura do pico da NSDF (MPM) ou 1 − d′ (YIN). Não é probabilidade. */
  clarity: number;
}

export interface PitchDetector {
  /** Menor frequência detectável com esta janela e taxa. */
  readonly minDetectableHz: number;
  detect(window: Float32Array): PitchEstimate | null;
}

export interface LagSearchOptions {
  sampleRate: number;
  windowSize: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
}

/**
 * Faixa de atrasos pesquisada. O atraso máximo é limitado a metade da janela:
 * além disso restam menos de dois períodos sobrepostos e a estimativa perde sentido.
 * Por isso, notas graves exigem janela maior (ver docs/detection.md).
 */
export function lagRange(o: LagSearchOptions): { tauMin: number; tauMax: number } {
  const tauMin = Math.max(2, Math.floor(o.sampleRate / o.maxFrequencyHz));
  const tauMax = Math.min(Math.ceil(o.sampleRate / o.minFrequencyHz), Math.floor(o.windowSize / 2));
  return { tauMin, tauMax };
}

/** Interpolação parabólica do vértice em torno do índice i. Devolve [posição, valor]. */
export function parabolic(y0: number, y1: number, y2: number, i: number): [number, number] {
  const denom = y0 - 2 * y1 + y2;
  if (Math.abs(denom) < 1e-12) return [i, y1];
  const delta = (0.5 * (y0 - y2)) / denom;
  return [i + delta, y1 - 0.25 * (y0 - y2) * delta];
}

/**
 * McLeod Pitch Method (McLeod e Wyvill, 2005): NSDF + escolha do primeiro pico
 * que atinge `cutoff` × o maior pico.
 */
export class MpmDetector implements PitchDetector {
  readonly minDetectableHz: number;
  private readonly terms: LagTerms;
  private readonly nsdf: Float64Array;
  private readonly tauMin: number;
  private readonly tauMax: number;

  constructor(
    private readonly opts: LagSearchOptions & { cutoff: number },
  ) {
    const { tauMin, tauMax } = lagRange(opts);
    this.tauMin = tauMin;
    this.tauMax = tauMax;
    this.minDetectableHz = opts.sampleRate / tauMax;
    this.terms = new LagTerms(opts.windowSize, tauMax + 2);
    this.nsdf = new Float64Array(tauMax + 2);
  }

  detect(window: Float32Array): PitchEstimate | null {
    const { terms, nsdf, tauMax, tauMin } = this;
    terms.load(window);
    if (terms.energy < 1e-12) return null;

    for (let tau = 0; tau <= tauMax + 1; tau++) {
      const m = terms.m(tau);
      nsdf[tau] = m > 1e-12 ? (2 * terms.r(tau)) / m : 0;
    }

    // Ignora o primeiro lóbulo (atraso 0) e começa no primeiro cruzamento positivo.
    let pos = 1;
    while (pos < tauMax && nsdf[pos]! > 0) pos++;
    while (pos < tauMax && nsdf[pos]! <= 0) pos++;

    const peaks: number[] = [];
    let best = -1;
    for (; pos <= tauMax; pos++) {
      if (nsdf[pos]! > 0) {
        if (best < 0 || nsdf[pos]! > nsdf[best]!) best = pos;
      } else if (best >= 0) {
        if (best >= tauMin) peaks.push(best);
        best = -1;
      }
    }
    // Última região positiva cortada pelo limite de busca: só vale se o máximo for um pico
    // verdadeiro (já em descida), senão seria apenas uma subida ainda em curso.
    if (best >= tauMin && best > 1 && nsdf[best]! >= nsdf[best - 1]! && nsdf[best]! > nsdf[best + 1]!) {
      peaks.push(best);
    }

    if (peaks.length === 0) return null;
    let highest = 0;
    for (const p of peaks) highest = Math.max(highest, nsdf[p]!);
    const threshold = this.opts.cutoff * highest;
    const chosen = peaks.find((p) => nsdf[p]! >= threshold) ?? peaks[0]!;

    const [period, value] = parabolic(nsdf[chosen - 1]!, nsdf[chosen]!, nsdf[chosen + 1]!, chosen);
    if (!(period > 0)) return null;
    return { frequency: this.opts.sampleRate / period, clarity: Math.min(1, Math.max(0, value)) };
  }
}
