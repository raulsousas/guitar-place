import { describe, expect, it } from 'vitest';
import { midiToFrequency } from '../../src/music/notes';
import { STANDARD_TUNING } from '../../src/music/tuning';
import { WINDOW_SIZES } from '../../src/types/audio';
import {
  DISTORTED_HARMONICS,
  WEAK_FUNDAMENTAL,
  type NoteSpec,
  addNoiseSnr,
  centsBetween,
  noiseFloor,
  runEngine,
  synthesize,
} from '../helpers/signals';

const E2 = midiToFrequency(40);

function firstOnset(freq: number, windowSize: number, extra: Partial<NoteSpec> = {}) {
  const sig = synthesize([{ start: 0.2, duration: 1.2, ...extra, frequency: freq }], 1.8);
  return runEngine(sig, { windowSize });
}

describe.each(WINDOW_SIZES)('detector com janela de %i amostras', (windowSize) => {
  it('identifica as seis cordas soltas', () => {
    for (const s of STANDARD_TUNING.strings) {
      const r = firstOnset(midiToFrequency(s.midi), windowSize);
      expect(r.onsets.length, `corda ${s.midi}`).toBeGreaterThanOrEqual(1);
      expect(r.onsets[0]!.midi).toBe(s.midi);
      expect(Math.abs(r.onsets[0]!.cents)).toBeLessThan(10);
    }
  });

  it('cobre E2 a E6 semitom por semitom sem erro de oitava', { timeout: 60000 }, () => {
    const wrong: string[] = [];
    for (let midi = 40; midi <= 88; midi++) {
      const r = firstOnset(midiToFrequency(midi), windowSize);
      const first = r.onsets[0];
      if (!first || first.midi !== midi) wrong.push(`${midi}->${first?.midi ?? 'nenhum'}`);
    }
    expect(wrong).toEqual([]);
  });

  it('gera um único ataque para uma nota sustentada', () => {
    const r = firstOnset(midiToFrequency(52), windowSize, { decay: Infinity });
    expect(r.events.filter((e) => e.type === 'onset')).toHaveLength(1);
    expect(r.events.filter((e) => e.type === 'change')).toHaveLength(0);
  });

  it('não gera evento em silêncio digital nem em ruído de fundo baixo', () => {
    expect(runEngine(new Float32Array(48000 * 2), { windowSize }).events).toHaveLength(0);
    expect(runEngine(noiseFloor(2, -70), { windowSize }).events).toHaveLength(0);
  });

  it('não gera evento com DC puro', () => {
    const dc = new Float32Array(48000 * 2).fill(0.3);
    expect(runEngine(dc, { windowSize }).events).toHaveLength(0);
  });

  it('rejeita ruído branco forte como nota', () => {
    const r = runEngine(noiseFloor(2, -20), { windowSize });
    expect(r.onsets).toHaveLength(0);
  });

  it('detecta nota com ruído a 20 dB de relação sinal/ruído', () => {
    const sig = addNoiseSnr(synthesize([{ frequency: E2 * 2, start: 0.2, duration: 1.2 }], 1.8), 20);
    const r = runEngine(sig, { windowSize });
    expect(r.onsets[0]?.midi).toBe(52);
  });

  it('não se perde com fundamental fraca (harmônicos dominantes)', () => {
    const r = firstOnset(midiToFrequency(45), windowSize, { harmonics: WEAK_FUNDAMENTAL });
    expect(r.onsets[0]?.midi).toBe(45);
  });

  it('mantém a altura com espectro de guitarra distorcida', () => {
    const r = firstOnset(midiToFrequency(52), windowSize, { harmonics: DISTORTED_HARMONICS });
    expect(r.onsets[0]?.midi).toBe(52);
  });

  it('mantém uma única nota durante vibrato de ±40 cents', () => {
    const r = firstOnset(midiToFrequency(64), windowSize, {
      vibratoCents: 40,
      decay: Infinity,
    });
    expect(r.onsets).toHaveLength(1);
    expect(r.onsets[0]!.midi).toBe(64);
  });

  it('separa duas notas diferentes em sequência', () => {
    const sig = synthesize(
      [
        { frequency: midiToFrequency(52), start: 0.2, duration: 0.5 },
        { frequency: midiToFrequency(57), start: 0.8, duration: 0.5 },
      ],
      1.6,
    );
    const r = runEngine(sig, { windowSize });
    expect(r.onsets.map((e) => e.midi)).toEqual([52, 57]);
  });

  it('separa ataques repetidos da mesma nota', () => {
    const notes = [0.2, 0.7, 1.2, 1.7].map((start) => ({
      frequency: midiToFrequency(55),
      start,
      duration: 0.45,
    }));
    const r = runEngine(synthesize(notes, 2.3), { windowSize });
    expect(r.onsets.map((e) => e.midi)).toEqual([55, 55, 55, 55]);
  });

  it('segue notas encadeadas sem pausa (ligado) e não repete a anterior', () => {
    const sig = synthesize(
      [
        { frequency: midiToFrequency(52), start: 0.2, duration: 0.6, decay: Infinity },
        { frequency: midiToFrequency(55), start: 0.8, duration: 0.6, decay: Infinity },
      ],
      1.6,
    );
    const r = runEngine(sig, { windowSize });
    expect(r.onsets.map((e) => e.midi)).toEqual([52, 55]);
  });

  it('suporta amplitude variando 30 dB entre notas', () => {
    const sig = synthesize(
      [
        { frequency: midiToFrequency(52), start: 0.2, duration: 0.5, amplitude: 0.6 },
        { frequency: midiToFrequency(59), start: 0.9, duration: 0.5, amplitude: 0.02 },
      ],
      1.6,
    );
    const r = runEngine(sig, { windowSize });
    expect(r.onsets.map((e) => e.midi)).toEqual([52, 59]);
  });

  it('mede o atraso do ataque até o evento', () => {
    const r = firstOnset(midiToFrequency(52), windowSize);
    const ev = r.onsets[0]!;
    const trueOnset = 0.2;
    const latency = (ev.time - trueOnset) * 1000;
    // O atraso real inclui a janela estrutural; deve ser finito e menor que 1 s.
    expect(latency).toBeGreaterThan(0);
    expect(latency).toBeLessThan(1000);
    expect(Math.abs(centsBetween(ev.frequency, midiToFrequency(52)))).toBeLessThan(10);
  });
});
