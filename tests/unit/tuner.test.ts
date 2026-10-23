import { describe, expect, it } from 'vitest';
import {
  IN_TUNE_CENTS,
  TunerSmoother,
  nearestString,
  needleAngle,
  readTuner,
  splitNoteName,
  tuningAdvice,
} from '../../src/music/tuner';
import { frequencyToMidiFloat, midiToFrequency } from '../../src/music/notes';
import { STANDARD_TUNING } from '../../src/music/tuning';
import { runEngine, synthesize } from '../helpers/signals';

const centsUp = (hz: number, cents: number) => hz * Math.pow(2, cents / 1200);

describe('readTuner', () => {
  it('A4 = 440 Hz está afinado, 0 cents', () => {
    const r = readTuner(frequencyToMidiFloat(440));
    expect(r.midi).toBe(69);
    expect(r.cents).toBeCloseTo(0, 6);
    expect(r.inTune).toBe(true);
    expect(r.frequency).toBeCloseTo(440, 6);
    expect(r.targetHz).toBe(440);
  });

  it('+20 cents fica acima e fora da tolerância', () => {
    const r = readTuner(frequencyToMidiFloat(centsUp(440, 20)));
    expect(r.cents).toBeCloseTo(20, 4);
    expect(r.inTune).toBe(false);
  });

  it('a tolerância é simétrica e inclusiva em 5 cents', () => {
    expect(readTuner(69 + IN_TUNE_CENTS / 100).inTune).toBe(true);
    expect(readTuner(69 - IN_TUNE_CENTS / 100).inTune).toBe(true);
    expect(readTuner(69 + 0.06).inTune).toBe(false);
  });

  it('o desvio sempre fica entre −50 e +50 cents', () => {
    for (let f = 60; f < 80; f += 0.037) {
      const r = readTuner(f);
      expect(Math.abs(r.cents)).toBeLessThanOrEqual(50.0000001);
    }
  });

  it('referência A4 configurável', () => {
    const r = readTuner(frequencyToMidiFloat(432, 432), 432);
    expect(r.midi).toBe(69);
    expect(r.cents).toBeCloseTo(0, 6);
    expect(r.targetHz).toBe(432);
  });
});

describe('splitNoteName / tuningAdvice / needleAngle', () => {
  it('divide letra, sustenido e oitava', () => {
    expect(splitNoteName(69)).toEqual({ letter: 'A', sharp: false, octave: 4 });
    expect(splitNoteName(70)).toEqual({ letter: 'A', sharp: true, octave: 4 });
    expect(splitNoteName(40)).toEqual({ letter: 'E', sharp: false, octave: 2 });
    expect(splitNoteName(54)).toEqual({ letter: 'F', sharp: true, octave: 3 });
  });

  it('orientação: abaixo = apertar, acima = afrouxar', () => {
    expect(tuningAdvice(0)).toBe('in-tune');
    expect(tuningAdvice(-5)).toBe('in-tune');
    expect(tuningAdvice(-12)).toBe('too-low');
    expect(tuningAdvice(30)).toBe('too-high');
  });

  it('ponteiro: 0 no centro, simétrico e limitado à escala', () => {
    expect(needleAngle(0)).toBe(0);
    expect(needleAngle(25)).toBeCloseTo(25, 6);
    expect(needleAngle(-25)).toBeCloseTo(-25, 6);
    expect(needleAngle(999)).toBe(50);
    expect(needleAngle(-999)).toBe(-50);
  });
});

describe('nearestString (sugestão pela altura)', () => {
  it('as seis cordas soltas apontam para si mesmas com 0 cents', () => {
    for (const s of STANDARD_TUNING.strings) {
      const n = nearestString(s.midi, STANDARD_TUNING)!;
      expect(n.stringNumber).toBe(s.stringNumber);
      expect(n.cents).toBeCloseTo(0, 6);
    }
  });

  it('G3 desafinada 100 cents abaixo (F#3) sugere a 3ª corda a −100 cents', () => {
    const n = nearestString(frequencyToMidiFloat(midiToFrequency(54)), STANDARD_TUNING)!;
    expect(n.stringNumber).toBe(3);
    expect(n.name).toBe('G3');
    expect(n.cents).toBeCloseTo(-100, 6);
  });

  it('nota longe de qualquer corda solta não sugere nenhuma', () => {
    // F3 (53) fica a 300 cents de D3 e a 200 de G3? G3=55: 200 cents -> fora de 150.
    expect(nearestString(53, STANDARD_TUNING)).toBeNull();
  });
});

