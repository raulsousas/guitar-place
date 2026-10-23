/**
 * Medidor de latência de ida e volta por loopback (parte pura, testável sem placa de áudio).
 *
 * O que mede: o tempo entre o instante em que o app agenda um clique na saída e o instante em que esse clique volta pela
 * ENTRADA (cabo da saída da interface para a entrada dela). Os dois instantes são lidos no relógio do próprio AudioContext
 * (precisão de uma amostra), então o resultado inclui: buffer de saída do navegador, driver, conversor DA, cabo, conversor AD,
 * driver, buffer de entrada e o quantum de 128 amostras do worklet.
 * O que NÃO mede: a latência do detector de notas, nem o atraso dos efeitos do Estúdio (que fica fora deste caminho: o
 * clique vai direto ao destino de áudio). Vale só para o computador, navegador, driver, taxa e buffer usados na medida.
 */
export const LOOPBACK = {
  /** Quantidade de cliques. 10 dá uma mediana estável e mostra a variação; mais alonga a medida (cada um custa `spacingS`). */
  clicks: 10,
  /**
   * Intervalo médio entre cliques (s). Maior que a janela de busca mais o maior recuo do atraso irregular (ver clickOffsets),
   * para um clique nunca ser confundido com o seguinte.
   */
  spacingS: 0.6,
  /**
   * Atrasos extras (s) somados ao intervalo de cada clique, em ordem fixa e IRREGULAR. Motivo: um som que já existe na entrada e é
   * periódico (guitarra soando, zumbido, o dispositivo falso do Chromium) casaria com cliques igualmente espaçados e daria uma
   * latência constante falsa. Com intervalos irregulares, só o que realmente vem dos cliques mantém um atraso constante; o resto
   * varia de clique a clique e a medida falha como instável. Intervalo mínimo entre cliques: 0,6 - 0,154 = 0,446 s.
   */
  jitterS: [0, 0.137, 0.043, 0.211, 0.089, 0.173, 0.019, 0.241, 0.113, 0.067] as readonly number[],
  /** Tempo ouvindo a entrada sem clique, para medir o ruído de fundo e fixar o limiar (s). */
  ambientS: 0.6,
  /** Frequência do clique (Hz) e duração (ms). 8 ciclos de 2 kHz: início abrupto (boa marcação de tempo) e energia suficiente. */
  burstHz: 2000,
  burstMs: 4,
  /** Amplitude do clique (linear, 0,2 = -14 dBFS de pico). Curto e baixo; o volume do fone ainda deve estar baixo. */
  amplitude: 0.2,
  /** Limiar de detecção = max(piso, fator x pico do ruído de fundo). Piso 0,02 (-34 dBFS); fator 6 (+15,6 dB sobre o ruído). */
  thresholdFloor: 0.02,
  thresholdFactor: 6,
  thresholdCeiling: 0.5,
  /** Janela (s) depois de cada clique em que uma detecção conta como a volta dele. Acima disso a latência seria irreal para áudio. */
  windowS: 0.4,
  /** Depois de uma detecção, o worklet ignora a entrada por este tempo (s): evita contar o mesmo clique várias vezes. */
  holdoffS: 0.05,
  /** Mínimo de cliques que precisam voltar para o resultado valer. */
  minMatched: 7,
  /** Variação máxima (máx - mín, ms) aceita entre cliques. Acima disso a medida é descartada como instável. */
  maxSpreadMs: 15,
  /** Mediana abaixo disto (ms) é fisicamente implausível (conversores + buffers): provável vazamento sem passar pelo cabo. */
  minPlausibleMs: 2,
} as const;

export interface LoopbackHit {
  /** Instante (relógio do AudioContext, s) da primeira amostra acima do limiar. */
  time: number;
  peak: number;
}

export type LoopbackFailure = 'no-signal' | 'noisy' | 'too-few' | 'too-fast' | 'unstable';

export type LoopbackResult =
  | { ok: true; matched: number; total: number; minMs: number; medianMs: number; maxMs: number; extraneous: number }
  | {
      ok: false;
      reason: LoopbackFailure;
      matched: number;
      total: number;
      latenciesMs: number[];
      /** Diagnóstico (só preenchido pelo executor real): maior pico da entrada durante os cliques e limiar usado, em dBFS. */
      peakDb?: number;
      thresholdDb?: number;
    };

export type LoopbackOutcome = LoopbackResult | { ok: false; reason: 'unavailable' | 'output-on' | 'worklet-failed' };

/** Instantes dos cliques (s) a partir de t0, com intervalos irregulares (ver LOOPBACK.jitterS). */
export function clickOffsets(count: number = LOOPBACK.clicks): number[] {
  const j = LOOPBACK.jitterS;
  return Array.from({ length: count }, (_, k) => k * LOOPBACK.spacingS + j[k % j.length]!);
}

/** Um clique: rajada senoidal curta com início abrupto e queda linear nos últimos 0,5 ms (sem estalo no fim). */
export function clickBuffer(sampleRate: number): Float32Array<ArrayBuffer> {
  const n = Math.max(8, Math.round((LOOPBACK.burstMs / 1000) * sampleRate));
  const fade = Math.max(1, Math.round(0.0005 * sampleRate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tail = Math.min(1, (n - i) / fade);
    out[i] = LOOPBACK.amplitude * tail * Math.sin((2 * Math.PI * LOOPBACK.burstHz * i) / sampleRate);
  }
  return out;
}

/** Limiar de detecção a partir do pico do ruído de fundo medido sem clique. Entradas inválidas caem no piso. */
export function thresholdFromAmbient(ambientPeak: number): number {
  const L = LOOPBACK;
  const raw = Number.isFinite(ambientPeak) ? L.thresholdFactor * Math.max(0, ambientPeak) : L.thresholdFloor;
  return Math.min(L.thresholdCeiling, Math.max(L.thresholdFloor, raw));
}

const median = (sorted: number[]): number => {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
};

/**
 * Casa cada clique com a primeira detecção dentro da janela depois dele. Detecções que não casam com nenhum clique
 * (ruído, guitarra tocando, ou latência maior que a janela) contam como "extras".
 */
export function analyzeHits(clickTimes: readonly number[], hits: readonly LoopbackHit[]): LoopbackResult {
  const L = LOOPBACK;
  const total = clickTimes.length;
  const used = new Set<number>();
  const latenciesMs: number[] = [];
  for (const t of clickTimes) {
    const idx = hits.findIndex((h, i) => !used.has(i) && h.time >= t && h.time < t + L.windowS);
    if (idx >= 0) {
      used.add(idx);
      latenciesMs.push((hits[idx]!.time - t) * 1000);
    }
  }
  const matched = latenciesMs.length;
  const extraneous = hits.length - used.size;
  const fail = (reason: LoopbackFailure): LoopbackResult => ({ ok: false, reason, matched, total, latenciesMs });

  if (hits.length === 0) return fail('no-signal');
  if (matched === 0) return fail('noisy');
  if (matched < L.minMatched) return fail('too-few');
  if (extraneous > matched) return fail('noisy');
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const med = median(sorted);
  if (med < L.minPlausibleMs) return fail('too-fast');
  if (sorted[sorted.length - 1]! - sorted[0]! > L.maxSpreadMs) return fail('unstable');
  return { ok: true, matched, total, minMs: sorted[0]!, medianMs: med, maxMs: sorted[sorted.length - 1]!, extraneous };
}
