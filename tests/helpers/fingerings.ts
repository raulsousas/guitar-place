import { getPositionsForMidi } from '../../src/music/fretmap';
import { STANDARD_TUNING } from '../../src/music/tuning';

/**
 * Digitações com posição VERDADEIRA conhecida POR CONSTRUÇÃO (escritas à mão a partir de padrões
 * usuais de guitarra). NÃO são gravações de guitarra real: medem se o algoritmo recupera uma
 * digitação plausível, não se funciona no instrumento. Duas listas separadas: AJUSTE (usada para
 * escolher parâmetros) e VALIDAÇÃO (nunca olhada durante o ajuste), para não superestimar o resultado.
 */
export interface Fingering {
  name: string;
  /** [númeroDaCorda 1..6, casa] na ordem em que são tocadas. */
  truth: [number, number][];
  /** Intervalo entre ataques (s). */
  dt: number;
}

export const TUNING_SET: Fingering[] = [
  { name: 'Dó maior, posição aberta', dt: 0.45, truth: [[5, 3], [4, 0], [4, 2], [4, 3], [3, 0], [3, 2], [2, 0], [2, 1]] },
  {
    name: 'Lá menor pentatônica, caixa 1 (casas 5-8)',
    dt: 0.35,
    truth: [[6, 5], [6, 8], [5, 5], [5, 7], [4, 5], [4, 7], [3, 5], [3, 7], [2, 5], [2, 8], [1, 5], [1, 8]],
  },
  { name: 'Escala na 1ª corda, casas 12-24', dt: 0.4, truth: [[1, 12], [1, 14], [1, 15], [1, 17], [1, 19], [1, 20], [1, 22], [1, 24]] },
];

export const VALIDATION_SET: Fingering[] = [
  {
    name: 'Mi menor pentatônica, posição aberta',
    dt: 0.35,
    truth: [[6, 0], [6, 3], [5, 0], [5, 2], [4, 0], [4, 2], [3, 0], [3, 2], [2, 0], [2, 3], [1, 0], [1, 3]],
  },
  { name: 'Sol maior, posição aberta', dt: 0.45, truth: [[6, 3], [5, 0], [5, 2], [5, 3], [4, 0], [4, 2], [4, 4], [3, 0]] },
  { name: 'Arpejo cruzando cordas na casa 7', dt: 0.5, truth: [[5, 7], [4, 7], [3, 7], [2, 8], [1, 7]] },
  { name: 'Riff grave na 6ª corda', dt: 0.3, truth: [[6, 0], [6, 3], [6, 5], [6, 3], [6, 0], [5, 2]] },
  { name: 'Frase com salto de posição (casa 3 para casa 12)', dt: 0.6, truth: [[2, 3], [2, 5], [1, 3], [1, 12], [1, 14], [1, 15]] },
];

/** Converte a digitação verdadeira em notas MIDI (a partir da afinação padrão). */
export function fingeringToMidi(f: Fingering): number[] {
  return f.truth.map(([stringNumber, fret]) => {
    const s = STANDARD_TUNING.strings.find((x) => x.stringNumber === stringNumber)!;
    return s.midi + fret;
  });
}

export interface AccuracyReport {
  notes: number;
  exact: number;
  stringOnly: number;
  confident: number;
  confidentCorrect: number;
}

export function emptyReport(): AccuracyReport {
  return { notes: 0, exact: 0, stringOnly: 0, confident: 0, confidentCorrect: 0 };
}

export function scoreSequence(
  f: Fingering,
  predicted: { stringNumber: number; fret: number; confident: boolean }[],
  into: AccuracyReport,
): void {
  f.truth.forEach(([s, fr], i) => {
    const p = predicted[i];
    if (!p) return;
    into.notes += 1;
    const exact = p.stringNumber === s && p.fret === fr;
    if (exact) into.exact += 1;
    if (p.stringNumber === s) into.stringOnly += 1;
    if (p.confident) {
      into.confident += 1;
      if (exact) into.confidentCorrect += 1;
    }
  });
}

/** As posições verdadeiras precisam existir no braço: garante que o conjunto de dados é válido. */
export function validateFingering(f: Fingering, fretCount = 24): boolean {
  return fingeringToMidi(f).every((m, i) => {
    const [s, fr] = f.truth[i]!;
    return getPositionsForMidi(m, STANDARD_TUNING, fretCount).some((p) => p.stringNumber === s && p.fret === fr);
  });
}