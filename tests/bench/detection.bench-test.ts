import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { midiToFrequency, midiToScientificName } from '../../src/music/notes';
import { WINDOW_SIZES } from '../../src/types/audio';
import {
  DISTORTED_HARMONICS,
  GUITAR_HARMONICS,
  SAMPLE_RATE,
  WEAK_FUNDAMENTAL,
  addNoiseSnr,
  runEngine,
  synthesize,
} from '../helpers/signals';

/**
 * Benchmark do detector com SINAIS SINTÉTICOS. Mede o algoritmo, não uma guitarra real.
 * Saída: docs/benchmark-results.json (consumido por docs/detection.md).
 */

interface Row {
  windowSize: number;
  [k: string]: number | string;
}

const LOW = [40, 41, 42, 43, 44, 45, 47, 50]; // E2..D3
const SCENARIOS: { name: string; harmonics: number[]; snrDb: number | null }[] = [
  { name: 'limpo', harmonics: GUITAR_HARMONICS, snrDb: null },
  { name: 'ruido-20dB', harmonics: GUITAR_HARMONICS, snrDb: 20 },
  { name: 'ruido-10dB', harmonics: GUITAR_HARMONICS, snrDb: 10 },
  { name: 'ruido-0dB', harmonics: GUITAR_HARMONICS, snrDb: 0 },
  { name: 'fundamental-fraca', harmonics: WEAK_FUNDAMENTAL, snrDb: null },
  { name: 'distorcido', harmonics: DISTORTED_HARMONICS, snrDb: null },
];

function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function noteSignal(midi: number, harmonics: number[], snrDb: number | null, seed: number) {
  let s = synthesize([{ frequency: midiToFrequency(midi), start: 0.2, duration: 1.0, harmonics }], 1.5);
  if (snrDb !== null) s = addNoiseSnr(s, snrDb, seed);
  return s;
}

describe('benchmark de detecção', () => {
  it('gera docs/benchmark-results.json', () => {
    const accuracy: Row[] = [];
    const latency: Row[] = [];
    const cpu: Row[] = [];
    const rapid: Row[] = [];

    for (const windowSize of WINDOW_SIZES) {
      // Exatidão por cenário: faixa completa E2..E6 e faixa grave E2..D3.
      for (const sc of SCENARIOS) {
        for (const [label, range] of [
          ['E2-E6', Array.from({ length: 49 }, (_, i) => 40 + i)],
          ['E2-D3', LOW],
        ] as const) {
          let ok = 0;
          let octave = 0;
          let missed = 0;
          let wrong = 0;
          let extra = 0;
          const errCents: number[] = [];
          range.forEach((midi, i) => {
            const r = runEngine(noteSignal(midi, sc.harmonics, sc.snrDb, 100 + i), { windowSize });
            const first = r.onsets[0];
            if (!first) missed++;
            else if (first.midi === midi) {
              ok++;
              errCents.push(Math.abs(first.cents));
            } else if ((first.midi - midi) % 12 === 0) octave++;
            else wrong++;
            extra += Math.max(0, r.onsets.length - 1);
          });
          accuracy.push({
            windowSize,
            scenario: sc.name,
            range: label,
            notes: range.length,
            correct: ok,
            octaveErrors: octave,
            otherWrong: wrong,
            missed,
            extraEvents: extra,
            medianAbsCents: Number(median(errCents).toFixed(2)),
          });
        }
      }

      // Latência por nota: tempo entre o início real da nota (0,2 s) e o evento.
      for (const midi of [40, 45, 52, 64, 76, 88]) {
        const times: number[] = [];
        for (let rep = 0; rep < 5; rep++) {
          const sig = synthesize(
            [{ frequency: midiToFrequency(midi), start: 0.2 + rep * 0.0021, duration: 1.0, harmonics: GUITAR_HARMONICS }],
            1.5,
          );
          const r = runEngine(sig, { windowSize });
          const o = r.onsets[0];
          if (o) times.push((o.time - (0.2 + rep * 0.0021)) * 1000);
        }
        latency.push({
          windowSize,
          note: midiToScientificName(midi),
          structuralWindowMs: Number(((windowSize / SAMPLE_RATE) * 1000).toFixed(1)),
          trueOnsetToEventMs: Number(median(times).toFixed(1)),
        });
      }


      // Passagem rápida: 8 notas alternadas (E3 A3 C4 E3 ...) de duração fixa, uma após a outra com
      // pausa de 30 ms. Conta quantas das 8 foram detectadas, na ordem certa, e eventos extras.
      for (const ms of [80, 120, 160, 250]) {
        const seq = [52, 57, 60, 52, 57, 60, 52, 57];
        const gap = 0.03;
        const dur = ms / 1000;
        const specs = seq.map((m, i) => ({
          frequency: midiToFrequency(m),
          start: 0.2 + i * (dur + gap),
          duration: dur,
          harmonics: GUITAR_HARMONICS,
        }));
        const r = runEngine(synthesize(specs, 0.2 + seq.length * (dur + gap) + 0.5), { windowSize });
        const got = r.onsets.map((e) => e.midi);
        let hits = 0;
        let j = 0;
        for (const m of got) if (j < seq.length && m === seq[j]) { hits++; j++; }
        rapid.push({
          windowSize,
          noteMs: ms,
          expected: seq.length,
          detectedInOrder: hits,
          totalEvents: got.length,
          extraEvents: Math.max(0, got.length - hits),
        });
      }
      // Custo de CPU: 20 s de uma sequência de notas, em blocos de 10 ms (como o worklet).
      const notes = Array.from({ length: 20 }, (_, i) => ({
        frequency: midiToFrequency(40 + ((i * 7) % 36)),
        start: i * 1.0 + 0.05,
        duration: 0.9,
        harmonics: GUITAR_HARMONICS,
      }));
      const signal = synthesize(notes, 20);
      runEngine(signal.slice(0, SAMPLE_RATE * 2), { windowSize }); // aquecimento do JIT
      const t0 = performance.now();
      const run = runEngine(signal, { windowSize });
      const wall = performance.now() - t0;
      const procs = run.frames.map((f) => f.processingMs).sort((a, b) => a - b);
      cpu.push({
        windowSize,
        audioSeconds: 20,
        wallMs: Number(wall.toFixed(0)),
        realtimeFactor: Number((wall / 20000).toFixed(4)),
        frames: run.frames.length,
        frameMeanMs: Number((procs.reduce((a, b) => a + b, 0) / procs.length).toFixed(3)),
        frameP99Ms: Number(procs[Math.floor(procs.length * 0.99)]!.toFixed(3)),
        frameMaxMs: Number(procs[procs.length - 1]!.toFixed(3)),
      });
    }

    mkdirSync('docs', { recursive: true });
    writeFileSync(
      'docs/benchmark-results.json',
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          node: process.version,
          sampleRate: SAMPLE_RATE,
          note: 'Sinais sintéticos. Não valida reconhecimento com guitarra real.',
          accuracy,
          latency,
          rapid,
          cpu,
        },
        null,
        2,
      ),
    );
    console.table(accuracy.filter((r) => r.scenario === 'ruido-0dB'));
    console.table(rapid);
    console.table(cpu);
  });
});
