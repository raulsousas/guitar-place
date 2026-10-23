/**
 * Funções puras do Estúdio (testáveis sem áudio).
 *
 * Saturação: y = (tanh(k*x + b) - tanh(b)) / N, com N escolhido para que |y(+-1)| <= 1 e y(0) = 0.
 * - k (dureza): maior => joelho mais fechado e mais harmônicos. O ganho "drive" não está aqui: ele é um
 *   GainNode ANTES do WaveShaper, que empurra o sinal para a região saturada.
 * - b (assimetria): desloca o ponto de operação e gera harmônicos pares (som de válvula). 0 = simétrica.
 * O WaveShaper prende entradas fora de [-1, 1] nas extremidades, então a curva é contínua e limitada.
 */
export function saturationCurve(hardness: number, asymmetry = 0, size = 4096): Float32Array<ArrayBuffer> {
  const k = Math.max(0.1, hardness);
  const b = asymmetry;
  const norm = Math.max(Math.abs(Math.tanh(k + b) - Math.tanh(b)), Math.abs(Math.tanh(-k + b) - Math.tanh(b)));
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = (Math.tanh(k * x + b) - Math.tanh(b)) / norm;
  }
  return curve;
}

/**
 * Limitador final (sem memória, sem ganho de compensação): linear até `knee` e, acima, uma curva tanh
 * que tende a `limit` e nunca o ultrapassa. Entradas fora de [-1, 1] são presas pelo WaveShaper.
 * Efeito: picos acima de ~0,6 são arredondados (leve saturação) em vez de cortados; abaixo disso o sinal
 * passa intacto. Não é um compressor: não há pumping nem atraso.
 */
export function softLimitCurve(limit = 0.98, knee = 0.6, size = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size);
  const room = limit - knee;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    curve[i] = Math.sign(x) * Math.min(y, limit);
  }
  return curve;
}

export const dbToGain = (db: number): number => 10 ** (db / 20);

export const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** Ganho (linear) antes da saturação do pedal: 0 -> 1x, 1 -> 30 dB. */
export const driveToGain = (drive: number): number => dbToGain(30 * clamp(drive, 0, 1));

/** Corte do tone do pedal: 1,5 kHz (0) a 9 kHz (1), escala exponencial. */
export const driveToneHz = (tone: number): number => 1500 * (9000 / 1500) ** clamp(tone, 0, 1);

/** Volume pós-saturação do pedal: 0 -> -inf... usa 0..+6 dB com 0,5 = 0 dB. */
export const driveLevelGain = (level: number): number => dbToGain(-12 + 18 * clamp(level, 0, 1));

/** Parâmetros por voz do amplificador: ganho de entrada (dB), dureza e assimetria da curva. */
export const AMP_VOICINGS = {
  clean: { minDb: 0, maxDb: 12, hardness: 1.6, asymmetry: 0 },
  crunch: { minDb: 6, maxDb: 24, hardness: 3, asymmetry: 0.15 },
  high: { minDb: 14, maxDb: 36, hardness: 5, asymmetry: 0.25 },
} as const;

export function ampPreGain(voicing: keyof typeof AMP_VOICINGS, gain: number): number {
  const v = AMP_VOICINGS[voicing];
  return dbToGain(v.minDb + (v.maxDb - v.minDb) * clamp(gain, 0, 1));
}

/** Controles de tom do amplificador (0..1, 0,5 = neutro) para dB (-12..+12). */
export const toneToDb = (v: number): number => (clamp(v, 0, 1) - 0.5) * 24;

/** Volume do amplificador: 0..1 -> -30..0 dB (0 = mudo). */
export const ampLevelGain = (level: number): number => (level <= 0 ? 0 : dbToGain(-30 + 30 * clamp(level, 0, 1)));

/** Realimentação do delay: limitada para o eco sempre decair. */
export const MAX_FEEDBACK = 0.85;