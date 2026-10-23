import { fft } from './fft';

/**
 * Análise de um trecho de música para o ajuste automático do Estúdio.
 *
 * O QUE ISTO É: medidas simples do espectro e da dinâmica de um trecho de áudio (mono), feitas no navegador.
 * O QUE ISTO NÃO É: não separa a guitarra do resto da música (baixo, bateria, voz entram na medida), não
 * identifica equipamentos e não "ouve" timbre. Os limiares que ligam as medidas aos ajustes (auto-config.ts)
 * NÃO foram calibrados com gravações reais; foram escolhidos de forma aproximada e estão documentados em
 * docs/studio.md. Só a ORDEM das medidas (mais saturado -> índice maior etc.) é verificada com sinais sintéticos.
 */
export const ANALYSIS_PARAMS = {
  /** Tamanho da janela da FFT. 2048 amostras = ~46 ms a 44,1 kHz (resolução ~21 Hz): separa as bandas usadas. */
  fftSize: 2048,
  /** Passo do envelope de volume (amostras): 512 = ~11,6 ms a 44,1 kHz. Resolução do tempo de queda. */
  envHop: 512,
  /** Duração mínima analisável (s). Menos que isso não tem notas suficientes para medir. */
  minDurationS: 5,
  /** Abaixo disto (dBFS RMS) o quadro é considerado silêncio. */
  silenceDb: -50,
  /** Quadros mais de 30 dB abaixo do quadro mais forte (percentil 95) ficam de fora da medida do espectro. */
  relativeDb: -30,
  /** Fração mínima de quadros ativos; abaixo disso o trecho é quase todo silêncio. */
  minActiveFraction: 0.1,
  /** Faixa do centróide espectral (Hz). */
  centroidLowHz: 80,
  centroidHighHz: 8000,
  /** Bandas: graves 80-250 Hz, médios 250-2000 Hz, presença 2000-5000 Hz. */
  lowBand: [80, 250] as const,
  midBand: [250, 2000] as const,
  highBand: [2000, 5000] as const,
  /** Queda de 10 dB após um pico do envelope: janela máxima de busca (s). */
  maxFallS: 1.5,
  /** Picos válidos mínimos para a medida de queda ser considerada. */
  minValidPeaks: 8,
} as const;

export interface MusicAnalysis {
  ok: true;
  durationS: number;
  /** Fração de quadros acima do silêncio. */
  activeFraction: number;
  /** 10*log10(energia 80-250 Hz / energia 250-2000 Hz). */
  lowMidDb: number;
  /** 10*log10(energia 2-5 kHz / energia 250-2000 Hz): proxy da densidade de harmônicos (saturação). */
  highMidDb: number;
  /** Centróide espectral entre 80 Hz e 8 kHz: "brilho". */
  centroidHz: number;
  /** p95 - p50 do envelope de volume (dB) nos quadros ativos: pequeno = som comprimido/saturado e sustentado. */
  loudnessSpreadDb: number;
  /** Mediana do tempo (s) para o envelope cair 10 dB depois de um pico; null com poucos picos válidos. */
  tFall10S: number | null;
  validPeaks: number;
}

export type AnalysisFailure = { ok: false; reason: 'too-short' | 'mostly-silent' | 'invalid' };
export type AnalysisResult = MusicAnalysis | AnalysisFailure;

const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12));

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx]!;
}

/** Envelope RMS em dB a cada `hop` amostras. */
function envelopeDb(x: Float32Array, hop: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k++) s += x[k]! * x[k]!;
    out.push(db(Math.sqrt(s / hop)));
  }
  return out;
}

