import { describe, expect, it } from 'vitest';
import { DEFAULT_INFERENCE_CONFIG } from '../../src/inference/config';
import { inferSequence, rankPositions } from '../../src/inference/position';
import { getPositionsForMidi } from '../../src/music/fretmap';
import { STANDARD_TUNING } from '../../src/music/tuning';
import type { NoteObservation, PositionInference } from '../../src/types/position';

const T = STANDARD_TUNING;

function seq(midis: number[], dt = 0.5, fretCount = 24): PositionInference[] {
  const obs: NoteObservation[] = midis.map((m, i) => ({ midi: m, onsetTime: i * dt }));
  return inferSequence(obs, T, fretCount);
}

const pos = (r: PositionInference) => `${r.primary!.position.stringNumber}/${r.primary!.position.fret}`;

describe('Etapa B: candidatas e estados', () => {
  it('nota com posição única (E2): estado unique, confiança 1, sem alternativas', () => {
    const [r] = seq([40]);
    expect(r!.state).toBe('unique');
    expect(r!.candidates).toHaveLength(1);
    expect(pos(r!)).toBe('6/0');
    expect(r!.positionConfidence).toBe(1);
    expect(r!.margin).toBe(0);
  });

  it('nota fora do alcance: unknown, sem candidata e sem confiança', () => {
    const [r] = seq([90]);
    expect(r!.state).toBe('unknown');
    expect(r!.primary).toBeNull();
    expect(r!.candidates).toEqual([]);
    expect(r!.positionConfidence).toBe(0);
  });

  it('as candidatas são exatamente as posições geométricas, sem inventar nem perder nenhuma', () => {
    for (const midi of [40, 45, 52, 59, 64, 65, 72, 80]) {
      const [r] = seq([midi]);
      const geo = getPositionsForMidi(midi, T, 24)
        .map((p) => `${p.stringIndex}:${p.fret}`)
        .sort();
      const got = r!.candidates.map((c) => `${c.position.stringIndex}:${c.position.fret}`).sort();
      expect(got).toEqual(geo);
    }
  });

  it('primeira nota sem contexto: sempre ambiguous, confiança no teto sem contexto', () => {
    for (const midi of [45, 52, 64, 65, 72]) {
      const [r] = seq([midi]);
      expect(r!.hasContext).toBe(false);
      expect(r!.state).toBe('ambiguous');
      expect(r!.positionConfidence).toBeLessThanOrEqual(DEFAULT_INFERENCE_CONFIG.noContextConfidenceCap);
    }
  });

  it('pontuações ordenadas, em [0,1], e confiança limitada', () => {
    const results = seq([48, 50, 52, 53, 55, 57, 59, 60, 64, 65, 72, 40, 88]);
    for (const r of results) {
      for (let i = 1; i < r.candidates.length; i++) {
        expect(r.candidates[i - 1]!.score).toBeGreaterThanOrEqual(r.candidates[i]!.score - 1e-9);
      }
      for (const c of r.candidates) {
        expect(c.score).toBeGreaterThanOrEqual(0);
        expect(c.score).toBeLessThanOrEqual(1);
      }
      expect(r.positionConfidence).toBeGreaterThanOrEqual(0);
      expect(r.positionConfidence).toBeLessThanOrEqual(1);
      if (r.state === 'confident') {
        expect(r.positionConfidence).toBeLessThanOrEqual(DEFAULT_INFERENCE_CONFIG.maxInferredConfidence);
      }
    }
  });

  it('é determinístico: a mesma sequência dá exatamente o mesmo resultado', () => {
    expect(seq([48, 50, 52, 53, 55, 57, 59, 60])).toEqual(seq([48, 50, 52, 53, 55, 57, 59, 60]));
  });

  it('empates são resolvidos pela ordem das cordas, nunca aleatoriamente', () => {
    const r = rankPositions({
      obs: { midi: 65, onsetTime: 0 },
      tuning: T,
      fretCount: 24,
      history: [],
      config: { ...DEFAULT_INFERENCE_CONFIG, weightRegion: 0 },
    });
    expect(r.candidates.every((c) => c.score === 0)).toBe(true);
    expect(r.candidates.map((c) => c.position.stringIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('cada candidata expõe todos os fatores; sem contexto e sem evidência, mão e externo são null', () => {
    const [r] = seq([65]);
    for (const c of r!.candidates) {
      expect(c.factors.map((f) => f.id)).toEqual(['region', 'handShift', 'stringCohesion', 'external']);
      expect(c.factors.find((f) => f.id === 'external')!.score).toBeNull();
      expect(c.factors.find((f) => f.id === 'handShift')!.score).toBeNull();
    }
  });

  it('evidência externa (sensor, visão, correção) altera a escolha sem depender do áudio', () => {
    const withEvidence = rankPositions({
      obs: { midi: 65, onsetTime: 0, evidence: [{ source: 'teste', stringIndex: 3, fret: 15, support: 1 }] },
      tuning: T,
      fretCount: 24,
      history: [],
    });
    expect(withEvidence.primary!.position.stringNumber).toBe(4);
    expect(withEvidence.primary!.position.fret).toBe(15);
  });

  it('funciona com outra afinação (Drop D) e outro número de casas', () => {
    const dropD = {
      ...T,
      id: 'drop-d',
      strings: T.strings.map((s) => (s.stringNumber === 6 ? { ...s, midi: 38 } : s)),
    };
    const r = inferSequence([{ midi: 38, onsetTime: 0 }], dropD, 22);
    expect(r[0]!.state).toBe('unique');
    expect(pos(r[0]!)).toBe('6/0');
    expect(seq([64], 0.5, 12)[0]!.candidates).toHaveLength(3);
  });
});
