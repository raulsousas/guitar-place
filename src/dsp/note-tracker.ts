import { frequencyToMidiFloat } from '../music/notes';
import type { ActiveNote, EngineConfig, NoteEvent, PitchFrame } from '../types/engine';

interface Candidate {
  mfs: number[];
  freqs: number[];
  clarities: number[];
  firstTime: number;
}

interface Current {
  midi: number;
  /** Centro da altura em MIDI fracionário; segue lentamente a nota (tolera vibrato). */
  center: number;
  frequency: number;
  cents: number;
  clarity: number;
  onsetTime: number;
  lastPitchedTime: number;
  levelDb: number;
  pitched: boolean;
}

interface Pending {
  onsetTime: number;
  startTime: number;
  settleUntil: number;
}

/** Distâncias em semitons que parecem erro de oitava/harmônico (8ª, 12ª e 15ª). */
const OCTAVE_LIKE = [12, 19, 24];
/** Passo do suavizador do centro de altura: 0,1 por quadro segue bends lentos, ignora vibrato. */
const CENTER_ALPHA = 0.1;
const CLARITY_ALPHA = 0.3;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function emptyCandidate(): Candidate {
  return { mfs: [], freqs: [], clarities: [], firstTime: 0 };
}

/**
 * Transforma quadros de análise em eventos de nota (ataque, mudança, fim).
 * Lógica pura e síncrona, sem relógio próprio: o tempo vem dos quadros.
 *
 * Princípios:
 *  - Um ataque só vira nota depois de `stableFrames` quadros consecutivos com a mesma altura.
 *  - Estimativas isoladas, ruído e palm mute sem periodicidade não geram eventos.
 *  - Vibrato (dentro de `changeSemitones` do centro da nota) nunca gera nota nova.
 *  - Saltos de oitava/harmônico exigem `octaveJumpFrames` quadros antes de contar.
 *  - Um novo ataque com nota ativa encerra a anterior e abre outra (mesmo com a mesma altura).
 */
export class NoteTracker {
  private hist: { time: number; db: number }[] = [];
  private lastAttackTime = -Infinity;
  private prevGateOpen = false;
  private closedSince: number | null = null;
  private current: Current | null = null;
  private pending: Pending | null = null;
  private cand: Candidate = emptyCandidate();
  private readonly hopS: number;
  private readonly windowS: number;

  constructor(private readonly cfg: EngineConfig) {
    this.hopS = cfg.hopSize / cfg.sampleRate;
    this.windowS = cfg.windowSize / cfg.sampleRate;
  }

  get active(): ActiveNote | null {
    const c = this.current;
    if (!c) return null;
    return {
      midi: c.midi,
      frequency: c.frequency,
      cents: c.cents,
      pitchConfidence: c.clarity,
      onsetTime: c.onsetTime,
      pitched: c.pitched,
    };
  }

  reset(): void {
    this.hist = [];
    this.lastAttackTime = -Infinity;
    this.prevGateOpen = false;
    this.closedSince = null;
    this.current = null;
    this.pending = null;
    this.cand = emptyCandidate();
  }

