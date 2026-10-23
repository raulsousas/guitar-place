import type { Tuning } from '../types/music';

/**
 * Afinação padrão. A estrutura é um dado (lista de cordas com nota MIDI) para
 * permitir afinações alternativas no futuro sem alterar quem a consome.
 */
export const STANDARD_TUNING: Tuning = {
  id: 'standard',
  name: 'Padrão (E A D G B E)',
  strings: [
    { stringNumber: 1, midi: 64, label: 'e' }, // E4
    { stringNumber: 2, midi: 59, label: 'B' }, // B3
    { stringNumber: 3, midi: 55, label: 'G' }, // G3
    { stringNumber: 4, midi: 50, label: 'D' }, // D3
    { stringNumber: 5, midi: 45, label: 'A' }, // A2
    { stringNumber: 6, midi: 40, label: 'E' }, // E2
  ],
};
