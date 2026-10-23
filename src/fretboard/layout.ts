import { normalizedFretCenters, normalizedFretPositions } from './geometry';

/**
 * Layout em coordenadas SVG (funções puras, testáveis sem React).
 * A posição horizontal segue a regra de escala do temperamento igual
 * (`geometry.ts`); a vertical distribui as cordas com espaçamento fixo.
 */
export interface FretboardLayout {
  fretCount: number;
  stringCount: number;
  width: number;
  height: number;
  nutX: number;
  boardWidth: number;
  top: number;
  boardHeight: number;
  stringGap: number;
  /** Posição X normalizada (0..1) de cada traste 0..fretCount. */
  edges: number[];
  /** Posição X normalizada (0..1) do centro de cada casa 1..fretCount. */
  centers: number[];
}

const WIDTH = 1160;
const NUT_X = 64;
const RIGHT_PAD = 12;
const TOP = 34;
const STRING_GAP = 30;
const STRING_OFFSET = 18;

export function createLayout(fretCount: number, stringCount = 6): FretboardLayout {
  const boardHeight = STRING_GAP * (stringCount - 1) + 36;
  return {
    fretCount,
    stringCount,
    width: WIDTH,
    height: TOP + boardHeight + 12,
    nutX: NUT_X,
    boardWidth: WIDTH - NUT_X - RIGHT_PAD,
    top: TOP,
    boardHeight,
    stringGap: STRING_GAP,
    edges: normalizedFretPositions(fretCount),
    centers: normalizedFretCenters(fretCount),
  };
}

/** X de um traste (0 = pestana). */
export function fretEdgeX(l: FretboardLayout, fret: number): number {
  return l.nutX + (l.edges[fret] ?? 0) * l.boardWidth;
}

/** X do centro da casa `fret` (1..fretCount), onde o dedo pressiona. Casa 0 = corda solta, à esquerda da pestana. */
export function fretCenterX(l: FretboardLayout, fret: number): number {
  if (fret <= 0) return l.nutX - 22;
  return l.nutX + (l.centers[fret - 1] ?? 0) * l.boardWidth;
}

/** Y da corda de índice `stringIndex` (0 = primeira da afinação, no topo). */
export function stringY(l: FretboardLayout, stringIndex: number): number {
  return l.top + STRING_OFFSET + stringIndex * l.stringGap;
}

export function positionXY(l: FretboardLayout, stringIndex: number, fret: number): { x: number; y: number } {
  return { x: fretCenterX(l, fret), y: stringY(l, stringIndex) };
}
