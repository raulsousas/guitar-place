import { describe, expect, it } from 'vitest';
import { createEngineConfig, sensitivityToOpenDb } from '../../src/dsp/defaults';
import { MpmDetector } from '../../src/dsp/mpm';
import { YinDetector } from '../../src/dsp/yin';
import { EngineHost } from '../../src/audio/engine-host';
import {
  frequencyToMidiFloat,
  frequencyToNote,
  midiToFrequency,
  midiToPtName,
} from '../../src/music/notes';
import type { NoteEvent } from '../../src/types/engine';
import { SAMPLE_RATE, centsBetween, synthesize } from '../helpers/signals';

describe('notas e frequências', () => {
  it('A4 = 440 Hz e as cordas soltas batem com a tabela', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(midiToFrequency(40)).toBeCloseTo(82.41, 2);
    expect(midiToFrequency(64)).toBeCloseTo(329.63, 2);
  });

  it('ida e volta frequência <-> nota é consistente', () => {
    for (let m = 28; m <= 100; m++) {
      expect(frequencyToNote(midiToFrequency(m)).midi).toBe(m);
      expect(frequencyToMidiFloat(midiToFrequency(m))).toBeCloseTo(m, 9);
    }
  });

  it('calcula desvio em cents', () => {
    const sharp = midiToFrequency(52) * Math.pow(2, 25 / 1200);
    const n = frequencyToNote(sharp);
    expect(n.midi).toBe(52);
    expect(n.cents).toBeCloseTo(25, 6);
  });

  it('nomeia em português com a oitava científica', () => {
    expect(midiToPtName(65)).toBe('Fá (F4)');
    expect(midiToPtName(40)).toBe('Mi (E2)');
    expect(midiToPtName(61)).toBe('Dó# (C#4)');
  });

  it('a sensibilidade mapeia para limiares entre -25 e -60 dBFS', () => {
    expect(sensitivityToOpenDb(0)).toBe(-25);
    expect(sensitivityToOpenDb(100)).toBe(-60);
    expect(sensitivityToOpenDb(70)).toBeCloseTo(-49.5, 6);
    expect(sensitivityToOpenDb(-10)).toBe(-25);
    expect(sensitivityToOpenDb(300)).toBe(-60);
  });
});

describe('MPM e YIN (referência)', () => {
  const base = { sampleRate: SAMPLE_RATE, windowSize: 4096, minFrequencyHz: 70, maxFrequencyHz: 1500 };
  const mpm = new MpmDetector({ ...base, cutoff: 0.93 });
  const yin = new YinDetector({ ...base, threshold: 0.15 });

  it('ambos estimam a fundamental com erro pequeno em E2 a E5', () => {
    for (let midi = 40; midi <= 76; midi += 3) {
      const f = midiToFrequency(midi);
      const w = synthesize([{ frequency: f, start: 0, duration: 0.4, decay: Infinity }], 0.4).subarray(0, 4096);
      const a = mpm.detect(w);
      const b = yin.detect(w);
      expect(a, `mpm ${midi}`).not.toBeNull();
      expect(b, `yin ${midi}`).not.toBeNull();
      expect(Math.abs(centsBetween(a!.frequency, f))).toBeLessThan(5);
      expect(Math.abs(centsBetween(b!.frequency, f))).toBeLessThan(15);
    }
  });

  it('devolvem nulo para silêncio', () => {
    expect(mpm.detect(new Float32Array(4096))).toBeNull();
    expect(yin.detect(new Float32Array(4096))).toBeNull();
  });

  it('o limite grave efetivo é max(70 Hz, taxa / (janela/2)): só a janela pequena em taxa alta perde o E2', () => {
    const mk = (sampleRate: number, windowSize: number) =>
      new MpmDetector({ ...base, sampleRate, windowSize, cutoff: 0.93 }).minDetectableHz;
    // 48 kHz: todas as janelas alcançam o piso de 70 Hz configurado.
    for (const w of [2048, 4096, 8192]) expect(mk(48000, w)).toBeCloseTo(70, 0);
    // 96 kHz (dispositivo falso do Chromium): 2048 só alcança ~94 Hz e perde o E2 (82,41 Hz).
    expect(mk(96000, 2048)).toBeGreaterThan(82.41);
    expect(mk(96000, 4096)).toBeLessThan(82.41);
  });
});

describe('EngineHost', () => {
  it('entrega eventos com latência medida e estatísticas coerentes', () => {
    const events: { e: NoteEvent; total: number | null }[] = [];
    let clock = 0;
    const host = new EngineHost(
      createEngineConfig({ sampleRate: SAMPLE_RATE }),
      { onEvent: (e, l) => events.push({ e, total: l?.totalMs ?? null }) },
      () => (clock += 0.05),
    );
    const sig = synthesize([{ frequency: midiToFrequency(52), start: 0.1, duration: 0.8 }], 1.2);
    const block = SAMPLE_RATE / 100;
    for (let i = 0, n = 0; i + block <= sig.length; i += block, n++) {
      host.pushBlock({
        samples: sig.slice(i, i + block),
        endSample: i + block,
        frameTime: (i + block) / SAMPLE_RATE,
        contextNow: (i + block) / SAMPLE_RATE + 0.002,
        receivedAt: n,
      });
    }
    const onset = events.find((x) => x.e.type === 'onset');
    expect(onset?.e.midi).toBe(52);
    expect(onset?.total).toBeGreaterThan(0);
    const s = host.stats();
    expect(s.windowLatencyMs).toBeCloseTo((4096 / SAMPLE_RATE) * 1000, 6);
    expect(s.lastLatency?.totalMs).toBeGreaterThan(0);
    expect(s.sampleRate).toBe(SAMPLE_RATE);
    host.dispose();
  });
});
