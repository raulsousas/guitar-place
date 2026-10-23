import { getPositionsForMidi, type FretPosition } from '../music/fretmap';
import type { Tuning } from '../types/music';
import type {
  CostBreakdown,
  DecodeUpdate,
  ExternalEvidence,
  FretRegion,
  NoteObservation,
  PositionCandidate,
  PositionInference,
  PositionRevision,
  PositionState,
} from '../types/position';
import { DEFAULT_DECODER_CONFIG, type DecoderConfig } from './config';
import { stepCost, type CostContext, type PathState } from './costs';
import { inRegion } from './region';

/**
 * Decodificador de sequência (Fase 5a): beam search sobre as posições de cada nota.
 *
 * Em vez de escolher uma posição por nota e tratá-la como verdade (o que propaga um erro inicial),
 * mantém várias hipóteses de caminho (corda/casa por nota) e as reavalia a cada novo ataque. Uma nota
 * anterior só muda de posição quando o melhor caminho global, incluindo as notas seguintes, supera o
 * caminho atualmente exibido por `revisionMargin` por nota alterada (histerese).
 *
 * Limite que NENHUM decodificador remove: sem timbre nem correção manual, uma nota isolada (ou a
 * primeira após uma pausa) continua ambígua. O decodificador só combina melhor a informação existente.
 */

interface NoteRec {
  id: number;
  midi: number;
  onsetTime: number;
  evidence: NoteObservation['evidence'];
  candidates: FretPosition[];
  displayed: FretPosition | null;
  revisedFrom: FretPosition | null;
  revisionCount: number;
  inference: PositionInference;
}

interface Hyp {
  /** Índice da candidata escolhida para cada nota da janela. */
  path: number[];
  /** Custo acumulado (soma das quatro parcelas em todos os passos). */
  cost: number;
  /** Custo acumulado mais a penalidade de estabilidade (usado para podar e escolher). */
  adj: number;
  last: PathState;
  /** Parcelas do ÚLTIMO passo (para mostrar o custo da candidata atual). */
  lastCosts: CostBreakdown;
}

/** Número máximo de notas guardadas para consulta (limite de memória). */
const MAX_RECORDS = 1000;

const same = (a: FretPosition, b: FretPosition) => a.stringIndex === b.stringIndex && a.fret === b.fret;

export class SequenceDecoder {
  private records: NoteRec[] = [];
  /** Notas ainda revisáveis (as últimas do trecho atual). */
  private window: NoteRec[] = [];
  private beam: Hyp[] = [];
  private nextId = 0;
  private readonly cfg: DecoderConfig;
  private readonly ctx: CostContext;

  constructor(
    private readonly tuning: Tuning,
    private readonly fretCount: number,
    private readonly region: FretRegion | null = null,
    config: DecoderConfig = DEFAULT_DECODER_CONFIG,
  ) {
    this.cfg = config;
    this.ctx = { fretCount, region, cfg: config };
  }

  reset(): void {
    this.records = [];
    this.window = [];
    this.beam = [];
    this.nextId = 0;
  }

  /** Inferência atual de todas as notas guardadas (a última é a mais recente). */
  inferences(): PositionInference[] {
    return this.records.map((r) => r.inference);
  }

  /** Inferência da nota mais recente, ou null sem notas. */
  latest(): PositionInference | null {
    return this.records.at(-1)?.inference ?? null;
  }

  /**
   * Encerra o contexto atual sem apagar as notas: a próxima nota começa um trecho novo (como após uma
   * pausa longa). Usado ao pausar a gravação e ao recriar o motor de áudio.
   */
  breakContext(): void {
    this.consolidateAll();
  }

  /**
   * Anexa evidência EXTERNA ao áudio (correção manual) a uma nota ainda revisável e reavalia a janela.
   * Devolve as revisões de OUTRAS notas causadas pela correção, ou null quando a nota não está mais
   * na janela (já consolidada): nesse caso a evidência não influencia o decodificador.
   * Aproximação: a janela é recomputada do zero, sem a posição da mão anterior a ela.
   */
  applyEvidence(noteId: number, evidence: readonly ExternalEvidence[]): DecodeUpdate | null {
    const rec = this.window.find((r) => r.id === noteId);
    if (!rec) return null;
    rec.evidence = evidence;
    const keep = { revisedFrom: rec.revisedFrom, count: rec.revisionCount };
    this.beam = [];
    for (const r of this.window) this.extendBeam(r);
    const revisions = this.applyBestPath(rec.id).filter((r) => r.noteId !== rec.id);
    rec.revisedFrom = keep.revisedFrom;
    rec.revisionCount = keep.count;
    this.refreshInferences();
    return { latest: this.window.at(-1)!.inference, revisions };
  }

