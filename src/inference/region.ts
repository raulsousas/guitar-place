import type { FretPosition } from '../music/fretmap';
import type { FretRegion } from '../types/position';

/** Ajusta a região ao número de casas atual (mantém 1 <= min <= max <= fretCount). */
export function normalizeRegion(region: FretRegion | null, fretCount: number): FretRegion | null {
  if (!region) return null;
  const maxFret = Math.max(1, Math.min(Math.round(region.maxFret), fretCount));
  const minFret = Math.max(1, Math.min(Math.round(region.minFret), maxFret));
  return { minFret, maxFret, includeOpen: region.includeOpen };
}

export function sameRegion(a: FretRegion | null | undefined, b: FretRegion | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.minFret === b.minFret && a.maxFret === b.maxFret && a.includeOpen === b.includeOpen;
}

/** A posição está dentro da região declarada pelo usuário? */
export function inRegion(p: Pick<FretPosition, 'fret'>, r: FretRegion): boolean {
  return p.fret === 0 ? r.includeOpen : p.fret >= r.minFret && p.fret <= r.maxFret;
}