import { describe, expect, it } from 'vitest';
import { midiToFrequency, midiToScientificName } from '../../src/music/notes';
import { STANDARD_TUNING } from '../../src/music/tuning';
import { inlayFrets, normalizedFretCenters, normalizedFretPositions } from '../../src/fretboard/geometry';

describe('afinação padrão', () => {
  const expected: [number, string, number][] = [
    [1, 'E4', 329.63],
    [2, 'B3', 246.94],
    [3, 'G3', 196.0],
    [4, 'D3', 146.83],
    [5, 'A2', 110.0],
    [6, 'E2', 82.41],
  ];

  it.each(expected)('corda %i = %s ≈ %f Hz', (n, name, hz) => {
    const s = STANDARD_TUNING.strings.find((x) => x.stringNumber === n)!;
    expect(midiToScientificName(s.midi)).toBe(name);
    expect(midiToFrequency(s.midi)).toBeCloseTo(hz, 2);
  });

  it('A4 = 440 Hz', () => {
    expect(midiToFrequency(69)).toBe(440);
  });
});

describe('geometria do braço', () => {
  it('traste 0 em 0 e último traste em 1, monotônico e com casas decrescentes', () => {
    const p = normalizedFretPositions(24);
    expect(p).toHaveLength(25);
    expect(p[0]).toBe(0);
    expect(p[24]).toBeCloseTo(1, 10);
    const widths = p.slice(1).map((v, i) => v - p[i]!);
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeLessThan(widths[i - 1]!);
  });

  it('o traste 12 fica a 50% da escala', () => {
    const half = normalizedFretPositions(12);
    expect(half[12]).toBeCloseTo(1, 10);
    const full = 1 - Math.pow(2, -24 / 12);
    expect(normalizedFretPositions(24)[12]! * full).toBeCloseTo(0.5, 10);
  });

  it('centros ficam entre os trastes vizinhos', () => {
    const p = normalizedFretPositions(24);
    normalizedFretCenters(24).forEach((c, i) => {
      expect(c).toBeGreaterThan(p[i]!);
      expect(c).toBeLessThan(p[i + 1]!);
    });
  });

  it('marcações respeitam a quantidade de casas', () => {
    expect(inlayFrets(24).map((m) => m.fret)).toEqual([3, 5, 7, 9, 12, 15, 17, 19, 21, 24]);
    expect(inlayFrets(12).map((m) => m.fret)).toEqual([3, 5, 7, 9, 12]);
    expect(inlayFrets(24).filter((m) => m.double).map((m) => m.fret)).toEqual([12, 24]);
  });
});
