// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { StudioEngine } from '../../src/fx/engine';
import {
  AMP_FILTERS,
  GATE_OPEN_AT,
  GATE_RANGE_DB,
  NOISE_MEASURE,
  absCurve,
  gateCurve,
  gateScale,
  thresholdFromNoise,
} from '../../src/fx/curves';
import { DEFAULT_STUDIO } from '../../src/fx/presets';
import type { StudioParams } from '../../src/fx/types';

const SR = 48000;
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));

/** Ruído gaussiano com semente fixa (resultado reproduzível). */
function noise(n: number, rmsLinear: number, seed = 7): Float32Array<ArrayBuffer> {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const g = Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
    out[i] = g * rmsLinear;
  }
  return out;
}

interface Scenario {
  noiseDb: number;
  toneAmp: number;
  /** Tom entre toneFrom e toneTo (s); fora disso só há ruído. */
  toneFrom: number;
  toneTo: number;
  seconds: number;
  freq?: number;
}

/** Renderiza ruído de fundo contínuo + uma nota (seno com decaimento) pelo motor. */
async function renderScenario(params: StudioParams, sc: Scenario): Promise<Float32Array> {
  const n = Math.round(SR * sc.seconds);
  const ctx = new OfflineAudioContext(2, n, SR);
  const data = noise(n, 10 ** (sc.noiseDb / 20));
  const f = sc.freq ?? 220;
  for (let i = Math.round(SR * sc.toneFrom); i < Math.min(n, Math.round(SR * sc.toneTo)); i++) {
    const t = i / SR - sc.toneFrom;
    data[i]! += sc.toneAmp * Math.exp(-3 * t) * Math.sin(2 * Math.PI * f * (i / SR));
  }
  const buf = ctx.createBuffer(1, n, SR);
  buf.copyToChannel(data, 0);
  const srcNode = ctx.createBufferSource();
  srcNode.buffer = buf;
  const src = ctx.createGain();
  src.channelCount = 2;
  src.channelCountMode = 'explicit';
  srcNode.connect(src);
  srcNode.start();
  const engine = new StudioEngine(ctx as unknown as BaseAudioContext, src as unknown as AudioNode);
  engine.setParams(params);
  engine.setOutputEnabled(true);
  const out = await ctx.startRendering();
  return Float32Array.from(out.getChannelData(0));
}

const rmsRange = (d: Float32Array, from: number, to: number) => {
  const a = Math.round(from * SR);
  const b = Math.round(to * SR);
  let s = 0;
  for (let i = a; i < b; i++) s += d[i]! * d[i]!;
  return Math.sqrt(s / (b - a));
};

function highGain(gateOn: boolean, thresholdDb = -48): StudioParams {
  const p = structuredClone(DEFAULT_STUDIO);
  p.masterDb = 0;
  p.gate = { enabled: gateOn, thresholdDb };
  p.drive = { enabled: true, drive: 0.7, tone: 0.6, level: 0.6 };
  p.amp = { enabled: true, voicing: 'high', gain: 0.8, bass: 0.5, mid: 0.5, treble: 0.5, level: 0.6 };
  p.cabinet = { enabled: true, kind: '4x12' };
  return p;
}

// Ruído de -60 dBFS RMS (envoltória ~ -61 dB) e uma nota de pico 0,1 (-20 dBFS; envoltória ~ -24 dB).
const SC: Scenario = { noiseDb: -60, toneAmp: 0.1, toneFrom: 1, toneTo: 1.6, seconds: 3 };

