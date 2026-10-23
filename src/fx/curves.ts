/**
 * FunÃ§Ãµes puras do EstÃºdio (testÃ¡veis sem Ã¡udio).
 *
 * SaturaÃ§Ã£o: y = (tanh(k*x + b) - tanh(b)) / N, com N escolhido para que |y(+-1)| <= 1 e y(0) = 0.
 * - k (dureza): maior => joelho mais fechado e mais harmÃ´nicos. O ganho "drive" nÃ£o estÃ¡ aqui: ele Ã© um
 *   GainNode ANTES do WaveShaper, que empurra o sinal para a regiÃ£o saturada.
 * - b (assimetria): desloca o ponto de operaÃ§Ã£o e gera harmÃ´nicos pares (som de vÃ¡lvula). 0 = simÃ©trica.
 * O WaveShaper prende entradas fora de [-1, 1] nas extremidades, entÃ£o a curva Ã© contÃ­nua e limitada.
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
 * Limitador final (sem memÃ³ria, sem ganho de compensaÃ§Ã£o): linear atÃ© `knee` e, acima, uma curva tanh
 * que tende a `limit` e nunca o ultrapassa. Entradas fora de [-1, 1] sÃ£o presas pelo WaveShaper.
 * Efeito: picos acima de ~0,6 sÃ£o arredondados (leve saturaÃ§Ã£o) em vez de cortados; abaixo disso o sinal
 * passa intacto. NÃ£o Ã© um compressor: nÃ£o hÃ¡ pumping nem atraso.
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

/** Ganho (linear) antes da saturaÃ§Ã£o do pedal: 0 -> 1x, 1 -> 30 dB. */
export const driveToGain = (drive: number): number => dbToGain(30 * clamp(drive, 0, 1));

/** Corte do tone do pedal: 1,5 kHz (0) a 9 kHz (1), escala exponencial. */
export const driveToneHz = (tone: number): number => 1500 * (9000 / 1500) ** clamp(tone, 0, 1);

/** Volume pÃ³s-saturaÃ§Ã£o do pedal: 0 -> -inf... usa 0..+6 dB com 0,5 = 0 dB. */
export const driveLevelGain = (level: number): number => dbToGain(-12 + 18 * clamp(level, 0, 1));

/** ParÃ¢metros por voz do amplificador: ganho de entrada (dB), dureza e assimetria da curva. */
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

/** RealimentaÃ§Ã£o do delay: limitada para o eco sempre decair. */
export const MAX_FEEDBACK = 0.85;


/**
 * PortÃ£o de ruÃ­do (expansor descendente), para o chiado de ganhos altos.
 *
 * Por que existe: o drive e o amplificador de alto ganho multiplicam o ruÃ­do da interface e dos captadores junto com a nota.
 * Entre as notas sÃ³ sobra esse ruÃ­do, amplificado em dezenas de dB. O portÃ£o fecha o caminho quando a guitarra estÃ¡ quieta.
 *
 * Como funciona (sÃ³ nÃ³s nativos, sem AudioWorklet): a envoltÃ³ria do sinal (valor absoluto passado por um passa-baixas de
 * `GATE_ENV_HZ`) Ã© multiplicada por `gateScale(limiar)` e passa por `gateCurve()`, que dÃ¡ o ganho do portÃ£o (0..1) e controla
 * o ganho de um GainNode no caminho do Ã¡udio:
 * - envoltÃ³ria >= limiar: portÃ£o 100% aberto.
 * - envoltÃ³ria <= limiar - GATE_RANGE_DB: portÃ£o fechado (ganho 0).
 * - no meio: transiÃ§Ã£o suave (smoothstep), para o fim das notas nÃ£o ser cortado de repente.
 * Como a curva de um WaveShaper nÃ£o pode ser trocada, ela Ã© fixa e o limiar muda o ganho aplicado ANTES dela.
 * A envoltÃ³ria de um seno de pico A vale cerca de 0,64 A (mÃ©dia do valor absoluto), isto Ã©, ~4 dB abaixo do pico.
 */
export const GATE_OPEN_AT = 0.5;
export const GATE_RANGE_DB = 10;
/** Corte do passa-baixas da envoltÃ³ria (Hz). Efeito: constante de tempo de ~6 ms. Menor = menos ondulaÃ§Ã£o em notas graves, porÃ©m abre mais devagar. */
export const GATE_ENV_HZ = 25;
/** Atraso do Ã¡udio em relaÃ§Ã£o Ã  envoltÃ³ria (s), para o portÃ£o abrir antes do ataque da nota. Soma 5 ms de latÃªncia enquanto o portÃ£o estÃ¡ ligado. */
export const GATE_LOOKAHEAD_S = 0.005;
export const GATE_MIN_DB = -80;
export const GATE_MAX_DB = -30;