  observe(obs: NoteObservation): DecodeUpdate {
    const candidates = getPositionsForMidi(obs.midi, this.tuning, this.fretCount);
    const rec: NoteRec = {
      id: this.nextId++,
      midi: obs.midi,
      onsetTime: obs.onsetTime,
      evidence: obs.evidence,
      candidates,
      displayed: null,
      revisedFrom: null,
      revisionCount: 0,
      inference: this.emptyInference(obs, candidates),
    };
    this.pushRecord(rec);
    if (candidates.length === 0) return { latest: rec.inference, revisions: [] };

    // Pausa longa (ou relógio reiniciado): o trecho anterior é consolidado e o contexto recomeça.
    const prev = this.window.at(-1);
    if (
      prev &&
      ((obs.onsetTime - prev.onsetTime) * 1000 > this.cfg.inference.contextTimeoutMs || obs.onsetTime < prev.onsetTime)
    ) {
      this.consolidateAll();
    }

    this.window.push(rec);
    this.extendBeam(rec);

    // Notas fora da janela são consolidadas: mantêm a última decisão e deixam de ser revisáveis.
    while (this.window.length > this.cfg.windowSize) {
      const old = this.window.shift()!;
      old.inference = { ...old.inference, provisional: false };
      for (const h of this.beam) h.path.shift();
    }

    const revisions = this.applyBestPath(rec.id);
    this.refreshInferences();
    return { latest: rec.inference, revisions };
  }

  // --- interno ---

  private pushRecord(rec: NoteRec): void {
    this.records.push(rec);
    if (this.records.length > MAX_RECORDS) this.records.shift();
  }

  private consolidateAll(): void {
    for (const r of this.window) r.inference = { ...r.inference, provisional: false };
    this.window = [];
    this.beam = [];
  }

  private extendBeam(rec: NoteRec): void {
    const note = { onsetTime: rec.onsetTime, evidence: rec.evidence };
    const next: Hyp[] = [];
    const bases: (Hyp | null)[] = this.beam.length > 0 ? this.beam : [null];
    for (const base of bases) {
      rec.candidates.forEach((position, idx) => {
        const s = stepCost(base ? base.last : null, position, note, this.ctx);
        const cost = (base?.cost ?? 0) + s.total;
        next.push({
          path: [...(base?.path ?? []), idx],
          cost,
          adj: cost,
          last: { position, hand: s.hand, onsetTime: rec.onsetTime },
          lastCosts: s.costs,
        });
      });
    }
    this.beam = this.prune(next);
  }

  /** Penalidade de estabilidade: cada nota anterior que difere da posição JÁ exibida custa `revisionMargin`. */
  private adjusted(h: Hyp): number {
    let diff = 0;
    for (let i = 0; i < h.path.length - 1; i++) {
      const rec = this.window[i];
      const shown = rec?.displayed;
      if (rec && shown) {
        const p = rec.candidates[h.path[i]!];
        if (p && !same(p, shown)) diff++;
      }
    }
    return h.cost + this.cfg.revisionMargin * diff;
  }

  private prune(hyps: Hyp[]): Hyp[] {
    for (const h of hyps) h.adj = this.adjusted(h);
    // Mescla equivalentes: mesma posição final e mesma posição de mão têm o mesmo custo futuro,
    // mas o caminho passado pode diferir. Mantém, por (posição final, mão), o de menor custo ajustado.
    const merged = new Map<string, Hyp>();
    for (const h of hyps) {
      const key = `${h.last.position.stringIndex}:${h.last.position.fret}:${h.last.hand === null ? "n" : Math.round(h.last.hand)}`;
      const cur = merged.get(key);
      if (!cur || h.adj < cur.adj) merged.set(key, h);
    }
    const sorted = [...merged.values()].sort((a, b) => a.adj - b.adj);
    const kept = sorted.slice(0, this.cfg.beamWidth);
    // Garante a melhor hipótese de CADA posição da nota atual: a margem entre candidatas nunca é
    // calculada sobre um conjunto incompleto (isso causaria excesso de confiança).
    const have = new Set(kept.map((h) => `${h.last.position.stringIndex}:${h.last.position.fret}`));
    for (const h of sorted) {
      const k = `${h.last.position.stringIndex}:${h.last.position.fret}`;
      if (!have.has(k)) {
        kept.push(h);
        have.add(k);
      }
    }
    return kept;
  }

  /** Aplica o melhor caminho às notas da janela e devolve as revisões (notas anteriores que mudaram). */
  private applyBestPath(triggeredBy: number): PositionRevision[] {
    const best = this.beam.reduce((a, b) => (b.adj < a.adj ? b : a));
    const revisions: PositionRevision[] = [];
    this.window.forEach((rec, i) => {
      const pos = rec.candidates[best.path[i]!]!;
      const shown = rec.displayed;
      if (shown && !same(shown, pos)) {
        revisions.push({ noteId: rec.id, triggeredBy, midi: rec.midi, onsetTime: rec.onsetTime, from: shown, to: pos });
        rec.revisedFrom = shown;
        rec.revisionCount += 1;
      }
      rec.displayed = pos;
    });
    return revisions;
  }