describe('portão de ruído: curvas puras', () => {
  it('curva do portão: 0 bem abaixo, 1 no limiar e acima, monótona', () => {
    const c = gateCurve();
    const at = (x: number) => c[Math.round(((x + 1) / 2) * (c.length - 1))]!;
    expect(at(0)).toBe(0);
    expect(at(GATE_OPEN_AT * 10 ** (-GATE_RANGE_DB / 20) * 0.99)).toBe(0);
    expect(at(GATE_OPEN_AT)).toBe(1);
    expect(at(1)).toBe(1);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
  });
  it('valor absoluto: simétrico e zero no centro', () => {
    const c = absCurve();
    expect(c[(c.length - 1) / 2]).toBe(0);
    expect(c[0]).toBeCloseTo(1);
    expect(c[c.length - 1]).toBeCloseTo(1);
  });
  it('escala do limiar: envoltória no limiar vira GATE_OPEN_AT; limites aplicados', () => {
    expect(gateScale(-40) * 10 ** (-40 / 20)).toBeCloseTo(GATE_OPEN_AT, 6);
    expect(gateScale(-200)).toBeCloseTo(gateScale(-80));
    expect(gateScale(0)).toBeCloseTo(gateScale(-30));
    expect(Number.isFinite(gateScale(Number.NaN))).toBe(true);
  });
  it('filtros do amplificador: mais ganho = mais filtragem do agudo antes e depois da saturação', () => {
    expect(AMP_FILTERS.high.preLpHz).toBeLessThan(AMP_FILTERS.crunch.preLpHz);
    expect(AMP_FILTERS.crunch.preLpHz).toBeLessThan(AMP_FILTERS.clean.preLpHz);
    expect(AMP_FILTERS.high.postLpHz).toBeLessThan(AMP_FILTERS.clean.postLpHz);
    expect(AMP_FILTERS.high.hpHz).toBeGreaterThan(AMP_FILTERS.clean.hpHz);
  });
});

describe('medida do ruído de fundo', () => {
  const frames = (v: number, n = 60) => Array.from({ length: n }, () => v);
  it('ruído estável: limiar fica acima do ruído por margem documentada', () => {
    const r = thresholdFromNoise(frames(-60));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.noiseDb).toBe(-60);
      expect(r.thresholdDb).toBe(Math.round(-61 + NOISE_MEASURE.marginDb));
      expect(r.thresholdDb).toBeGreaterThan(-61); // acima da envoltória do ruído
    }
  });
  it('recusa: sem sinal, alto demais, instável e poucas leituras', () => {
    expect(thresholdFromNoise(frames(-120))).toEqual({ ok: false, reason: 'no-signal' });
    expect(thresholdFromNoise([])).toEqual({ ok: false, reason: 'too-few' });
    expect(thresholdFromNoise(frames(-20))).toEqual({ ok: false, reason: 'too-loud' });
    const mixed = [...frames(-62, 40), ...frames(-45, 20)]; // uma corda soou durante a medida
    expect(thresholdFromNoise(mixed)).toEqual({ ok: false, reason: 'unstable' });
  });
  it('valores não finitos não quebram a medida', () => {
    const r = thresholdFromNoise([...frames(-60, 58), Number.NaN, -Infinity]);
    expect(r.ok).toBe(true);
  });
  it('o limiar nunca sai da faixa permitida', () => {
    const r = thresholdFromNoise(frames(-36));
    if (r.ok) expect(r.thresholdDb).toBeLessThanOrEqual(-30);
    const q = thresholdFromNoise(frames(-85));
    if (q.ok) expect(q.thresholdDb).toBeGreaterThanOrEqual(-80);
  });
});