/** Curva do portÃ£o: entrada = envoltÃ³ria escalada (0..1), saÃ­da = ganho (0..1). */
export function gateCurve(size = 8193): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size);
  const lo = GATE_OPEN_AT * 10 ** (-GATE_RANGE_DB / 20);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1; // a envoltÃ³ria Ã© >= 0: sÃ³ a metade positiva importa
    if (x <= lo) curve[i] = 0;
    else if (x >= GATE_OPEN_AT) curve[i] = 1;
    else {
      const s = (x - lo) / (GATE_OPEN_AT - lo);
      curve[i] = s * s * (3 - 2 * s);
    }
  }
  return curve;
}

/** Valor absoluto como curva de WaveShaper (tamanho Ã­mpar: o ponto central Ã© exatamente 0). */
export function absCurve(size = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) curve[i] = Math.abs((i / (size - 1)) * 2 - 1);
  return curve;
}

/** Ganho aplicado Ã  envoltÃ³ria para que o limiar (dBFS da envoltÃ³ria) caia em GATE_OPEN_AT. */
export const gateScale = (thresholdDb: number): number => GATE_OPEN_AT / dbToGain(clamp(thresholdDb, GATE_MIN_DB, GATE_MAX_DB));

/**
 * Filtros do amplificador por voz (Hz). Contra o chiado e a "lixa":
 * - `hpHz` (passa-altas ANTES da saturaÃ§Ã£o): graves nÃ£o saturam em lama nem geram intermodulaÃ§Ã£o.
 * - `preLpHz` (passa-baixas ANTES da saturaÃ§Ã£o): tira o que a guitarra quase nÃ£o tem (chiado de interface acima de ~6 kHz),
 *   que a saturaÃ§Ã£o transformaria em fritura. Menor = mais limpo e mais escuro.
 * - `postLpHz` (dois passa-baixas em sÃ©rie DEPOIS, 24 dB/oitava): tira os harmÃ´nicos agudos da saturaÃ§Ã£o que soam como lixa.
 * Valores escolhidos Ã  mÃ£o, NÃƒO validados de ouvido (ver docs/studio.md).
 */
export const AMP_FILTERS = {
  clean: { hpHz: 80, preLpHz: 8000, postLpHz: 8000 },
  crunch: { hpHz: 100, preLpHz: 7000, postLpHz: 6800 },
  high: { hpHz: 120, preLpHz: 6000, postLpHz: 5800 },
} as const;
/** Pedal de drive: passa-baixas antes da saturaÃ§Ã£o (Hz). */
export const DRIVE_PRE_LP_HZ = 7000;
/** Passa-altas depois da saturaÃ§Ã£o do amplificador (Hz): remove o nÃ­vel DC que a curva assimÃ©trica cria. */
export const AMP_DC_HZ = 10;

/** Medida do ruÃ­do de fundo: quadros de RMS (dBFS) com as cordas abafadas -> limiar sugerido para o portÃ£o. */
export const NOISE_MEASURE = {
  /** Folga do limiar sobre a envoltÃ³ria do ruÃ­do (dB). O portÃ£o fecha 10 dB abaixo do limiar; 12 dB deixa o ruÃ­do 2 dB abaixo do ponto de fechamento. */
  marginDb: 12,
  /** Acima disto (dBFS RMS) o sinal Ã© alto demais para ser ruÃ­do de fundo. */
  maxNoiseDb: -35,
  /** DiferenÃ§a mÃ¡xima p95 - mediana (dB) para a medida ser considerada estÃ¡vel (sem nota tocada durante a medida). */
  maxSpreadDb: 6,
  /** Abaixo disto (dBFS RMS) nenhum sinal chegou. */
  noSignalDb: -90,
  /** MÃ­nimo de quadros para confiar na medida. */
  minFrames: 20,
} as const;

export type NoiseMeasure =
  | { ok: true; thresholdDb: number; noiseDb: number }
  | { ok: false; reason: 'no-signal' | 'too-loud' | 'unstable' | 'too-few' };

export function thresholdFromNoise(framesDb: readonly number[]): NoiseMeasure {
  const N = NOISE_MEASURE;
  if (framesDb.length < N.minFrames) return { ok: false, reason: 'too-few' };
  const sorted = framesDb.map((v) => (Number.isFinite(v) ? v : -200)).sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))]!;
  const p95 = at(0.95);
  if (p95 < N.noSignalDb) return { ok: false, reason: 'no-signal' };
  if (p95 > N.maxNoiseDb) return { ok: false, reason: 'too-loud' };
  if (p95 - at(0.5) > N.maxSpreadDb) return { ok: false, reason: 'unstable' };
  // EnvoltÃ³ria (mÃ©dia do valor absoluto) do ruÃ­do ~ RMS - 1 dB (-1,9 dB para ruÃ­do gaussiano; -0,9 dB para um zumbido senoidal).
  const noiseEnvDb = p95 - 1;
  return { ok: true, noiseDb: p95, thresholdDb: Math.round(clamp(noiseEnvDb + N.marginDb, GATE_MIN_DB, GATE_MAX_DB)) };
}
