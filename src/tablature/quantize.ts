import type { DurationBucket } from '../types/tablature';

/**
 * Quantização GROSSA de durações. Sem andamento nem compasso conhecidos, não há como afirmar
 * "colcheia" ou "semínima": só faixas de tempo absoluto. Os limites são escolhas de legibilidade,
 * não medidas musicais:
 *
 * - xs: < 0,15 s   (notas muito curtas, palm mute, ataques rápidos)
 * - s:  < 0,30 s
 * - m:  < 0,60 s
 * - l:  < 1,20 s
 * - xl: >= 1,20 s  (notas sustentadas)
 *
 * Efeito: servem apenas para o espaçamento horizontal e para a legenda de duração.
 */
export const BUCKET_LIMITS_S: readonly [number, number, number, number] = [0.15, 0.3, 0.6, 1.2];

export const BUCKET_ORDER: readonly DurationBucket[] = ['xs', 's', 'm', 'l', 'xl'];

export function quantizeDuration(seconds: number): DurationBucket {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const i = BUCKET_LIMITS_S.findIndex((limit) => s < limit);
  return BUCKET_ORDER[i === -1 ? 4 : i]!;
}

export const BUCKET_LABEL: Record<DurationBucket, string> = {
  xs: 'muito curta',
  s: 'curta',
  m: 'média',
  l: 'longa',
  xl: 'muito longa',
};

export function bucketIndex(b: DurationBucket | null): number {
  return b === null ? 1 : BUCKET_ORDER.indexOf(b);
}
