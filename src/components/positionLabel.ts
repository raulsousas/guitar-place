import type { FretPosition } from '../music/fretmap';

/** "4ª corda, 5ª casa" ou "4ª corda solta". */
export function positionLabel(p: Pick<FretPosition, 'stringNumber' | 'fret'>): string {
  return `${p.stringNumber}ª corda${p.fret === 0 ? ' solta' : `, ${p.fret}ª casa`}`;
}