  update(f: PitchFrame): NoteEvent[] {
    const cfg = this.cfg;
    const events: NoteEvent[] = [];

    // Menor energia recente (sem contar este quadro) para medir a subida.
    const lookback = cfg.onsetLookbackMs / 1000;
    while (this.hist.length > 0 && this.hist[0]!.time < f.time - lookback - 1e-9) this.hist.shift();
    let minPrev = f.energyDb;
    for (const h of this.hist) minPrev = Math.min(minPrev, h.db);
    this.hist.push({ time: f.time, db: f.energyDb });
    const rise = f.energyDb - minPrev;

    const gateOpened = f.gateOpen && !this.prevGateOpen;
    this.prevGateOpen = f.gateOpen;

    if (!f.gateOpen) {
      this.cand = emptyCandidate();
      this.pending = null;
      if (this.closedSince === null) this.closedSince = f.time;
      if (this.current && f.time - this.closedSince >= cfg.releaseMs / 1000) {
        events.push(this.makeRelease(f.time, 'silence', this.closedSince));
        this.current = null;
      }
      return events;
    }
    this.closedSince = null;

    const attack =
      (gateOpened || rise >= cfg.onsetRiseDb) &&
      f.time - this.lastAttackTime >= cfg.reattackMinMs / 1000;

    if (attack) {
      this.lastAttackTime = f.time;
      // O ataque ocorreu entre o quadro anterior e este: usa o ponto médio como estimativa (±hop/2).
      const onsetTime = f.time - this.hopS / 2;
      // Com nota ativa, a janela ainda contém a nota anterior; espera a janela ficar ao menos
      // metade nova antes de decidir a altura (evita repetir a nota antiga).
      const settleUntil = this.current ? f.time + this.windowS * 0.5 : f.time;
      if (this.current) {
        events.push(this.makeRelease(f.time, 'reattack', onsetTime));
        this.current = null;
      }
      this.pending = { onsetTime, startTime: f.time, settleUntil };
      this.cand = emptyCandidate();
    }

    const valid = f.frequency !== null && f.clarity >= cfg.minClarity;
    if (!valid) {
      this.cand = emptyCandidate();
      if (this.current) {
        this.current.pitched = false;
        if (f.time - this.current.lastPitchedTime >= cfg.unpitchedReleaseMs / 1000) {
          events.push(this.makeRelease(f.time, 'unpitched', this.current.lastPitchedTime));
          this.current = null;
        }
      }
      this.expirePending(f.time);
      return events;
    }

    const mf = frequencyToMidiFloat(f.frequency!, cfg.a4Hz);

    if (this.pending) {
      if (f.time < this.pending.settleUntil) {
        this.cand = emptyCandidate();
        return events;
      }
      this.addCandidate(mf, f.frequency!, f.clarity, f.time);
      if (this.cand.mfs.length >= cfg.stableFrames) {
        events.push(this.startNote('onset', f, this.pending.onsetTime));
        this.pending = null;
        this.cand = emptyCandidate();
      } else {
        this.expirePending(f.time);
      }
      return events;
    }

    const cur = this.current;
    if (!cur) return events;

    cur.lastPitchedTime = f.time;
    cur.pitched = true;
    const diff = mf - cur.center;
    if (Math.abs(diff) < cfg.changeSemitones) {
      // Dentro da tolerância de vibrato: apenas acompanha.
      this.cand = emptyCandidate();
      cur.center += CENTER_ALPHA * diff;
      cur.frequency = f.frequency!;
      cur.cents = (mf - cur.midi) * 100;
      cur.clarity += CLARITY_ALPHA * (f.clarity - cur.clarity);
      cur.levelDb = f.energyDb;
      return events;
    }

    const octaveLike = OCTAVE_LIKE.some((o) => Math.abs(Math.abs(diff) - o) < 0.6);
    const required = octaveLike ? cfg.octaveJumpFrames : cfg.stableFrames;
    this.addCandidate(mf, f.frequency!, f.clarity, f.time);
    if (this.cand.mfs.length >= required) {
      events.push(this.startNote('change', f, this.cand.firstTime));
      this.cand = emptyCandidate();
    }
    return events;
  }

  private addCandidate(mf: number, freq: number, clarity: number, time: number): void {
    const c = this.cand;
    if (c.mfs.length > 0 && Math.abs(mf - median(c.mfs)) >= 0.5) this.cand = emptyCandidate();
    const t = this.cand;
    if (t.mfs.length === 0) t.firstTime = time;
    t.mfs.push(mf);
    t.freqs.push(freq);
    t.clarities.push(clarity);
  }

  private expirePending(time: number): void {
    if (this.pending && time - this.pending.startTime > 0.4 + this.windowS) this.pending = null;
  }

  private startNote(type: 'onset' | 'change', f: PitchFrame, onsetTime: number): NoteEvent {
    const c = this.cand;
    const center = median(c.mfs);
    const frequency = median(c.freqs);
    const midi = Math.round(center);
    const clarity = c.clarities.reduce((a, b) => a + b, 0) / c.clarities.length;
    this.current = {
      midi,
      center,
      frequency,
      cents: (center - midi) * 100,
      clarity,
      onsetTime,
      lastPitchedTime: f.time,
      levelDb: f.energyDb,
      pitched: true,
    };
    return {
      type,
      time: f.time,
      onsetTime,
      midi,
      frequency,
      cents: (center - midi) * 100,
      pitchConfidence: clarity,
      levelDb: f.energyDb,
      latencyMs: (f.time - onsetTime) * 1000,
    };
  }

  private makeRelease(time: number, reason: 'silence' | 'unpitched' | 'reattack', endTime: number): NoteEvent {
    const c = this.current!;
    return {
      type: 'release',
      time,
      onsetTime: c.onsetTime,
      midi: c.midi,
      frequency: c.frequency,
      cents: c.cents,
      pitchConfidence: c.clarity,
      levelDb: c.levelDb,
      latencyMs: 0,
      reason,
      duration: Math.max(0, endTime - c.onsetTime),
    };
  }
}
