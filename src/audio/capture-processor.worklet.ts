/**
 * AudioWorkletProcessor de captura.
 *
 * Roda na thread de renderização de áudio, então faz o mínimo: combina os canais de
 * entrada em um sinal mono (média, canal 1 ou canal 2), acumula em um buffer e, a cada
 * ~10 ms, TRANSFERE esse buffer (sem copiar) para a thread principal junto com RMS/pico
 * e os níveis por canal. Nada é gravado: os blocos servem só à análise em memória.
 *
 * Arquitetura simples e confiável primeiro (ver docs/performance.md): o detector roda
 * fora do worklet. O custo de transferência é medido antes de qualquer otimização.
 */

export {}; // trata o arquivo como módulo para que os `declare` abaixo fiquem locais

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor & {
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  },
): void;

type Mode = 'sum' | 'ch1' | 'ch2';

/** Duração alvo de cada bloco enviado. 10 ms = 100 mensagens/s. */
const BLOCK_SECONDS = 0.01;

class CaptureProcessor extends AudioWorkletProcessor {
  private mode: Mode = 'sum';
  private readonly blockSize = Math.max(128, Math.round(sampleRate * BLOCK_SECONDS));
  private buffer = new Float32Array(this.blockSize);
  private filled = 0;
  private emitted = 0;
  private sumSq = 0;
  private peak = 0;
  private chSumSq = [0, 0];
  private chPeak = [0, 0];
  /** Canais realmente recebidos (1 ou 2). Com entrada mono não existe "canal 2". */
  private channelsSeen = 1;

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent<{ type: string; mode?: Mode }>) => {
      if (ev.data.type === 'mode' && ev.data.mode) this.mode = ev.data.mode;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const ch0 = input?.[0];
    if (!input || !ch0) return true;
    const ch1 = input.length > 1 ? input[1] : undefined;
    if (ch1) this.channelsSeen = 2;
    const frames = ch0.length;
    const mode = this.mode;

    for (let i = 0; i < frames; i++) {
      const a = ch0[i] ?? 0;
      const b = ch1 ? (ch1[i] ?? 0) : 0;
      this.chSumSq[0]! += a * a;
      this.chSumSq[1]! += b * b;
      const aa = a < 0 ? -a : a;
      const bb = b < 0 ? -b : b;
      if (aa > this.chPeak[0]!) this.chPeak[0] = aa;
      if (bb > this.chPeak[1]!) this.chPeak[1] = bb;

      // 'sum' é a média dos canais (não a soma crua) para não ultrapassar o fundo de escala.
      // Com entrada mono, qualquer modo usa o único canal disponível.
      const v = !ch1 ? a : mode === 'ch1' ? a : mode === 'ch2' ? b : (a + b) * 0.5;
      this.buffer[this.filled++] = v;
      this.sumSq += v * v;
      const av = v < 0 ? -v : v;
      if (av > this.peak) this.peak = av;

      if (this.filled >= this.blockSize) this.flush();
    }
    return true;
  }

  private flush(): void {
    const n = this.filled;
    this.emitted += n;
    const samples = this.buffer;
    const channels = [{ rms: Math.sqrt(this.chSumSq[0]! / n), peak: this.chPeak[0]! }];
    if (this.channelsSeen > 1) {
      channels.push({ rms: Math.sqrt(this.chSumSq[1]! / n), peak: this.chPeak[1]! });
    }
    this.port.postMessage(
      {
        type: 'block',
        samples,
        endSample: this.emitted,
        frameTime: currentTime,
        rms: Math.sqrt(this.sumSq / n),
        peak: this.peak,
        channels,
      },
      [samples.buffer],
    );
    this.buffer = new Float32Array(this.blockSize);
    this.filled = 0;
    this.sumSq = 0;
    this.peak = 0;
    this.chSumSq = [0, 0];
    this.chPeak = [0, 0];
  }
}

registerProcessor('capture-processor', CaptureProcessor);
