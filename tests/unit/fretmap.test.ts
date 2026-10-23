import { describe, expect, it } from 'vitest';
import { buildFretMap, fretMidi, getPositionsForMidi, playableRange } from '../../src/music/fretmap';
import { frequencyToNote, midiToFrequency, midiToPtName, midiToScientificName } from '../../src/music/notes';
import { STANDARD_TUNING } from '../../src/music/tuning';
import type { Tuning } from '../../src/types/music';
import { createLayout, fretCenterX, fretEdgeX, positionXY, stringY } from '../../src/fretboard/layout';

const OPEN_HZ: [number, string, number][] = [
  [1, 'E4', 329.63],
  [2, 'B3', 246.94],
  [3, 'G3', 196.0],
  [4, 'D3', 146.83],
  [5, 'A2', 110.0],
  [6, 'E2', 82.41],
];

describe('frequência <-> nota', () => {
  it('ida e volta MIDI -> Hz -> MIDI para a faixa da guitarra', () => {
    for (let midi = 40; midi <= 88; midi++) {
      const n = frequencyToNote(midiToFrequency(midi));
      expect(n.midi).toBe(midi);
      expect(Math.abs(n.cents)).toBeLessThan(1e-6);
    }
  });

  it('A4 de referência configurável desloca todas as frequências', () => {
    expect(midiToFrequency(69, 432)).toBe(432);
    expect(frequencyToNote(432, 432).midi).toBe(69);
    expect(frequencyToNote(432, 440).cents).toBeCloseTo(-31.77, 1);
  });

  it('nomes em português com oitava', () => {
    expect(midiToPtName(65)).toBe('Fá (F4)');
    expect(midiToPtName(40)).toBe('Mi (E2)');
  });
});

describe('mapa de casas da afinação padrão', () => {
  const map = buildFretMap(STANDARD_TUNING, 24);

  it('tem 6 cordas e 25 posições (casa 0..24) por corda', () => {
    expect(map).toHaveLength(6);
    for (const row of map) expect(row).toHaveLength(25);
  });

  it.each(OPEN_HZ)('corda solta %i = %s ≈ %f Hz', (n, name, hz) => {
    const row = map.find((r) => r[0]!.stringNumber === n)!;
    expect(row[0]!.name).toBe(name);
    expect(row[0]!.frequency).toBeCloseTo(hz, 2);
  });

  it('cada casa sobe exatamente um semitom (razão 2^(1/12)) em todas as cordas', () => {
    for (const row of map) {
      for (let f = 1; f < row.length; f++) {
        expect(row[f]!.midi).toBe(row[f - 1]!.midi + 1);
        expect(row[f]!.frequency / row[f - 1]!.frequency).toBeCloseTo(Math.pow(2, 1 / 12), 10);
      }
    }
  });

  it('a casa 12 é a oitava da corda solta (dobro da frequência)', () => {
    for (const row of map) expect(row[12]!.frequency / row[0]!.frequency).toBeCloseTo(2, 10);
  });

  it('cobre todas as 150 combinações corda x casa com nome e frequência coerentes', () => {
    let count = 0;
    for (const row of map) {
      for (const p of row) {
        count++;
        expect(p.midi).toBe(fretMidi(STANDARD_TUNING.strings[p.stringIndex]!.midi, p.fret));
        expect(p.name).toBe(midiToScientificName(p.midi));
        expect(frequencyToNote(p.frequency).midi).toBe(p.midi);
      }
    }
    expect(count).toBe(150);
  });

  it('referência da imagem: 1ª corda, 1ª casa = Fá (F4)', () => {
    expect(map[0]![1]!.name).toBe('F4');
    expect(midiToPtName(map[0]![1]!.midi)).toBe('Fá (F4)');
  });

  it.each([12, 21, 22, 24])('%i casas: tamanho do mapa e última casa corretos', (n) => {
    const m = buildFretMap(STANDARD_TUNING, n);
    expect(m[0]).toHaveLength(n + 1);
    expect(m[5]![n]!.midi).toBe(40 + n);
  });

  it('quantidade de casas inválida é rejeitada', () => {
    expect(() => buildFretMap(STANDARD_TUNING, 0)).toThrow(RangeError);
    expect(() => buildFretMap(STANDARD_TUNING, 12.5)).toThrow(RangeError);
    expect(() => getPositionsForMidi(60, STANDARD_TUNING, 100)).toThrow(RangeError);
  });
});

