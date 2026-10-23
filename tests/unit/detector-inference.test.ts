import { describe, expect, it } from 'vitest';
import { PositionInferrer } from '../../src/inference/position';
import { midiToFrequency } from '../../src/music/notes';
import { STANDARD_TUNING } from '../../src/music/tuning';
import { SAMPLE_RATE, runEngine, synthesize, addNoiseSnr } from '../helpers/signals';

/**
 * Áudio sintético -> detector real -> inferência de posição. Valida o encadeamento Etapa A -> Etapa B,
 * não o reconhecimento com guitarra real (ver docs/manual-validation.md).
 */
function play(midis: number[], gap = 0.6, noteLen = 0.45, snr?: number) {
  const notes = midis.map((m, i) => ({
    frequency: midiToFrequency(m),
    start: 0.2 + i * gap,
    duration: noteLen,
    decay: 0.5,
  }));
  const total = 0.2 + midis.length * gap + 0.4;
  let signal = synthesize(notes, total, SAMPLE_RATE);
  if (snr !== undefined) signal = addNoiseSnr(signal, snr, 5);
  const { onsets } = runEngine(signal, { windowSize: 4096 });
  const inferrer = new PositionInferrer(STANDARD_TUNING, 24);
  const detected = onsets.map((e) => e.midi);
  const inferences = onsets.map((e) => inferrer.observe({ midi: e.midi, onsetTime: e.onsetTime }));
  return { detected, inferences };
}

describe('Detector -> inferência de posição (sinais sintéticos)', () => {
  it('uma escala de dó maior aberta é detectada e posicionada sem saltos absurdos', () => {
    const scale = [48, 50, 52, 53, 55, 57, 59, 60];
    const { detected, inferences } = play(scale);
    expect(detected).toEqual(scale);
    const frets = inferences.map((i) => i.primary!.position.fret);
    for (let k = 1; k < frets.length; k++) expect(Math.abs(frets[k]! - frets[k - 1]!)).toBeLessThanOrEqual(6);
    expect(inferences[0]!.state).toBe('ambiguous'); // primeira nota: sem contexto
  });

  it('mesma nota repetida: cada ataque vira uma observação e a posição se mantém', () => {
    const { detected, inferences } = play([65, 65, 65]);
    expect(detected).toEqual([65, 65, 65]);
    const labels = inferences.map((i) => `${i.primary!.position.stringIndex}/${i.primary!.position.fret}`);
    expect(new Set(labels).size).toBe(1);
  });

  it('com ruído (SNR 20 dB) o encadeamento continua coerente', () => {
    const scale = [64, 66, 68, 69, 71];
    const { detected, inferences } = play(scale, 0.6, 0.45, 20);
    expect(detected).toEqual(scale);
    expect(inferences.every((i) => i.candidates.length > 0)).toBe(true);
  });

  it('as seis cordas soltas: só E2 é posição única; as demais continuam ambíguas sem contexto', () => {
    const opens = [40, 45, 50, 55, 59, 64];
    const states = opens.map((m) => play([m]).inferences[0]!.state);
    expect(states[0]).toBe('unique');
    expect(states.slice(1).every((s) => s === 'ambiguous')).toBe(true);
  });
});
