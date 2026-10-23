import { describe, expect, it } from 'vitest';
import { DEFAULT_INFERENCE_CONFIG } from '../../src/inference/config';
import { PositionInferrer, inferSequence, rankPositions } from '../../src/inference/position';
import { STANDARD_TUNING } from '../../src/music/tuning';
import type { HistoryEntry, NoteObservation, PositionInference } from '../../src/types/position';

const T = STANDARD_TUNING;

function seq(midis: number[], dt = 0.5): PositionInference[] {
  const obs: NoteObservation[] = midis.map((m, i) => ({ midi: m, onsetTime: i * dt }));
  return inferSequence(obs, T, 24);
}

const pos = (r: PositionInference) => `${r.primary!.position.stringNumber}/${r.primary!.position.fret}`;

describe('Etapa B: contexto temporal', () => {
  it('a mesma nota repetida herda a posição da primeira e passa a ter contexto', () => {
    const r = seq([65, 65, 65], 0.3);
    expect(r[0]!.state).toBe('ambiguous');
    expect(r[1]!.hasContext).toBe(true);
    expect(pos(r[1]!)).toBe(pos(r[0]!));
    expect(pos(r[2]!)).toBe(pos(r[0]!));
  });

  it('escala em uma posição (dó maior aberta): sem saltos absurdos de mão', () => {
    const frets = seq([48, 50, 52, 53, 55, 57, 59, 60]).map((x) => x.primary!.position.fret);
    for (let i = 1; i < frets.length; i++) {
      expect(Math.abs(frets[i]! - frets[i - 1]!)).toBeLessThanOrEqual(6);
    }
  });

  it('escala aguda na região da 12ª casa: o contexto mantém a 1ª corda', () => {
    const r = seq([76, 79, 81, 83, 84, 86, 88]);
    expect(r.map((x) => x.primary!.position.stringNumber)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(r.map((x) => x.primary!.position.fret)).toEqual([12, 15, 17, 19, 20, 22, 24]);
  });

  it('a mesma nota (F4) vai para cordas diferentes conforme a região da mão no contexto', () => {
    const high = seq([77, 79, 81, 65]);
    const low = seq([45, 47, 48, 65]);
    expect(pos(high[3]!)).not.toBe(pos(low[3]!));
    // Mesma altura: a mão que estava na região aguda fica nela; a que estava perto da pestana também.
    expect(high[3]!.primary!.position.fret).toBeGreaterThan(low[3]!.primary!.position.fret + 5);
  });

  it('o mesmo salto é menos penalizado quando há mais tempo entre as notas', () => {
    const hist: HistoryEntry[] = [{ midi: 52, onsetTime: 0, stringIndex: 3, fret: 2, weight: 1 }];
    const handScore = (onsetTime: number) =>
      rankPositions({ obs: { midi: 65, onsetTime }, tuning: T, fretCount: 24, history: hist })
        .candidates.find((c) => c.position.stringNumber === 5)! // 5ª corda, casa 20: longe da mão
        .factors.find((f) => f.id === 'handShift')!.score!;
    expect(handScore(3)).toBeGreaterThan(handScore(0.1));
  });

  it('corda solta tem pontuação neutra no fator de mão (não depende de onde a mão está)', () => {
    const hist: HistoryEntry[] = [{ midi: 70, onsetTime: 0, stringIndex: 1, fret: 11, weight: 1 }];
    const r = rankPositions({ obs: { midi: 64, onsetTime: 0.5 }, tuning: T, fretCount: 24, history: hist });
    const open = r.candidates.find((c) => c.position.fret === 0)!;
    expect(open.factors.find((f) => f.id === 'handShift')!.score).toBe(DEFAULT_INFERENCE_CONFIG.openStringHandScore);
  });

  it('pausa longa descarta o contexto: a nota volta a ser ambiguous', () => {
    const r = seq([57, 59], 10); // 10 s > limite de 4 s
    expect(r[1]!.hasContext).toBe(false);
    expect(r[1]!.state).toBe('ambiguous');
  });

  it('contexto de nota ambígua pesa menos: a coesão de corda acompanha o peso da nota anterior', () => {
    // Histórico: nota recente na 1ª corda (peso variável) e nota mais antiga na 4ª corda (peso 1).
    const cohesion = (recentWeight: number) =>
      rankPositions({
        obs: { midi: 67, onsetTime: 1 }, // G4: 1/3, 2/8, 3/12, 4/17...
        tuning: T,
        fretCount: 24,
        history: [
          { midi: 65, onsetTime: 0.5, stringIndex: 0, fret: 1, weight: recentWeight },
          { midi: 55, onsetTime: 0, stringIndex: 3, fret: 5, weight: 1 },
        ],
      })
        .candidates.find((c) => c.position.stringNumber === 1)!
        .factors.find((f) => f.id === 'stringCohesion')!.score!;
    // Quanto menor o peso da nota recente (na 1ª corda), menos a 1ª corda é favorecida.
    expect(cohesion(DEFAULT_INFERENCE_CONFIG.ambiguousHistoryWeight)).toBeLessThan(cohesion(1));
  });
  it('reset limpa o contexto', () => {
    const inferrer = new PositionInferrer(T, 24);
    inferrer.observe({ midi: 65, onsetTime: 0 });
    inferrer.reset();
    expect(inferrer.observe({ midi: 65, onsetTime: 0.2 }).hasContext).toBe(false);
  });

  it('transições de estado: ambiguous na primeira, confident com contexto, ambiguous em nota realmente dúbia', () => {
    const states = seq([48, 50, 52, 53, 55, 57, 59, 60]).map((x) => x.state);
    expect(states[0]).toBe('ambiguous');
    expect(states.slice(1)).toContain('confident');
    expect(states.slice(1)).toContain('ambiguous');
  });

  it('margem pequena entre as duas melhores gera ambiguous com confiança baixa', () => {
    const last = seq([48, 50, 52, 53, 55, 57]).at(-1)!;
    expect(last.margin).toBeLessThan(DEFAULT_INFERENCE_CONFIG.confidentMargin);
    expect(last.state).toBe('ambiguous');
    expect(last.positionConfidence).toBeLessThanOrEqual(0.5);
  });
});
