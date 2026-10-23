import { describe, expect, it } from 'vitest';
import { createEngineConfig } from '../../src/dsp/defaults';
import { NoteTracker } from '../../src/dsp/note-tracker';
import type { NoteEvent, PitchFrame } from '../../src/types/engine';
import { midiToFrequency } from '../../src/music/notes';

const SR = 48000;
const HOP = 512;
const cfg = createEngineConfig({ sampleRate: SR });
const DT = HOP / SR;

interface F {
  gate: boolean;
  midi?: number;
  clarity?: number;
  db?: number;
  /** Desvio em semitons aplicado à frequência. */
  offset?: number;
}

/** Alimenta o rastreador com quadros descritos e devolve os eventos. */
function run(frames: F[]): NoteEvent[] {
  const tracker = new NoteTracker(cfg);
  const events: NoteEvent[] = [];
  frames.forEach((f, i) => {
    const frame: PitchFrame = {
      time: (i + 1) * DT + 0.1,
      energyDb: f.db ?? (f.gate ? -20 : -90),
      gateOpen: f.gate,
      openDb: -50,
      noiseFloorDb: -90,
      frequency: f.midi !== undefined ? midiToFrequency(f.midi + (f.offset ?? 0)) : null,
      clarity: f.clarity ?? (f.midi !== undefined ? 0.95 : 0),
      processingMs: 0,
    };
    events.push(...tracker.update(frame));
  });
  return events;
}

const rep = (n: number, f: F): F[] => Array.from({ length: n }, () => ({ ...f }));
const silence = (n: number) => rep(n, { gate: false });

describe('NoteTracker', () => {
  it('confirma uma nota só após quadros estáveis consecutivos', () => {
    const two = run([...silence(3), ...rep(2, { gate: true, midi: 52 })]);
    expect(two.filter((e) => e.type === 'onset')).toHaveLength(0);
    const three = run([...silence(3), ...rep(cfg.stableFrames + 1, { gate: true, midi: 52 })]);
    expect(three.filter((e) => e.type === 'onset')).toHaveLength(1);
    expect(three[0]!.midi).toBe(52);
  });

  it('ignora uma estimativa isolada diferente no meio de uma nota', () => {
    const ev = run([
      ...silence(3),
      ...rep(10, { gate: true, midi: 52 }),
      { gate: true, midi: 64 },
      ...rep(10, { gate: true, midi: 52 }),
    ]);
    expect(ev.filter((e) => e.type !== 'release').map((e) => e.midi)).toEqual([52]);
  });

  it('não troca de nota por vibrato dentro da tolerância', () => {
    const wobble = Array.from({ length: 60 }, (_, i) => ({
      gate: true,
      midi: 57,
      offset: 0.45 * Math.sin(i / 2),
    }));
    const ev = run([...silence(3), ...wobble]);
    expect(ev.filter((e) => e.type !== 'release')).toHaveLength(1);
  });

  it('exige mais quadros para um salto de oitava sem ataque', () => {
    const shortJump = run([
      ...silence(3),
      ...rep(15, { gate: true, midi: 52 }),
      ...rep(cfg.stableFrames + 1, { gate: true, midi: 64 }),
      ...rep(15, { gate: true, midi: 52 }),
    ]);
    expect(shortJump.filter((e) => e.type === 'change')).toHaveLength(0);
    const longJump = run([
      ...silence(3),
      ...rep(15, { gate: true, midi: 52 }),
      ...rep(cfg.octaveJumpFrames + 2, { gate: true, midi: 64 }),
    ]);
    expect(longJump.filter((e) => e.type === 'change')).toHaveLength(1);
  });

  it('aceita mudança de nota sem ataque (legato) após quadros estáveis', () => {
    const ev = run([
      ...silence(3),
      ...rep(15, { gate: true, midi: 52 }),
      ...rep(cfg.stableFrames + 2, { gate: true, midi: 55 }),
    ]);
    expect(ev.filter((e) => e.type !== 'release').map((e) => e.midi)).toEqual([52, 55]);
  });

  it('encerra a nota quando o portão fecha e informa a duração', () => {
    const ev = run([...silence(3), ...rep(20, { gate: true, midi: 52 }), ...silence(10)]);
    const release = ev.find((e) => e.type === 'release');
    expect(release?.reason).toBe('silence');
    expect(release?.duration).toBeGreaterThan(0.1);
  });

  it('encerra por falta de altura (ruído, palm mute) depois do tempo configurado', () => {
    const unpitchedFrames = Math.ceil(cfg.unpitchedReleaseMs / 1000 / DT) + 2;
    const ev = run([
      ...silence(3),
      ...rep(20, { gate: true, midi: 52 }),
      ...rep(unpitchedFrames, { gate: true, clarity: 0.2 }),
    ]);
    expect(ev.find((e) => e.type === 'release')?.reason).toBe('unpitched');
  });

  it('rejeita clareza abaixo do mínimo', () => {
    const ev = run([...silence(3), ...rep(20, { gate: true, midi: 52, clarity: cfg.minClarity - 0.1 })]);
    expect(ev).toHaveLength(0);
  });

  it('separa ataques repetidos da mesma nota pelo aumento de energia', () => {
    const attack = (): F[] => [
      { gate: true, midi: 52, db: -40 },
      { gate: true, midi: 52, db: -18 },
      ...rep(14, { gate: true, midi: 52, db: -20 }),
    ];
    const ev = run([...silence(3), ...attack(), ...attack(), ...attack()]);
    const onsets = ev.filter((e) => e.type === 'onset');
    expect(onsets.length).toBe(3);
    expect(onsets.every((e) => e.midi === 52)).toBe(true);
    expect(ev.filter((e) => e.type === 'release' && e.reason === 'reattack')).toHaveLength(2);
  });

  it('o atraso informado vai do ataque estimado à decisão', () => {
    const ev = run([...silence(3), ...rep(10, { gate: true, midi: 52 })]);
    const onset = ev.find((e) => e.type === 'onset')!;
    expect(onset.latencyMs).toBeGreaterThan(0);
    expect(onset.latencyMs).toBeLessThan(150);
    expect(onset.time).toBeGreaterThan(onset.onsetTime);
  });

  it('reset limpa a nota ativa', () => {
    const tracker = new NoteTracker(cfg);
    for (let i = 0; i < 12; i++) {
      tracker.update({
        time: (i + 1) * DT,
        energyDb: -20,
        gateOpen: true,
        openDb: -50,
        noiseFloorDb: -90,
        frequency: midiToFrequency(52),
        clarity: 0.95,
        processingMs: 0,
      });
    }
    expect(tracker.active?.midi).toBe(52);
    tracker.reset();
    expect(tracker.active).toBeNull();
  });
});
