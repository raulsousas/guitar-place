import type { FretPosition } from '../music/fretmap';
import type { PositionCandidate, PositionState } from './position';

/**
 * Duração APROXIMADA em faixas grossas (sem andamento nem métrica). Os limites estão em
 * `src/tablature/quantize.ts` e em docs/tablature.md. Não é figura rítmica.
 */
export type DurationBucket = 'xs' | 's' | 'm' | 'l' | 'xl';

/**
 * Uma nota registrada na tablatura. Itens são IMUTÁVEIS: cada atualização cria um objeto novo
 * (a interface compara por referência).
 *
 * `position` é uma ESTIMATIVA do algoritmo, a menos que `manual` seja true (informada pelo usuário).
 * `uncertain` marca posições que NÃO podem ser tratadas como estabelecidas.
 */
export interface TabNote {
  kind: 'note';
  /** Identificador estável na tablatura (único por gravador). */
  id: number;
  /** Identificador da nota no decodificador de sequência; null quando o vínculo expirou. */
  noteId: number | null;
  midi: number;
  frequency: number;
  /** Confiança da DETECÇÃO DA NOTA (altura). Independente da confiança da posição. */
  pitchConfidence: number;
  /** Ataque na linha do tempo da tablatura (s). Contínua entre reinícios do motor de áudio. */
  onsetTime: number;
  /** Duração em segundos; null enquanto a nota soa ou quando não foi medida. */
  duration: number | null;
  bucket: DurationBucket | null;
  /** Posição exibida: a correção manual, se houver, senão a melhor estimativa. null = fora do braço. */
  position: FretPosition | null;
  /** Melhor estimativa do algoritmo, ignorando a correção manual. */
  autoPosition: FretPosition | null;
  /** A posição exibida foi informada pelo usuário. */
  manual: boolean;
  state: PositionState;
  /** Índice heurístico da confiança na POSIÇÃO. Não é probabilidade. */
  positionConfidence: number;
  /** Posição não estabelecida: palpite do algoritmo (ambígua) ou nota sem posição no braço. */
  uncertain: boolean;
  /** Candidatas ordenadas (pontuações relativas do algoritmo). */
  candidates: PositionCandidate[];
  /** Posição que a nota tinha antes da última revisão do decodificador. */
  revisedFrom: FretPosition | null;
  revisionCount: number;
  /** Ainda pode ser revisada por notas futuras. */
  provisional: boolean;
}

/** Pausa entre duas notas (silêncio medido, com duração aproximada). */
export interface TabRest {
  kind: 'rest';
  id: number;
  onsetTime: number;
  duration: number;
  bucket: DurationBucket;
}

export type TabItem = TabNote | TabRest;
