import type { FretPosition } from '../music/fretmap';
import type { ExternalEvidence, HistoryEntry } from '../types/position';
import type { InferenceConfig } from './config';
export type WeightedContext = { entry: HistoryEntry; w: number }[];

/** Entradas de contexto mais recentes primeiro, com o peso final (peso da nota x decaimento). */
export function contextWeights(history: readonly HistoryEntry[], cfg: InferenceConfig): WeightedContext {
  return history.slice(0, cfg.contextWindow).map((h, i) => ({
    entry: h,
    w: h.weight * Math.pow(cfg.contextDecay, i),
  }));
}

export function regionScore(p: FretPosition, fretCount: number, cfg: InferenceConfig): number {
  return Math.max(0, 1 - (cfg.regionSlope * p.fret) / fretCount);
}

/**
 * Posição estimada da mão (casa média ponderada das notas recentes pressionadas).
 * Cordas soltas não dizem nada sobre onde a mão está.
 */
export function handCenter(ctx: WeightedContext): number | null {
  let sum = 0;
  let wsum = 0;
  for (const { entry, w } of ctx) {
    if (entry.fret > 0) {
      sum += w * entry.fret;
      wsum += w;
    }
  }
  return wsum > 0 ? sum / wsum : null;
}

export function handShiftScore(p: FretPosition, center: number | null, dt: number, cfg: InferenceConfig): number | null {
  if (center === null) return null;
  if (p.fret === 0) return cfg.openStringHandScore;
  const allowance = cfg.shiftBaseFrets + cfg.shiftFretsPerSecond * Math.max(0, dt);
  const d = Math.abs(p.fret - center);
  return 1 / (1 + (d / allowance) ** 2);
}

export function stringCohesionScore(p: FretPosition, ctx: WeightedContext, cfg: InferenceConfig): number | null {
  if (ctx.length === 0) return null;
  let sum = 0;
  let wsum = 0;
  for (const { entry, w } of ctx) {
    sum += w * Math.exp(-Math.abs(p.stringIndex - entry.stringIndex) / cfg.stringScale);
    wsum += w;
  }
  return wsum > 0 ? sum / wsum : null;
}

export function externalScore(p: FretPosition, evidence: readonly ExternalEvidence[] | undefined): number | null {
  if (!evidence || evidence.length === 0) return null;
  let best = 0;
  for (const e of evidence) {
    if (e.stringIndex === p.stringIndex && e.fret === p.fret) best = Math.max(best, e.support);
  }
  return best;
}