  private refreshInferences(): void {
    this.window.forEach((rec, i) => {
      rec.inference = this.buildInference(rec, i);
    });
  }

  private buildInference(rec: NoteRec, windowIndex: number): PositionInference {
    // Melhor hipótese (por custo ajustado) para cada candidata desta nota.
    const bestFor = new Map<number, Hyp>();
    for (const h of this.beam) {
      const idx = h.path[windowIndex]!;
      const cur = bestFor.get(idx);
      if (!cur || h.adj < cur.adj) bestFor.set(idx, h);
    }
    const isLatest = windowIndex === this.window.length - 1;
    const entries = [...bestFor.entries()].map(([idx, h]) => ({ idx, h }));
    entries.sort((a, b) => (Math.abs(a.h.adj - b.h.adj) > 1e-9 ? a.h.adj - b.h.adj : a.idx - b.idx));
    const minAdj = entries[0]!.h.adj;
    const cfg = this.cfg.inference;

    const candidates: PositionCandidate[] = entries.map(({ idx, h }) => ({
      position: rec.candidates[idx]!,
      score: Math.exp(-(h.adj - minAdj) / this.cfg.scoreTemperature),
      costs: isLatest ? h.lastCosts : this.stepCostsFor(windowIndex, h),
      factors: [],
    }));

    const primary = candidates[0] ?? null;
    const margin = entries.length > 1 ? entries[1]!.h.adj - entries[0]!.h.adj : 0;
    const hasContext = this.window.length > 1;
    const region = this.region;
    // Informação do USUÁRIO que sustenta a decisão mesmo sem contexto: região que separa a melhor das
    // demais, ou evidência externa (correção manual). O áudio sozinho não conta como sustentação.
    const restrictedByRegion =
      region !== null &&
      primary !== null &&
      inRegion(primary.position, region) &&
      candidates.some((c) => !inRegion(c.position, region));
    const userSupported = restrictedByRegion || (rec.evidence?.length ?? 0) > 0;

    let state: PositionState;
    let positionConfidence: number;
    if (rec.candidates.length === 1) {
      state = 'unique';
      positionConfidence = 1;
    } else {
      const raw = Math.min(1, margin / cfg.fullConfidenceMargin);
      if ((hasContext || userSupported) && margin >= cfg.confidentMargin) {
        state = 'confident';
        positionConfidence = Math.min(raw, cfg.maxInferredConfidence);
      } else {
        state = 'ambiguous';
        positionConfidence = hasContext || userSupported ? Math.min(raw, 0.5) : Math.min(raw, cfg.noContextConfidenceCap);
      }
    }
    return {
      midi: rec.midi,
      fretCount: this.fretCount,
      onsetTime: rec.onsetTime,
      state,
      candidates,
      primary,
      margin,
      hasContext,
      region,
      restrictedByRegion,
      outsideRegion: region ? !rec.candidates.some((p) => inRegion(p, region)) : false,
      primaryOutsideRegion: region && primary ? !inRegion(primary.position, region) : false,
      positionConfidence,
      noteId: rec.id,
      revisedFrom: rec.revisedFrom,
      revisionCount: rec.revisionCount,
      provisional: true,
    };
  }

  /** Parcelas de custo do passo de uma nota anterior, recalculadas pelo caminho da hipótese. */
  private stepCostsFor(windowIndex: number, h: Hyp): CostBreakdown {
    let prev: PathState | null = null;
    let costs: CostBreakdown = { acoustic: 0, evidence: 0, musical: 0, transition: 0 };
    for (let i = 0; i <= windowIndex; i++) {
      const r = this.window[i]!;
      const position = r.candidates[h.path[i]!]!;
      const s = stepCost(prev, position, { onsetTime: r.onsetTime, evidence: r.evidence }, this.ctx);
      costs = s.costs;
      prev = { position, hand: s.hand, onsetTime: r.onsetTime };
    }
    return costs;
  }

  private emptyInference(obs: NoteObservation, candidates: FretPosition[]): PositionInference {
    return {
      midi: obs.midi,
      fretCount: this.fretCount,
      onsetTime: obs.onsetTime,
      state: candidates.length === 0 ? 'unknown' : 'ambiguous',
      candidates: [],
      primary: null,
      margin: 0,
      hasContext: false,
      region: this.region,
      restrictedByRegion: false,
      outsideRegion: false,
      primaryOutsideRegion: false,
      positionConfidence: 0,
      noteId: this.nextId - 1,
      revisedFrom: null,
      revisionCount: 0,
      provisional: candidates.length > 0,
    };
  }
}