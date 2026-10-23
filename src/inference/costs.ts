import type { FretPosition } from '../music/fretmap';
import type { CostBreakdown, ExternalEvidence, FretRegion } from '../types/position';
import type { DecoderConfig } from './config';
import { regionScore } from './factors';
import { inRegion } from './region';

/**
 * Custos do decodificador (menor = melhor). Quatro parcelas INDEPENDENTES, somadas só no fim:
 *
 * - acústico:    o que o SINAL diz sobre a posição (timbre). Ainda não existe modelo acústico validado,
 *                então vale 0 para todas as candidatas. Não se inventa evidência (Fase 5c decide).
 * - evidência:   informação externa ao áudio (correção manual, sensor). Hoje só vem do usuário.
 * - musical:     plausibilidade musical da posição isolada (prior fraco de casa baixa) e preferência
 *                pela região que o usuário declarou. Preferência forte, não filtro.
 * - transição:   custo de ir da posição anterior até esta (deslocamento da mão e troca de corda).
 *
 * Funções puras. Todos os parâmetros estão documentados em `config.ts` e `docs/inference.md`.
 */

/** Estado do caminho após uma nota: onde ela foi tocada e onde a mão está (última casa pressionada). */
export interface PathState {
  position: FretPosition;
  /** Posição estimada da mão (média móvel das casas pressionadas). Soltas não a movem. null = desconhecida. */
  hand: number | null;
  onsetTime: number;
}

export interface StepResult {
  costs: CostBreakdown;
  total: number;
  hand: number | null;
}

export interface CostContext {
  fretCount: number;
  region: FretRegion | null;
  cfg: DecoderConfig;
}

export interface NoteForCost {
  onsetTime: number;
  evidence?: readonly ExternalEvidence[];
}

/** Posição estimada da mão após a nota: média móvel das casas pressionadas (solta não move a mão). */
export function nextHand(hand: number | null, fret: number, ctx: CostContext): number | null {
  if (fret <= 0) return hand;
  if (hand === null) return fret;
  return hand + ctx.cfg.handFollow * (fret - hand);
}

/** Sem modelo acústico de posição: custo neutro (0) para todas. Ver Fase 5c. */
export function acousticCost(): number {
  return 0;
}

export function evidenceCost(p: FretPosition, evidence: readonly ExternalEvidence[] | undefined, ctx: CostContext): number {
  if (!evidence || evidence.length === 0) return 0;
  let support = 0;
  for (const e of evidence) {
    if (e.stringIndex === p.stringIndex && e.fret === p.fret) support = Math.max(support, e.support);
  }
  return ctx.cfg.evidenceWeight * (1 - support);
}

export function musicalCost(p: FretPosition, ctx: CostContext): number {
  const inf = ctx.cfg.inference;
  let c = inf.weightRegion * (1 - regionScore(p, ctx.fretCount, inf));
  if (ctx.region && !inRegion(p, ctx.region)) c += ctx.cfg.userRegionPenalty;
  return c;
}

export function transitionCost(prev: PathState | null, p: FretPosition, onsetTime: number, ctx: CostContext): number {
  if (!prev) return 0;
  const inf = ctx.cfg.inference;
  let hand = 0;
  if (prev.hand !== null) {
    const dt = Math.max(0, onsetTime - prev.onsetTime);
    const allowance = inf.shiftBaseFrets + inf.shiftFretsPerSecond * dt;
    // Corda solta: a mão não precisa estar na casa 0, então o alcance é maior (openStringReachFactor),
    // mas a distância até a mão ainda conta (mão na 12ª casa -> corda solta custa).
    const reach = p.fret === 0 ? allowance * ctx.cfg.openStringReachFactor : allowance;
    const d = Math.abs(p.fret - prev.hand);
    hand = inf.weightHandShift * (1 - 1 / (1 + (d / reach) ** 2));
  }
  const string =
    inf.weightStringCohesion *
    (1 - Math.exp(-Math.abs(p.stringIndex - prev.position.stringIndex) / inf.stringScale));
  return hand + string;
}

export function stepCost(prev: PathState | null, p: FretPosition, note: NoteForCost, ctx: CostContext): StepResult {
  const costs: CostBreakdown = {
    acoustic: acousticCost(),
    evidence: evidenceCost(p, note.evidence, ctx),
    musical: musicalCost(p, ctx),
    transition: transitionCost(prev, p, note.onsetTime, ctx),
  };
  return {
    costs,
    total: costs.acoustic + costs.evidence + costs.musical + costs.transition,
    hand: nextHand(prev?.hand ?? null, p.fret, ctx),
  };
}
