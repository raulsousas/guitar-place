/** Tipos de afinação e teoria musical. */

export interface StringTuning {
  /** 1 = corda mais fina (E4), 6 = corda mais grossa (E2). */
  stringNumber: 1 | 2 | 3 | 4 | 5 | 6;
  /** Nota MIDI da corda solta (E2 = 40, A4 = 69). */
  midi: number;
  /** Rótulo curto exibido no braço (e B G D A E). */
  label: string;
}

export interface Tuning {
  id: string;
  name: string;
  /** Ordenadas da 1ª corda (mais fina) para a 6ª (mais grossa). */
  strings: readonly StringTuning[];
}