function fallTimes(env: number[], sampleRate: number): { median: number | null; count: number } {
  const { envHop, silenceDb, maxFallS } = ANALYSIS_PARAMS;
  const active = env.filter((v) => v > silenceDb).sort((a, b) => a - b);
  if (active.length === 0) return { median: null, count: 0 };
  const thr = percentile(active, 0.75);
  const radius = 8;
  const maxHops = Math.round((maxFallS * sampleRate) / envHop);
  const times: number[] = [];
  for (let i = radius; i < env.length - radius; i++) {
    const v = env[i]!;
    if (v < thr) continue;
    let isPeak = true;
    for (let k = i - radius; k <= i + radius; k++) {
      if (env[k]! > v || (env[k]! === v && k < i)) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) continue;
    let runMin = v;
    let result: number | null = null;
    let reonset = false;
    const end = Math.min(env.length - 1, i + maxHops);
    for (let j = i + 1; j <= end; j++) {
      const w = env[j]!;
      if (w < runMin) runMin = w;
      if (w > runMin + 4) {
        reonset = true; // outro ataque antes de cair 10 dB: não mede a queda
        break;
      }
      if (w <= v - 10) {
        result = ((j - i) * envHop) / sampleRate;
        break;
      }
    }
    if (reonset) continue;
    // Sem queda de 10 dB dentro da janela e sem novo ataque: sustentado, vale o teto (medida censurada).
    times.push(result ?? maxFallS);
  }
  if (times.length === 0) return { median: null, count: 0 };
  times.sort((a, b) => a - b);
  return { median: percentile(times, 0.5), count: times.length };
}

/** Analisa um trecho mono. `samples` em [-1, 1]. */
export function analyzeMusic(samples: Float32Array, sampleRate: number): AnalysisResult {
  const P = ANALYSIS_PARAMS;
  if (!(sampleRate > 8000) || samples.length === 0 || !samples.every(Number.isFinite)) return { ok: false, reason: 'invalid' };
  const durationS = samples.length / sampleRate;
  if (durationS < P.minDurationS) return { ok: false, reason: 'too-short' };

  const N = P.fftSize;
  const frames = Math.floor(samples.length / N);
  const frameDb: number[] = [];
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let k = f * N; k < (f + 1) * N; k++) s += samples[k]! * samples[k]!;
    frameDb.push(db(Math.sqrt(s / N)));
  }
  const sortedFrames = [...frameDb].sort((a, b) => a - b);
  const loud = percentile(sortedFrames, 0.95);
  const threshold = Math.max(P.silenceDb, loud + P.relativeDb);
  const activeIdx = frameDb.map((v, i) => (v > threshold ? i : -1)).filter((i) => i >= 0);
  const activeFraction = frames > 0 ? activeIdx.length / frames : 0;
  if (activeFraction < P.minActiveFraction || loud <= P.silenceDb) return { ok: false, reason: 'mostly-silent' };

  const window = new Float32Array(N);
  for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const binHz = sampleRate / N;
  const bin = (hz: number) => Math.max(1, Math.round(hz / binHz));
  let eLow = 0;
  let eMid = 0;
  let eHigh = 0;
  let cNum = 0;
  let cDen = 0;
  const cLo = bin(P.centroidLowHz);
  const cHi = Math.min(N / 2 - 1, bin(P.centroidHighHz));
  const [l0, l1] = [bin(P.lowBand[0]), bin(P.lowBand[1])];
  const [m0, m1] = [bin(P.midBand[0]), bin(P.midBand[1])];
  const [h0, h1] = [bin(P.highBand[0]), Math.min(N / 2 - 1, bin(P.highBand[1]))];
  for (const f of activeIdx) {
    for (let i = 0; i < N; i++) {
      re[i] = samples[f * N + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      if (k >= l0 && k < l1) eLow += p;
      else if (k >= m0 && k < m1) eMid += p;
      else if (k >= h0 && k < h1) eHigh += p;
      if (k >= cLo && k <= cHi) {
        cNum += k * binHz * p;
        cDen += p;
      }
    }
  }
  const ratioDb = (a: number, b: number) => 10 * Math.log10(Math.max(a, 1e-20) / Math.max(b, 1e-20));

  const env = envelopeDb(samples, P.envHop);
  const activeEnv = env.filter((v) => v > threshold).sort((a, b) => a - b);
  const loudnessSpreadDb = activeEnv.length > 0 ? percentile(activeEnv, 0.95) - percentile(activeEnv, 0.5) : 0;
  const fall = fallTimes(env, sampleRate);

  return {
    ok: true,
    durationS,
    activeFraction,
    lowMidDb: ratioDb(eLow, eMid),
    highMidDb: ratioDb(eHigh, eMid),
    centroidHz: cDen > 0 ? cNum / cDen : 0,
    loudnessSpreadDb,
    tFall10S: fall.count >= P.minValidPeaks ? fall.median : null,
    validPeaks: fall.count,
  };
}
