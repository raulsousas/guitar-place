import { FFT, nextPowerOfTwo } from './fft';

/**
 * Termos de atraso usados por MPM e YIN, calculados por autocorrelação via FFT
 * (custo O(N log N) em vez de O(N·lag)).
 *
 *   r(τ) = Σ x[j]·x[j+τ]                       j = 0 .. W−1−τ
 *   m(τ) = Σ (x[j]² + x[j+τ]²)                  mesmo intervalo
 *
 * MPM: NSDF(τ) = 2·r(τ)/m(τ).   YIN: d(τ) = m(τ) − 2·r(τ).
 */
export class LagTerms {
  readonly windowSize: number;
  readonly maxLag: number;
  private readonly fft: FFT;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly prefix: Float64Array;

  constructor(windowSize: number, maxLag: number) {
    this.windowSize = windowSize;
    this.maxLag = Math.min(maxLag, windowSize - 1);
    const n = nextPowerOfTwo(windowSize * 2);
    this.fft = new FFT(n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.prefix = new Float64Array(windowSize + 1);
  }

  /** Prepara r(τ) e as somas parciais para a janela `x` (tamanho = windowSize). */
  load(x: Float32Array): void {
    const w = this.windowSize;
    const { re, im, prefix } = this;
    re.fill(0);
    im.fill(0);
    prefix[0] = 0;
    for (let i = 0; i < w; i++) {
      const v = x[i]!;
      re[i] = v;
      prefix[i + 1] = prefix[i]! + v * v;
    }
    this.fft.transform(re, im, false);
    for (let i = 0; i < re.length; i++) {
      re[i] = re[i]! * re[i]! + im[i]! * im[i]!;
      im[i] = 0;
    }
    this.fft.transform(re, im, true);
  }

  r(lag: number): number {
    return this.re[lag]!;
  }

  m(lag: number): number {
    const w = this.windowSize;
    const p = this.prefix;
    return p[w - lag]! + (p[w]! - p[lag]!);
  }

  get energy(): number {
    return this.prefix[this.windowSize]!;
  }
}