describe('TunerSmoother', () => {
  it('ignora estimativas com clareza baixa ou sem altura', () => {
    const s = new TunerSmoother();
    expect(s.push(440, 0.3, 0)).toBeNull();
    expect(s.push(null, 0, 10)).toBeNull();
  });

  it('a mediana descarta um valor isolado discrepante', () => {
    const s = new TunerSmoother({ size: 5 });
    let last = null;
    for (const [i, f] of [440, 440.1, 439.9, 440, 440.05].entries()) last = s.push(f, 0.95, i * 10);
    expect(Math.abs(last!.cents)).toBeLessThan(1);
    last = s.push(centsUp(440, 30), 0.95, 60); // um quadro ruim (30 cents)
    expect(Math.abs(last!.cents)).toBeLessThan(2);
  });

  it('mantém a última leitura por holdMs e depois zera', () => {
    const s = new TunerSmoother({ holdMs: 500 });
    s.push(440, 0.95, 0);
    const held = s.push(null, 0, 300);
    expect(held?.held).toBe(true);
    expect(held?.midi).toBe(69);
    expect(s.push(null, 0, 600)).toBeNull();
    expect(s.push(null, 0, 700)).toBeNull();
  });

  it('mudança de nota (salto > 0,6 semitom) reinicia o histórico sem arrastar a nota antiga', () => {
    const s = new TunerSmoother({ size: 5 });
    for (let i = 0; i < 5; i++) s.push(440, 0.95, i * 10);
    const r = s.push(midiToFrequency(71), 0.95, 60)!;
    expect(r.midi).toBe(71);
    expect(Math.abs(r.cents)).toBeLessThan(0.01);
  });
});

describe('afinador com o detector real (sinais sintéticos)', () => {
  // Usa o mesmo PitchEngine do rastreador e passa os quadros pelo suavizador.
  function tune(hz: number, windowSize: number) {
    const sig = synthesize([{ frequency: hz, start: 0.2, duration: 1.6, amplitude: 0.4, decay: 3 }], 2);
    const { frames } = runEngine(sig, { windowSize });
    const s = new TunerSmoother();
    let last = null;
    for (const f of frames) {
      const r = s.push(f.frequency, f.clarity, f.time * 1000);
      if (r && !r.held && f.time > 1.0 && f.time < 1.6) last = r;
    }
    return last;
  }

  const strings: [string, number][] = [
    ['E2', 82.41],
    ['A2', 110],
    ['D3', 146.83],
    ['G3', 196],
    ['B3', 246.94],
    ['E4', 329.63],
  ];

  describe.each([2048, 4096, 8192])('janela %i', (win) => {
    it.each(strings)('%s afinada: nota correta e desvio dentro da tolerância', (_name, hz) => {
      const r = tune(hz, win);
      expect(r).not.toBeNull();
      expect(r!.midi).toBe(Math.round(frequencyToMidiFloat(hz)));
      expect(Math.abs(r!.cents)).toBeLessThanOrEqual(IN_TUNE_CENTS);
    });

    it('G3 +20 cents é reconhecida como alta, fora da tolerância', () => {
      const r = tune(centsUp(196, 20), win);
      expect(r!.midi).toBe(55);
      expect(r!.cents).toBeGreaterThan(14);
      expect(r!.cents).toBeLessThan(26);
      expect(r!.inTune).toBe(false);
    });

    it('G3 −30 cents é reconhecida como baixa', () => {
      const r = tune(centsUp(196, -30), win);
      expect(r!.midi).toBe(55);
      expect(r!.cents).toBeLessThan(-24);
      expect(r!.cents).toBeGreaterThan(-36);
    });

    it('G3 desafinada −70 cents vira F#3 com +30 cents (cromático mais próximo)', () => {
      const r = tune(centsUp(196, -70), win);
      expect(r!.midi).toBe(54);
      expect(r!.cents).toBeGreaterThan(24);
      expect(r!.cents).toBeLessThan(36);
    });
  });
});
