const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const NOTE_NAMES_PT = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'] as const;

export const A4_MIDI = 69;
export const A4_HZ = 440;

/** Frequência (Hz) de uma nota MIDI em temperamento igual. */
export function midiToFrequency(midi: number, a4Hz: number = A4_HZ): number {
  return a4Hz * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Nota MIDI fracionária correspondente a uma frequência (69 = A4). */
export function frequencyToMidiFloat(hz: number, a4Hz: number = A4_HZ): number {
  return A4_MIDI + 12 * Math.log2(hz / a4Hz);
}

export interface NoteInfo {
  /** Nota MIDI inteira mais próxima. */
  midi: number;
  /** Desvio em cents em relação a essa nota (−50..+50). */
  cents: number;
}

export function frequencyToNote(hz: number, a4Hz: number = A4_HZ): NoteInfo {
  const f = frequencyToMidiFloat(hz, a4Hz);
  const midi = Math.round(f);
  return { midi, cents: (f - midi) * 100 };
}

/** Nome científico internacional, por exemplo 40 -> "E2", 64 -> "E4". */
export function midiToScientificName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

/** Nome em português com oitava, por exemplo 65 -> "Fá (F4)". */
export function midiToPtName(midi: number): string {
  const pt = NOTE_NAMES_PT[((midi % 12) + 12) % 12];
  return `${pt} (${midiToScientificName(midi)})`;
}
