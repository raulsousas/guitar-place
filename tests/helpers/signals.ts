import { createEngineConfig } from '../../src/dsp/defaults';
import { PitchEngine } from '../../src/dsp/pitch-engine';
import type { EngineConfig, EngineOutput, NoteEvent, PitchFrame } from '../../src/types/engine';

export const SAMPLE_RATE = 48000;

/** Gerador pseudoaleatório determinístico (mulberry32) para testes reprodutíveis. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export interface NoteSpec {
  frequency: number;
  /** Início (s). */
  start: number;
  /** Duração (s) até o fim do corte. */
  duration: number;
  /** Amplitude de pico da fundamental (0..1). */
  amplitude?: number;
  /** Amplitudes relativas dos harmônicos 1, 2, 3... */
  harmonics?: number[];
  /** Constante de tempo do decaimento exponencial (s). Infinity = sustentado. */
  decay?: number;
  attack?: number;
  vibratoCents?: number;
  vibratoHz?: number;
}

/** Perfil de harmônicos de uma corda de guitarra, com a fundamental dominante. */
export const GUITAR_HARMONICS = [1, 0.55, 0.35, 0.22, 0.14, 0.08];
/** Fundamental fraca: o segundo e o terceiro harmônicos dominam (caso clássico de erro de oitava). */
export const WEAK_FUNDAMENTAL = [0.25, 1, 0.8, 0.4, 0.2];
/** Soma saturada: acrescenta harmônicos fortes, aproximando uma guitarra distorcida. */
export const DISTORTED_HARMONICS = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];

export function synthesize(notes: NoteSpec[], seconds: number, sampleRate = SAMPLE_RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (const n of notes) {
    const harmonics = n.harmonics ?? GUITAR_HARMONICS;
    const amp = n.amplitude ?? 0.5;
    const decay = n.decay ?? 1.5;
    const attack = n.attack ?? 0.004;
    const i0 = Math.max(0, Math.round(n.start * sampleRate));
    const i1 = Math.min(out.length, Math.round((n.start + n.duration) * sampleRate));
    const fadeOut = Math.round(0.01 * sampleRate);
    let phase = 0;
    const norm = Math.max(...harmonics);
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / sampleRate;
      let f = n.frequency;
      if (n.vibratoCents) {
        f *= Math.pow(2, ((n.vibratoCents / 1200) * Math.sin(2 * Math.PI * (n.vibratoHz ?? 5.5) * t)));
      }
      phase += (2 * Math.PI * f) / sampleRate;
      let env = Math.min(1, t / attack) * (Number.isFinite(decay) ? Math.exp(-t / decay) : 1);
      const toEnd = i1 - i;
      if (toEnd < fadeOut) env *= toEnd / fadeOut;
      let s = 0;
      for (let h = 0; h < harmonics.length; h++) {
        if (f * (h + 1) < sampleRate / 2) s += harmonics[h]! * Math.sin(phase * (h + 1));
      }
      out[i] = (out[i] ?? 0) + (amp * env * s) / norm;
    }
  }
  return out;
}

/** Adiciona ruído branco gaussiano com a relação sinal/ruído pedida (dB), sobre a potência do sinal. */
export function addNoiseSnr(signal: Float32Array, snrDb: number, seed = 1): Float32Array {
  const rand = rng(seed);
  let sum = 0;
  let count = 0;
  for (const v of signal) {
    if (v !== 0) {
      sum += v * v;
      count++;
    }
  }
  const power = count ? sum / count : 0;
  const sigma = Math.sqrt(power / Math.pow(10, snrDb / 10));
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i]! + sigma * gaussian(rand);
  return out;
}

/** Ruído branco de nível fixo (RMS em dBFS), útil para silêncio com ruído de fundo. */
export function noiseFloor(seconds: number, rmsDb: number, seed = 7, sampleRate = SAMPLE_RATE): Float32Array {
  const rand = rng(seed);
  const sigma = Math.pow(10, rmsDb / 20);
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = sigma * gaussian(rand);
  return out;
}

export function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

export interface RunResult {
  engine: PitchEngine;
  outputs: EngineOutput[];
  frames: PitchFrame[];
  events: NoteEvent[];
  onsets: NoteEvent[];
}

/** Alimenta o motor em blocos de 10 ms, como o worklet, e junta os resultados. */
export function runEngine(
  signal: Float32Array,
  overrides: Partial<EngineConfig> = {},
  sampleRate = SAMPLE_RATE,
): RunResult {
  const engine = new PitchEngine(createEngineConfig({ sampleRate, ...overrides }));
  const block = Math.round(sampleRate * 0.01);
  const outputs: EngineOutput[] = [];
  for (let i = 0; i < signal.length; i += block) {
    outputs.push(...engine.process(signal.slice(i, Math.min(signal.length, i + block))));
  }
  const events = outputs.flatMap((o) => o.events);
  return {
    engine,
    outputs,
    frames: outputs.map((o) => o.frame),
    events,
    onsets: events.filter((e) => e.type === 'onset' || e.type === 'change'),
  };
}

export function centsBetween(a: number, b: number): number {
  return 1200 * Math.log2(a / b);
}