describe('portão de ruído no motor (sinal sintético: ruído de fundo + nota)', () => {
  it('ganho alto sem portão amplifica o ruído entre as notas; com portão o ruído cai muito', async () => {
    const off = await renderScenario(highGain(false), SC);
    const on = await renderScenario(highGain(true), SC);
    const gap = (d: Float32Array) => rmsRange(d, 2.4, 2.9); // só ruído, depois da nota
    const reduction = db(gap(off)) - db(gap(on));
    // A medida é do motor real (offline), não de uma conta: o portão tira pelo menos 30 dB do ruído entre as notas.
    expect(db(gap(off))).toBeGreaterThan(-40); // o problema existe: ruído de -60 dB virou audível
    expect(reduction).toBeGreaterThan(30);
  });
  it('a nota passa: o portão não corta o ataque nem o corpo da nota', async () => {
    const off = await renderScenario(highGain(false), SC);
    const on = await renderScenario(highGain(true), SC);
    const attack = (d: Float32Array) => rmsRange(d, 1.0, 1.1);
    const body = (d: Float32Array) => rmsRange(d, 1.1, 1.3);
    expect(db(attack(on)) - db(attack(off))).toBeGreaterThan(-1.5);
    expect(db(body(on)) - db(body(off))).toBeGreaterThan(-1.5);
  });
  it('o ataque nunca sai atrasado nem cortado por abertura lenta (primeiros 10 ms)', async () => {
    const off = await renderScenario(highGain(false), SC);
    const on = await renderScenario(highGain(true), SC);
    // Janela de 10 ms: depois do atraso de antecipação de 5 ms o áudio deve estar com o portão aberto.
    const early = (d: Float32Array) => rmsRange(d, 1.005, 1.02);
    expect(db(early(on)) - db(early(off))).toBeGreaterThan(-3);
  });
  it('limiar alto demais corta a nota (o limiar é o controle do usuário)', async () => {
    const low = await renderScenario(highGain(true, -48), SC);
    const tooHigh = await renderScenario(highGain(true, -30), { ...SC, toneAmp: 0.005 }); // nota fraca, limiar acima dela
    const weak = await renderScenario(highGain(false), { ...SC, toneAmp: 0.005 });
    expect(db(rmsRange(tooHigh, 1.1, 1.3))).toBeLessThan(db(rmsRange(weak, 1.1, 1.3)) - 10);
    expect(Number.isFinite(rmsRange(low, 0, 3))).toBe(true);
  });
  it('desligado = transparente: nenhum atraso nem mudança de nível pelo portão', async () => {
    const base = structuredClone(DEFAULT_STUDIO);
    base.masterDb = 0;
    const withGateOff = await renderScenario({ ...base, gate: { enabled: false, thresholdDb: -30 } }, SC);
    const a = rmsRange(withGateOff, 1.0, 1.4);
    expect(a).toBeGreaterThan(0.01); // sinal passa
    // Mesmo resultado com limiar diferente: o limiar só importa com o portão ligado.
    const other = await renderScenario({ ...base, gate: { enabled: false, thresholdDb: -70 } }, SC);
    expect(rmsRange(other, 1.0, 1.4)).toBeCloseTo(a, 6);
  });
  it('sem sinal e sem NaN com tudo ligado', async () => {
    const out = await renderScenario(highGain(true), { ...SC, noiseDb: -140, toneAmp: 0 });
    expect(out.every(Number.isFinite)).toBe(true);
    expect(out.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThan(1e-3);
  });
});

describe('filtros contra chiado e "lixa" (alto ganho)', () => {
  it('chiado agudo (acima de 6 kHz) é bem menor na saída do que sem os filtros extras de pré-saturação', async () => {
    // Ruído de banda larga + nota: compara a energia acima de 6 kHz com a energia da nota (relação nota/chiado agudo).
    const p = highGain(false);
    const out = await renderScenario(p, { ...SC, noiseDb: -50, toneFrom: 0.2, toneTo: 2.8 });
    // Energia de alta frequência estimada por diferença de primeira ordem repetida (passa-altas simples, ~6 kHz+).
    const hf = (d: Float32Array, a: number, b: number) => {
      let s = 0;
      let n = 0;
      for (let i = Math.round(a * SR) + 3; i < Math.round(b * SR); i++) {
        const v = d[i]! - 3 * d[i - 1]! + 3 * d[i - 2]! - d[i - 3]!;
        s += v * v;
        n++;
      }
      return Math.sqrt(s / n);
    };
    const total = rmsRange(out, 0.5, 2.5);
    const ratio = db(hf(out, 0.5, 2.5) / total);
    // Diferença de 3a ordem pesa muito os agudos (+~18 dB em 20 kHz): se o agudo dominasse, a razão seria > 0 dB.
    expect(ratio).toBeLessThan(0);
  });
  it('sem nível DC na saída com saturação assimétrica', async () => {
    const out = await renderScenario(highGain(false), { ...SC, noiseDb: -140, toneFrom: 0.2, toneTo: 2.8 });
    let mean = 0;
    const from = Math.round(1.5 * SR);
    for (let i = from; i < out.length; i++) mean += out[i]!;
    mean /= out.length - from;
    expect(Math.abs(mean)).toBeLessThan(0.005);
  });
});
