import { LagTerms } from './lag-terms';
import { lagRange, parabolic, type LagSearchOptions, type PitchDetector, type PitchEstimate } from './mpm';

/**
 * YIN (de Cheveigné e Kawahara, 2002), implementado como referência para
 * comparar com o MPM nos testes. Não é o caminho principal do aplicativo.
 */
export class YinDetector implements PitchDetector {
  readonly minDetectableHz: number;
  private readonly terms: LagTerms;
  private readonly cmnd: Float64Array;
  private readonly tauMin: number;
  private readonly tauMax: number;

  constructor(private readonly opts: LagSearchOptions & { threshold: number }) {
    const { tauMin, tauMax } = lagRange(opts);
    this.tauMin = tauMin;
    this.tauMax = tauMax;
    this.minDetectableHz = opts.sampleRate / tauMax;
    this.terms = new LagTerms(opts.windowSize, tauMax + 2);
    this.cmnd = new Float64Array(tauMax + 2);
  }

  detect(window: Float32Array): PitchEstimate | null {
    const { terms, cmnd, tauMax, tauMin } = this;
    terms.load(window);
    if (terms.energy < 1e-12) return null;

    // d(τ) = m(τ) − 2 r(τ); diferença média normalizada cumulativa.
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      const d = Math.max(0, terms.m(tau) - 2 * terms.r(tau));
      running += d;
      cmnd[tau] = running > 0 ? (d * tau) / running : 1;
    }

    let tau = tauMin;
    let found = -1;
    while (tau < tauMax) {
      if (cmnd[tau]! < this.opts.threshold) {
        while (tau + 1 < tauMax && cmnd[tau + 1]! < cmnd[tau]!) tau++;
        found = tau;
        break;
      }
      tau++;
    }
    if (found < 0) {
      // Sem valor abaixo do limiar: usa o mínimo global, com clareza correspondentemente baixa.
      let min = Infinity;
      for (let t = tauMin; t < tauMax; t++) {
        if (cmnd[t]! < min) {
          min = cmnd[t]!;
          found = t;
        }
      }
      if (found < 0 || min > 0.5) return null;
    }

    const [period, value] = parabolic(cmnd[found - 1]!, cmnd[found]!, cmnd[found + 1]!, found);
    if (!(period > 0)) return null;
    return { frequency: this.opts.sampleRate / period, clarity: Math.min(1, Math.max(0, 1 - value)) };
  }
}