describe('getPositionsForMidi', () => {
  const fmt = (midi: number, frets = 24) =>
    getPositionsForMidi(midi, STANDARD_TUNING, frets).map((p) => `${p.stringNumber}:${p.fret}`);

  it('E2 (corda solta grave) só existe na 6ª corda, casa 0', () => {
    expect(fmt(40)).toEqual(['6:0']);
  });

  it('as seis cordas soltas aparecem como casa 0 na própria corda', () => {
    for (const s of STANDARD_TUNING.strings) {
      const pos = getPositionsForMidi(s.midi, STANDARD_TUNING, 24);
      expect(pos.some((p) => p.stringNumber === s.stringNumber && p.fret === 0)).toBe(true);
    }
  });

  it('E4 tem 6 posições até a casa 24 (uma por corda; verificado contra a afinação)', () => {
    // 1ª:0, 2ª:5, 3ª:9, 4ª:14, 5ª:19, 6ª:24 (E2 + 24 semitons = E4)
    expect(fmt(64)).toEqual(['1:0', '2:5', '3:9', '4:14', '5:19', '6:24']);
  });

  it('E4 com 22 casas perde a posição 6ª:24', () => {
    expect(fmt(64, 22)).toEqual(['1:0', '2:5', '3:9', '4:14', '5:19']);
  });

  it('F4 (imagem de referência): inclui 1ª corda casa 1 e 6ª corda casa 25 fica de fora', () => {
    expect(fmt(65)).toEqual(['1:1', '2:6', '3:10', '4:15', '5:20']);
  });

  it('as posições devolvidas produzem exatamente a nota pedida', () => {
    for (let midi = 40; midi <= 88; midi++) {
      for (const p of getPositionsForMidi(midi, STANDARD_TUNING, 24)) {
        expect(p.midi).toBe(midi);
        expect(STANDARD_TUNING.strings[p.stringIndex]!.midi + p.fret).toBe(midi);
      }
    }
  });

  it('notas fora do alcance não têm candidata', () => {
    expect(fmt(39)).toEqual([]); // abaixo de E2
    expect(fmt(89)).toEqual([]); // acima de E6 (64 + 24 = 88)
    expect(fmt(88)).toEqual(['1:24']);
    expect(fmt(88, 12)).toEqual([]);
  });

  it('nota fracionária não casa com nenhuma posição', () => {
    expect(getPositionsForMidi(64.5, STANDARD_TUNING, 24)).toEqual([]);
  });

  it('a lista não é ordenada por preferência: segue a ordem das cordas', () => {
    const strings = getPositionsForMidi(64, STANDARD_TUNING, 24).map((p) => p.stringNumber);
    expect(strings).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('número de posições por nota é consistente com a soma total do mapa', () => {
    let total = 0;
    for (let midi = 0; midi <= 127; midi++) total += getPositionsForMidi(midi, STANDARD_TUNING, 24).length;
    expect(total).toBe(150);
  });
});

describe('afinação como dado (afinações alternativas no futuro)', () => {
  const dropD: Tuning = {
    id: 'drop-d',
    name: 'Drop D',
    strings: STANDARD_TUNING.strings.map((s) => (s.stringNumber === 6 ? { ...s, midi: 38 } : s)),
  };

  it('Drop D: D2 solta na 6ª corda e E2 na casa 2', () => {
    expect(getPositionsForMidi(38, dropD, 24).map((p) => `${p.stringNumber}:${p.fret}`)).toEqual(['6:0']);
    expect(getPositionsForMidi(40, dropD, 24).map((p) => `${p.stringNumber}:${p.fret}`)).toEqual(['6:2']);
  });

  it('o alcance é derivado da afinação', () => {
    expect(playableRange(STANDARD_TUNING, 24)).toEqual({ minMidi: 40, maxMidi: 88 });
    expect(playableRange(dropD, 22)).toEqual({ minMidi: 38, maxMidi: 86 });
  });
});

describe('layout do braço (coordenadas)', () => {
  it.each([12, 22, 24])('%i casas: trastes monotônicos dentro do braço', (n) => {
    const l = createLayout(n);
    let prev = -Infinity;
    for (let f = 0; f <= n; f++) {
      const x = fretEdgeX(l, f);
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
    expect(fretEdgeX(l, 0)).toBe(l.nutX);
    expect(fretEdgeX(l, n)).toBeCloseTo(l.nutX + l.boardWidth, 8);
  });

  it('o centro da casa fica entre seus trastes e a corda solta fica antes da pestana', () => {
    const l = createLayout(24);
    for (let f = 1; f <= 24; f++) {
      expect(fretCenterX(l, f)).toBeGreaterThan(fretEdgeX(l, f - 1));
      expect(fretCenterX(l, f)).toBeLessThan(fretEdgeX(l, f));
    }
    expect(fretCenterX(l, 0)).toBeLessThan(l.nutX);
  });

  it('as cordas são espaçadas igualmente e a 1ª fica no topo', () => {
    const l = createLayout(24);
    expect(stringY(l, 0)).toBeLessThan(stringY(l, 5));
    for (let i = 1; i < 6; i++) expect(stringY(l, i) - stringY(l, i - 1)).toBe(l.stringGap);
    expect(positionXY(l, 0, 1)).toEqual({ x: fretCenterX(l, 1), y: stringY(l, 0) });
  });

  it('a regra de escala vale: casa 12 a metade do comprimento', () => {
    const l = createLayout(24);
    expect((fretEdgeX(l, 12) - l.nutX) / l.boardWidth).toBeCloseTo((1 - 0.5) / (1 - 0.25), 8);
  });
});
