import type { Tuning } from '../types/music';
import { midiToFrequency, midiToScientificName, A4_HZ } from './notes';

/** Uma posição física (corda + casa) e a nota que ela produz na afinação dada. */
export interface FretPosition {
  /** 1 = corda mais fina, 6 = mais grossa. */
  stringNumber: number;
  /** Índice dentro de `tuning.strings` (0 = primeira da lista). */
  stringIndex: number;
  /** 0 = corda solta. */
  fret: number;
  midi: number;
  /** Frequência teórica em temperamento igual (Hz). */
  frequency: number;
  /** Nome científico, por exemplo "F4". */
  name: string;
}

function assertFretCount(fretCount: number): void {
  if (!Number.isInteger(fretCount) || fretCount < 1 || fretCount > 36) {
    throw new RangeError(`fretCount deve ser um inteiro entre 1 e 36 (recebido ${fretCount})`);
  }
}

/**
 * Nota MIDI produzida numa casa: cada casa sobe um semitom (razão 2^(1/12)),
 * logo midi = corda solta + casa.
 */
export function fretMidi(openMidi: number, fret: number): number {
  return openMidi + fret;
}

/** Mapa completo: uma linha por corda (na ordem da afinação), casas 0..fretCount. */
export function buildFretMap(tuning: Tuning, fretCount: number, a4Hz: number = A4_HZ): FretPosition[][] {
  assertFretCount(fretCount);
  return tuning.strings.map((s, stringIndex) =>
    Array.from({ length: fretCount + 1 }, (_, fret) => {
      const midi = fretMidi(s.midi, fret);
      return {
        stringNumber: s.stringNumber,
        stringIndex,
        fret,
        midi,
        frequency: midiToFrequency(midi, a4Hz),
        name: midiToScientificName(midi),
      };
    }),
  );
}

/**
 * ETAPA B (parte matemática): TODAS as posições que produzem a nota MIDI dada.
 *
 * A lista NÃO é ordenada por probabilidade. A ordem é só a da afinação (1ª corda
 * primeiro), de propósito: classificar candidatas é papel da inferência (Fase 4).
 * Nota fora do alcance do braço devolve lista vazia.
 */
export function getPositionsForMidi(
  midi: number,
  tuning: Tuning,
  fretCount: number,
  a4Hz: number = A4_HZ,
): FretPosition[] {
  assertFretCount(fretCount);
  const out: FretPosition[] = [];
  tuning.strings.forEach((s, stringIndex) => {
    const fret = midi - s.midi;
    if (Number.isInteger(fret) && fret >= 0 && fret <= fretCount) {
      out.push({
        stringNumber: s.stringNumber,
        stringIndex,
        fret,
        midi,
        frequency: midiToFrequency(midi, a4Hz),
        name: midiToScientificName(midi),
      });
    }
  });
  return out;
}

/** Menor e maior nota MIDI tocáveis (corda solta mais grave e última casa mais aguda). */
export function playableRange(tuning: Tuning, fretCount: number): { minMidi: number; maxMidi: number } {
  assertFretCount(fretCount);
  const opens = tuning.strings.map((s) => s.midi);
  return { minMidi: Math.min(...opens), maxMidi: Math.max(...opens) + fretCount };
}
