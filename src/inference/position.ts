import { getPositionsForMidi } from '../music/fretmap';
import type { Tuning } from '../types/music';
import type {
  FactorScore,
  HistoryEntry,
  NoteObservation,
  FretRegion,
  PositionCandidate,
  PositionInference,
  PositionState,
} from '../types/position';
import { DEFAULT_INFERENCE_CONFIG, type InferenceConfig } from './config';
import { SequenceDecoder } from './decoder';
import { contextWeights, externalScore, handCenter, handShiftScore, regionScore, stringCohesionScore } from './factors';
import { inRegion, normalizeRegion, sameRegion } from './region';

export { inRegion, normalizeRegion, sameRegion };

const EPS = 1e-9;

export interface RankInput {
  obs: NoteObservation;
  tuning: Tuning;
  fretCount: number;
  /** Mais recente primeiro. */
  history: readonly HistoryEntry[];
  config?: InferenceConfig;
  /** Região do braço declarada pelo usuário; null/ausente = braço inteiro. */
  region?: FretRegion | null;
}

/**
 * Etapa B: classifica as posições compatíveis com a nota. Função pura e determinística.
 * Cada fator está descrito em docs/inference.md. A candidata "mais próxima" não é favorecida
 * por padrão: a proximidade é só um dos fatores e depende do contexto e do tempo entre notas.
 */
export function rankPositions({
  obs,
  tuning,
  fretCount,
  history,
  config = DEFAULT_INFERENCE_CONFIG,
  region = null,
}: RankInput): PositionInference {
  const cfg = config;
  let all = getPositionsForMidi(obs.midi, tuning, fretCount);

  // Região declarada pelo usuário: só as posições dentro dela concorrem. Se a nota não cabe em
  // nenhuma, usa o braço inteiro e avisa (não esconde a nota nem inventa uma posição).
  let restrictedByRegion = false;
  let outsideRegion = false;
  if (region) {
    const inside = all.filter((p) => inRegion(p, region));
    if (inside.length > 0) {
      restrictedByRegion = inside.length < all.length;
      all = inside;
    } else if (all.length > 0) {
      outsideRegion = true;
    }
  }

  // Contexto vencido por silêncio longo é descartado.
  const newest = history[0];
  const fresh =
    newest !== undefined && (obs.onsetTime - newest.onsetTime) * 1000 <= cfg.contextTimeoutMs ? history : [];
  const ctx = contextWeights(fresh, cfg);
  const hasContext = ctx.length > 0;
  const dt = hasContext ? obs.onsetTime - fresh[0]!.onsetTime : 0;
  const center = handCenter(ctx);

  const candidates: PositionCandidate[] = all.map((position) => {
    const factors: FactorScore[] = [
      { id: 'region', score: regionScore(position, fretCount, cfg), weight: cfg.weightRegion },
      { id: 'handShift', score: handShiftScore(position, center, dt, cfg), weight: cfg.weightHandShift },
      { id: 'stringCohesion', score: stringCohesionScore(position, ctx, cfg), weight: cfg.weightStringCohesion },
      { id: 'external', score: externalScore(position, obs.evidence), weight: cfg.weightExternal },
    ];
    let num = 0;
    let den = 0;
    for (const f of factors) {
      if (f.score !== null) {
        num += f.weight * f.score;
        den += f.weight;
      }
    }
    return { position, score: den > 0 ? num / den : 0, factors };
  });

  // Desempate determinístico: pontuação, depois a ordem das cordas da afinação.
  candidates.sort((a, b) =>
    Math.abs(b.score - a.score) > EPS ? b.score - a.score : a.position.stringIndex - b.position.stringIndex,
  );

  const primary = candidates[0] ?? null;
  const margin = candidates.length > 1 ? candidates[0]!.score - candidates[1]!.score : 0;

  let state: PositionState;
  let positionConfidence: number;
  if (candidates.length === 0) {
    state = 'unknown';
    positionConfidence = 0;
  } else if (candidates.length === 1) {
    if (restrictedByRegion) {
      // Só sobrou uma porque o usuário limitou a região: depende dessa informação, não do áudio.
      state = 'confident';
      positionConfidence = cfg.maxInferredConfidence;
    } else {
      state = 'unique';
      positionConfidence = 1;
    }
  } else {
    const raw = Math.min(1, margin / cfg.fullConfidenceMargin);
    if (hasContext && margin >= cfg.confidentMargin) {
      state = 'confident';
      positionConfidence = Math.min(raw, cfg.maxInferredConfidence);
    } else {
      state = 'ambiguous';
      positionConfidence = hasContext ? Math.min(raw, 0.5) : Math.min(raw, cfg.noContextConfidenceCap);
    }
  }

  return {
    midi: obs.midi,
    fretCount,
    onsetTime: obs.onsetTime,
    state,
    candidates,
    primary,
    margin,
    hasContext,
    region: region ?? null,
    restrictedByRegion,
    outsideRegion,
    primaryOutsideRegion: region && primary ? !inRegion(primary.position, region) : false,
    positionConfidence,
    noteId: -1,
    revisedFrom: null,
    revisionCount: 0,
    provisional: false,
  };
}

