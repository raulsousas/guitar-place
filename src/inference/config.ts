/**
 * Parâmetros da inferência de posição (Etapa B). Efeito de cada um em docs/inference.md.
 * Os valores iniciais são heurísticos e foram ajustados SÓ com sequências sintéticas
 * (tests/unit/position-inference.test.ts). Não foram calibrados com guitarra real.
 */
export interface InferenceConfig {
  /** Peso do fator "região": prior fraco que favorece casas baixas/médias. */
  weightRegion: number;
  /** Peso do fator "deslocamento da mão" em relação à região recente. */
  weightHandShift: number;
  /** Peso do fator "coesão de corda" (continuidade da corda nas notas recentes). */
  weightStringCohesion: number;
  /** Peso da evidência externa (sensor, visão, correção manual), se existir. */
  weightExternal: number;

  /** Queda do prior de região: score = 1 − regionSlope · casa / nCasas. */
  regionSlope: number;

  /** Alcance base da mão (casas) sem tempo de deslocamento. */
  shiftBaseFrets: number;
  /** Casas extras de alcance por segundo entre ataques (penaliza saltos com pouco tempo). */
  shiftFretsPerSecond: number;
  /** Pontuação neutra do fator de mão para cordas soltas (não exigem posição da mão). */
  openStringHandScore: number;

  /** Escala (em cordas) do decaimento da coesão: score = exp(−|Δcorda| / escala). */
  stringScale: number;

  /** Quantas notas anteriores compõem a janela de contexto. */
  contextWindow: number;
  /** Decaimento por nota mais antiga na janela (0..1). */
  contextDecay: number;
  /** Após esse intervalo sem notas (ms), o contexto é descartado. */
  contextTimeoutMs: number;
  /** Peso de uma nota de contexto cuja posição era ambígua (0..1). */
  ambiguousHistoryWeight: number;

  /** Margem mínima (1ª − 2ª) para o estado `confident`. */
  confidentMargin: number;
  /** Margem que corresponde a positionConfidence = 1. */
  fullConfidenceMargin: number;
  /** Teto de positionConfidence sem contexto. */
  noContextConfidenceCap: number;
  /**
   * Teto de positionConfidence quando a posição é INFERIDA (estado `confident`). Impede que
   * uma heurística de contexto pareça certeza: o áudio não confirma a casa pressionada.
   */
  maxInferredConfidence: number;
}

export const DEFAULT_INFERENCE_CONFIG: InferenceConfig = {
  weightRegion: 0.15,
  weightHandShift: 0.45,
  weightStringCohesion: 0.25,
  weightExternal: 0.6,

  regionSlope: 0.5,

  shiftBaseFrets: 4,
  shiftFretsPerSecond: 6,
  openStringHandScore: 0.6,

  stringScale: 1.5,

  contextWindow: 5,
  contextDecay: 0.6,
  contextTimeoutMs: 4000,
  ambiguousHistoryWeight: 0.5,

  confidentMargin: 0.1,
  fullConfidenceMargin: 0.3,
  noContextConfidenceCap: 0.25,
  maxInferredConfidence: 0.9,
};

/**
 * Parâmetros do decodificador de sequência (Fase 5a). Os pesos de custo são os de `InferenceConfig`
 * (hand, string, região, externo). Os valores abaixo são HEURÍSTICOS, ajustados só com sequências
 * sintéticas, e dependem de validação com guitarra real (ver docs/inference.md).
 */
export interface DecoderConfig {
  inference: InferenceConfig;
  /** Hipóteses mantidas por passo (poda do feixe). Mais largo = mais fiel ao ótimo global, mais CPU. */
  beamWidth: number;
  /** Quantas notas recentes (do mesmo trecho) ainda podem ser revisadas. Mais velho que isso é consolidado. */
  windowSize: number;
  /** Custo somado a uma posição FORA da região declarada pelo usuário (preferência forte, não filtro). */
  userRegionPenalty: number;
  /**
   * Uma nota já exibida só muda de posição se o novo melhor caminho for melhor que o atual por pelo
   * menos isto (histerese). Evita trocas por diferenças pequenas e "pisca-pisca".
   */
  revisionMargin: number;
  /** Escala da pontuação relativa exibida: score = exp(-(custo - melhor) / temperatura). */
  scoreTemperature: number;
  /** Peso do custo de evidência externa: custo = peso x (1 - suporte da posição). Manual deve dominar. */
  evidenceWeight: number;
  /**
   * Quanto a posição estimada da mão acompanha cada nota pressionada (0..1): mao' = mao + k (casa - mao).
   * Menor = a mão "lembra" mais tempo, e a deriva lenta ao longo de uma só corda fica mais cara.
   */
  handFollow: number;
  /** Alcance extra de uma corda solta em relação a uma casa pressionada (a mão não precisa estar lá). */
  openStringReachFactor: number;
}

/**
 * Pesos do decodificador. Cópia ajustada de `DEFAULT_INFERENCE_CONFIG` (o ranking nota a nota
 * continua com os valores antigos). Escolhidos num conjunto de AJUSTE de 3 digitações sintéticas
 * (tests/helpers/fingerings.ts) sob a restrição de manter a escala da 12ª casa na 1ª corda; o conjunto
 * de VALIDAÇÃO só foi avaliado depois. São heurísticos e NÃO foram calibrados com guitarra real.
 */
const DECODER_INFERENCE_CONFIG: InferenceConfig = {
  ...DEFAULT_INFERENCE_CONFIG,
  weightStringCohesion: 0.15,
  weightRegion: 0.4,
  // Com 0.2 as notas marcadas "estimada" acertaram 100% nas digitações sintéticas (com 0.1: 65-82%),
  // ao custo de menos cobertura. Escolhido olhando os dois conjuntos; ver docs/inference.md.
  confidentMargin: 0.2,
};

export const DEFAULT_DECODER_CONFIG: DecoderConfig = {
  inference: DECODER_INFERENCE_CONFIG,
  beamWidth: 24,
  windowSize: 16,
  userRegionPenalty: 0.6,
  revisionMargin: 0.1,
  scoreTemperature: 0.25,
  evidenceWeight: 2,
  handFollow: 0.6,
  openStringReachFactor: 2,
};