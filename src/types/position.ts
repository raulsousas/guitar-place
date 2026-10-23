import type { FretPosition } from '../music/fretmap';

/**
 * Estado da inferência de posição (Etapa B).
 *
 * - `unique`: só existe UMA posição geométrica para a nota nesta afinação e número de casas.
 *   Não diz nada sobre a qualidade da detecção da nota (isso é `pitchConfidence`).
 * - `confident`: há contexto recente e a melhor candidata se destaca das outras.
 *   Continua sendo uma ESTIMATIVA: o áudio sozinho não confirma a casa pressionada.
 * - `ambiguous`: sem contexto suficiente ou candidatas muito próximas. A melhor candidata
 *   é só um palpite e a interface deve mostrá-la como tentativa.
 * - `unknown`: nenhuma posição compatível (nota fora do alcance do braço).
 */
export type PositionState = 'unique' | 'confident' | 'ambiguous' | 'unknown';

export type FactorId = 'region' | 'handShift' | 'stringCohesion' | 'external';

/**
 * Região do braço declarada PELO USUÁRIO (onde ele diz que está tocando). Não é detectada pelo
 * áudio: é uma restrição informada, que reduz as posições consideradas.
 */
export interface FretRegion {
  /** Primeira casa da região (>= 1). */
  minFret: number;
  /** Última casa da região. */
  maxFret: number;
  /** Se as cordas soltas (casa 0) também são consideradas. */
  includeOpen: boolean;
}

/** Contribuição de um fator para a pontuação de uma candidata. `score` null = não se aplica. */
export interface FactorScore {
  id: FactorId;
  /** 0..1, ou null quando o fator não tem informação (por exemplo, sem contexto). */
  score: number | null;
  weight: number;
}

/**
 * Custo (menor = melhor) de uma posição, em parcelas independentes. Documentado em docs/inference.md.
 * - `acoustic`: evidência do SINAL (timbre). Hoje sempre 0: não há modelo acústico de posição (Fase 5c/6).
 * - `evidence`: evidência externa (correção manual, sensor). Não vem do áudio.
 * - `musical`: plausibilidade musical (prior fraco de casa baixa + preferência pela região declarada).
 * - `transition`: custo de ir da posição anterior até esta (deslocamento da mão e troca de corda).
 */
export interface CostBreakdown {
  acoustic: number;
  evidence: number;
  musical: number;
  transition: number;
}

export interface PositionCandidate {
  position: FretPosition;
  /** Parcelas de custo (só no decodificador de sequência). */
  costs?: CostBreakdown;
  /**
   * Pontuação relativa do algoritmo, 0..1 (média ponderada dos fatores aplicáveis).
   * NÃO é probabilidade calibrada nem confirmação física da posição.
   */
  score: number;
  factors: FactorScore[];
}

export interface PositionInference {
  midi: number;
  /** Número de casas usado nesta inferência (descarta resultados de outra configuração). */
  fretCount: number;
  /** Ataque da nota (s, relógio do motor). */
  onsetTime: number;
  state: PositionState;
  /** Ordenadas da melhor para a pior pontuação (desempate determinístico). */
  candidates: PositionCandidate[];
  /** Melhor estimativa (candidates[0]) ou null quando `unknown`. */
  primary: PositionCandidate | null;
  /** Diferença de pontuação entre a 1ª e a 2ª candidata (0 quando há uma só). */
  margin: number;
  /** Havia notas recentes (dentro do tempo limite) para dar contexto. */
  hasContext: boolean;
  /** Região declarada pelo usuário usada nesta inferência (null = braço inteiro). */
  region: FretRegion | null;
  /** A região descartou posições que a nota teria no braço inteiro. */
  restrictedByRegion: boolean;
  /** A nota não tem nenhuma posição dentro da região: o braço inteiro foi usado no lugar. */
  outsideRegion: boolean;
  /**
   * Há região declarada e a melhor estimativa está FORA dela (a região é só uma preferência no
   * decodificador). Diferente de `outsideRegion`, que diz que a nota nem existe na região.
   */
  primaryOutsideRegion: boolean;
  /**
   * Índice heurístico 0..1 da confiança na POSIÇÃO. É independente da confiança da nota
   * (`pitchConfidence`) e não é uma probabilidade.
   */
  positionConfidence: number;
  /** Identificador da nota na sequência do decodificador (-1 na inferência isolada). */
  noteId: number;
  /** Posição que esta nota tinha ANTES da última revisão (null = nunca foi revisada). */
  revisedFrom: FretPosition | null;
  /** Quantas vezes a posição desta nota mudou por causa de notas posteriores. */
  revisionCount: number;
  /** Ainda pode ser revisada por notas futuras (dentro da janela do decodificador). */
  provisional: boolean;
}

/** Uma nota anterior cuja posição mudou porque notas seguintes trouxeram evidência suficiente. */
export interface PositionRevision {
  noteId: number;
  /** Nota cuja chegada provocou a revisão. */
  triggeredBy: number;
  midi: number;
  onsetTime: number;
  from: FretPosition;
  to: FretPosition;
}

/** Resultado de observar uma nota no decodificador: a nota atual e as revisões de notas anteriores. */
export interface DecodeUpdate {
  latest: PositionInference;
  revisions: PositionRevision[];
}

/**
 * Evidência vinda de fora do áudio (sensor de braço, visão computacional, correção manual).
 * `support` 0..1 indica quanto a fonte sustenta aquela posição. A inferência só por áudio
 * funciona sem nenhuma evidência externa.
 */
export interface ExternalEvidence {
  source: string;
  stringIndex: number;
  fret: number;
  support: number;
}

/** Uma nota detectada, vinda do motor de áudio, a ser posicionada. */
export interface NoteObservation {
  midi: number;
  /** Instante do ataque (s, relógio do motor). */
  onsetTime: number;
  evidence?: readonly ExternalEvidence[];
}

/** Nota já posicionada, usada como contexto para as seguintes. */
export interface HistoryEntry {
  midi: number;
  onsetTime: number;
  stringIndex: number;
  fret: number;
  /** Peso do contexto: menor quando a posição escolhida era ambígua. */
  weight: number;
}