/**
 * Inferência sequencial: mantém o contexto das últimas notas já posicionadas.
 * Não reavalia notas passadas (decisão documentada em docs/inference.md).
 */
export class PositionInferrer {
  private history: HistoryEntry[] = [];

  constructor(
    private tuning: Tuning,
    private fretCount: number,
    private config: InferenceConfig = DEFAULT_INFERENCE_CONFIG,
    private region: FretRegion | null = null,
  ) {}

  observe(obs: NoteObservation): PositionInference {
    const inf = rankPositions({
      obs,
      tuning: this.tuning,
      fretCount: this.fretCount,
      history: this.history,
      config: this.config,
      region: this.region,
    });
    if (inf.primary) {
      this.history.unshift({
        midi: inf.midi,
        onsetTime: inf.onsetTime,
        stringIndex: inf.primary.position.stringIndex,
        fret: inf.primary.position.fret,
        weight: inf.state === 'unique' || inf.state === 'confident' ? 1 : this.config.ambiguousHistoryWeight,
      });
      if (this.history.length > this.config.contextWindow) this.history.length = this.config.contextWindow;
    }
    return inf;
  }

  reset(): void {
    this.history = [];
  }
}

/** Reaplica a inferência a uma sequência de observações (determinístico, sem estado externo). */
export function inferSequence(
  observations: readonly NoteObservation[],
  tuning: Tuning,
  fretCount: number,
  config: InferenceConfig = DEFAULT_INFERENCE_CONFIG,
  region: FretRegion | null = null,
): PositionInference[] {
  const inferrer = new PositionInferrer(tuning, fretCount, config, region);
  return observations.map((o) => inferrer.observe(o));
}

/**
 * Inferência a exibir para a nota ao vivo. Usa a inferência sequencial quando ela é da mesma nota e do
 * mesmo número de casas; caso contrário (ex.: o usuário trocou o número de casas com a nota soando)
 * recalcula SEM contexto (decodificador de uma nota), o que resulta em ambiguous quando há mais de uma posição.
 */
export function inferenceForLiveNote(
  liveMidi: number | null,
  last: PositionInference | null,
  tuning: Tuning,
  fretCount: number,
  region: FretRegion | null = null,
): PositionInference | null {
  if (liveMidi === null) return null;
  if (last && last.midi === liveMidi && last.fretCount === fretCount && sameRegion(last.region, region)) {
    return last;
  }
  // Sem contexto: um decodificador de uma nota só. A região é preferência forte (não filtro) e a nota
  // continua `ambiguous` se nada além do áudio sustentar a escolha.
  return new SequenceDecoder(tuning, fretCount, region).observe({ midi: liveMidi, onsetTime: 0 }).latest;
}