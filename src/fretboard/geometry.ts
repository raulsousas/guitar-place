/**
 * Geometria do braço (funções puras, sem React).
 *
 * Em temperamento igual, a distância do capotraste até o traste n é
 * L · (1 − 2^(−n/12)), onde L é o comprimento da escala. Normalizamos para que
 * o traste `fretCount` ocupe toda a largura disponível do braço.
 */

/** Posição normalizada (0..1) do traste n sobre o comprimento total até o último traste. */
export function normalizedFretPositions(fretCount: number): number[] {
  const total = 1 - Math.pow(2, -fretCount / 12);
  return Array.from({ length: fretCount + 1 }, (_, n) => (1 - Math.pow(2, -n / 12)) / total);
}

/** Centro (0..1) de cada casa n = 1..fretCount, entre os trastes n−1 e n. */
export function normalizedFretCenters(fretCount: number): number[] {
  const p = normalizedFretPositions(fretCount);
  return Array.from({ length: fretCount }, (_, i) => ((p[i] ?? 0) + (p[i + 1] ?? 0)) / 2);
}

/** Casas que recebem marcação de referência e se a marcação é dupla (12 e 24). */
export function inlayFrets(fretCount: number): { fret: number; double: boolean }[] {
  const singles = [3, 5, 7, 9, 15, 17, 19, 21];
  const doubles = [12, 24];
  return [...singles.map((fret) => ({ fret, double: false })), ...doubles.map((fret) => ({ fret, double: true }))]
    .filter((m) => m.fret <= fretCount)
    .sort((a, b) => a.fret - b.fret);
}
