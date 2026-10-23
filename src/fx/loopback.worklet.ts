/**
 * AudioWorkletProcessor do medidor de latência por loopback.
 *
 * Roda na thread de áudio e faz o mínimo: lê a entrada (maior valor absoluto entre os canais), informa o pico de cada ~50 ms
 * (usado para medir o ruído de fundo) e, quando "armado", avisa a PRIMEIRA amostra que passa do limiar, com o instante dela no
 * relógio do AudioContext (`currentTime` + posição / taxa). Nada é gravado: só números saem daqui.
 */

export {}; // trata o arquivo como módulo para que os `declare` abaixo fiquem locais

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor & { process(inputs: Float32Array[][]): boolean }): void;

/** Intervalo (s) entre mensagens de pico. */
const PEAK_EVERY_S = 0.05;

class LoopbackProcessor extends AudioWorkletProcessor {
  private threshold = Infinity;
  private holdoffS = 0.05;
  private holdUntil = 0;
  private peakAcc = 0;
  private lastPeakPost = 0;

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent<{ type: string; threshold?: number; holdoffS?: number }>) => {
      const m = ev.data;
      if (m.type === 'arm') {
        this.threshold = m.threshold ?? Infinity;
        this.holdoffS = m.holdoffS ?? 0.05;
        this.holdUntil = 0;
      } else if (m.type === 'disarm') {
        this.threshold = Infinity;
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const first = input?.[0];
    if (!input || !first) return true;
    const frames = first.length;
    for (let i = 0; i < frames; i++) {
      let m = 0;
      for (const ch of input) {
        const v = ch[i] ?? 0;
        const a = v < 0 ? -v : v;
        if (a > m) m = a;
      }
      if (m > this.peakAcc) this.peakAcc = m;
      const t = currentTime + i / sampleRate;
      if (m > this.threshold && t >= this.holdUntil) {
        this.port.postMessage({ type: 'hit', time: t, peak: m });
        this.holdUntil = t + this.holdoffS;
      }
    }
    if (currentTime - this.lastPeakPost >= PEAK_EVERY_S) {
      this.port.postMessage({ type: 'peak', peak: this.peakAcc });
      this.peakAcc = 0;
      this.lastPeakPost = currentTime;
    }
    return true;
  }
}

registerProcessor('loopback-processor', LoopbackProcessor);
