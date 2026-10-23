// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { StudioEngine } from '../../src/fx/engine';
import { saturationCurve, softLimitCurve, dbToGain, driveToGain, driveToneHz, ampPreGain, ampLevelGain, toneToDb } from '../../src/fx/curves';
import { generateReverbIr } from '../../src/fx/reverb-ir';
import { DEFAULT_STUDIO } from '../../src/fx/presets';
import type { StudioParams } from '../../src/fx/types';

const SR = 48000;

function allOff(over: Partial<StudioParams> = {}): StudioParams {
  const base = structuredClone(DEFAULT_STUDIO);
  base.drive.enabled = false;
  base.eq.enabled = false;
  base.amp.enabled = false;
  base.cabinet.enabled = false;
  base.delay.enabled = false;
  base.reverb.enabled = false;
  base.masterDb = 0;
  return { ...base, ...over };
}

/** Renderiza um seno de teste pelo motor e devolve as amostras. */
async function render(
  params: StudioParams,
  opts: { seconds?: number; freq?: number; amp?: number; enable?: boolean; channels?: number; burstS?: number } = {},
): Promise<Float32Array> {
  const seconds = opts.seconds ?? 1;
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const osc = ctx.createOscillator();
  osc.frequency.value = opts.freq ?? 220;
  const g = ctx.createGain();
  g.gain.value = opts.amp ?? 0.3;
  if (opts.burstS !== undefined) g.gain.setValueAtTime(0, opts.burstS);
  osc.connect(g);
  const src = ctx.createGain(); // fonte estéreo explícita
  src.channelCount = opts.channels ?? 2;
  src.channelCountMode = 'explicit';
  g.connect(src);
  osc.start();
  const engine = new StudioEngine(ctx as unknown as BaseAudioContext, src as unknown as AudioNode);
  engine.setParams(params);
  engine.setOutputEnabled(opts.enable ?? true);
  const buf = await ctx.startRendering();
  // Cópia imediata: getChannelData() de node-web-audio-api é uma visão da memória nativa do AudioBuffer;
  // depois que o buffer é coletado pelo GC ela lê lixo (ou derruba o processo).
  return Float32Array.from(buf.getChannelData(0));
}

const peak = (d: Float32Array, from = 0) => d.slice(from).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (d: Float32Array, from = 0) => Math.sqrt(d.slice(from).reduce((s, v) => s + v * v, 0) / (d.length - from));
const db = (x: number) => 20 * Math.log10(x);
const finite = (d: Float32Array) => d.every(Number.isFinite);

describe('curvas puras', () => {
  it('saturação: limitada a +-1, zero em zero, monótona e ímpar quando simétrica', () => {
    const c = saturationCurve(3, 0);
    expect(Math.max(...c)).toBeLessThanOrEqual(1 + 1e-6);
    expect(Math.min(...c)).toBeGreaterThanOrEqual(-1 - 1e-6);
    expect(Math.abs(c[Math.floor(c.length / 2)]!)).toBeLessThan(1e-3);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]! - 1e-7);
    expect(c[0]! + c[c.length - 1]!).toBeCloseTo(0, 5);
  });
  it('saturação assimétrica também fica limitada', () => {
    const c = saturationCurve(5, 0.25);
    expect(Math.max(...c.map(Math.abs))).toBeLessThanOrEqual(1 + 1e-6);
  });
  it('limitador suave: linear abaixo do joelho, monótono e nunca passa de 0,98', () => {
    const c = softLimitCurve();
    const n = c.length;
    expect(Math.max(...c.map(Math.abs))).toBeLessThanOrEqual(0.98);
    for (let i = 1; i < n; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]! - 1e-7);
    // x = 0,5 (índice 3/4 de [0, n-1]) fica abaixo do joelho de 0,6: passa intacto
    const x = (i: number) => (i / (n - 1)) * 2 - 1;
    const i05 = Math.round(0.75 * (n - 1));
    expect(c[i05]!).toBeCloseTo(x(i05), 5);
    // acima do joelho há compressão: a saída é menor que a entrada
    expect(c[n - 1]!).toBeLessThan(1);
    expect(c[0]! + c[n - 1]!).toBeCloseTo(0, 5);
  });
  it('mapeamentos de parâmetros nos extremos', () => {
    expect(driveToGain(0)).toBeCloseTo(1);
    expect(db(driveToGain(1))).toBeCloseTo(30, 3);
    expect(driveToGain(Number.NaN)).toBeCloseTo(1); // inválido vira o mínimo
    expect(driveToneHz(0)).toBeCloseTo(1500);
    expect(driveToneHz(1)).toBeCloseTo(9000);
    expect(toneToDb(0.5)).toBe(0);
    expect(toneToDb(1)).toBe(12);
    expect(ampLevelGain(0)).toBe(0);
    expect(db(ampLevelGain(1))).toBeCloseTo(0, 5);
    expect(ampPreGain('high', 1)).toBeGreaterThan(ampPreGain('clean', 1));
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
  });
  it('IR do reverb: determinística, decai e tem energia normalizada', () => {
    const a = generateReverbIr(SR, 1.5);
    const b = generateReverbIr(SR, 1.5);
    expect(a[0]![1234]).toBe(b[0]![1234]);
    expect(a).toHaveLength(2);
    const head = a[0]!.slice(0, 4800).reduce((s, v) => s + v * v, 0);
    const tail = a[0]!.slice(-4800).reduce((s, v) => s + v * v, 0);
    expect(tail).toBeLessThan(head * 0.01);
    expect(a[0]!.every(Number.isFinite)).toBe(true);
    const longer = generateReverbIr(SR, 3);
    expect(longer[0]!.length).toBeGreaterThan(a[0]!.length);
  });
});

describe('StudioEngine: segurança da saída', () => {
  it('desligado: silêncio absoluto, mesmo com sinal na entrada', async () => {
    const d = await render(allOff(), { enable: false });
    expect(peak(d)).toBe(0);
  });
  it('ligado e sem efeitos: o sinal passa quase sem alteração de nível (transparente)', async () => {
    const d = await render(allOff(), { amp: 0.3 });
    const out = rms(d, 24000);
    const inn = 0.3 / Math.SQRT2;
    expect(Math.abs(db(out) - db(inn))).toBeLessThan(0.5);
    expect(finite(d)).toBe(true);
  });
  it('a saída nunca passa de 0,98, nem com entrada em fundo de escala e tudo ligado', async () => {
    const p = structuredClone(DEFAULT_STUDIO);
    p.drive = { ...p.drive, drive: 1, enabled: true };
    p.amp = { ...p.amp, voicing: 'high', gain: 1, level: 1, enabled: true };
    p.masterDb = 0;
    p.inputTrimDb = 20;
    const d = await render(p, { amp: 1, seconds: 1.5 });
    expect(finite(d)).toBe(true);
    expect(peak(d)).toBeLessThanOrEqual(0.9801);
  });
  it('silêncio na entrada com tudo ligado: sem NaN e sem ruído', async () => {
    const d = await render(structuredClone(DEFAULT_STUDIO), { amp: 0 });
    expect(finite(d)).toBe(true);
    expect(peak(d)).toBeLessThan(1e-4);
  });
  it('volume geral reduz o nível conforme o valor em dB', async () => {
    const a = await render(allOff({ masterDb: 0 }));
    const b = await render(allOff({ masterDb: -12 }));
    expect(db(rms(a, 24000)) - db(rms(b, 24000))).toBeCloseTo(12, 0);
  });
});

describe('StudioEngine: efeitos', () => {
  it('drive adiciona harmônicos: o pico/RMS (fator de crista) cai ao saturar', async () => {
    const clean = await render(allOff(), { amp: 0.3 });
    const p = allOff();
    p.drive = { enabled: true, drive: 0.9, tone: 0.8, level: 0.5 };
    const driven = await render(p, { amp: 0.3 });
    const crest = (d: Float32Array) => peak(d, 24000) / rms(d, 24000);
    expect(crest(driven)).toBeLessThan(crest(clean) - 0.1);
    expect(finite(driven)).toBe(true);
  });
  it('mais ganho no amplificador gera mais compressão (crista menor)', async () => {
    const mk = (gain: number) => {
      const p = allOff();
      p.amp = { enabled: true, voicing: 'crunch', gain, bass: 0.5, mid: 0.5, treble: 0.5, level: 0.8 };
      return p;
    };
    const lo = await render(mk(0.1));
    const hi = await render(mk(0.9));
    const crest = (d: Float32Array) => peak(d, 24000) / rms(d, 24000);
    expect(crest(hi)).toBeLessThan(crest(lo));
  });
  it('EQ: +12 dB nos graves aumenta o nível de 80 Hz; os agudos de 80 Hz não mudam muito', async () => {
    const flat = await render(allOff(), { freq: 80 });
    const p = allOff();
    p.eq = { enabled: true, lowDb: 12, midDb: 0, highDb: 0 };
    const boosted = await render(p, { freq: 80 });
    expect(db(rms(boosted, 24000)) - db(rms(flat, 24000))).toBeGreaterThan(6);
  });
  it('EQ ligado com ganhos em zero é transparente', async () => {
    const flat = await render(allOff());
    const p = allOff();
    p.eq = { enabled: true, lowDb: 0, midDb: 0, highDb: 0 };
    const eq = await render(p);
    expect(Math.abs(db(rms(eq, 24000)) - db(rms(flat, 24000)))).toBeLessThan(0.3);
  });
  it('gabinete reduz os agudos (passa-baixas): 8 kHz cai bem mais que 400 Hz', async () => {
    const p = allOff();
    p.cabinet = { enabled: true, kind: '4x12' };
    const lowF = await render(p, { freq: 400 });
    const highF = await render(p, { freq: 8000 });
    expect(db(rms(lowF, 24000)) - db(rms(highF, 24000))).toBeGreaterThan(10);
  });
  it('delay: aparece um eco depois de timeMs, ausente com o delay desligado', async () => {
    const p = allOff();
    p.delay = { enabled: true, timeMs: 250, feedback: 0.3, mix: 0.6 };
    const burst = (params: StudioParams) => render(params, { seconds: 1, burstS: 0.1, amp: 0.3 });
    // rajada curta: o ganho vai a 0 aos 0,1 s (setValueAtTime)
    const withDelay = await burst(p);
    const without = await burst(allOff());
    const echo = (d: Float32Array) => peak(d.slice(Math.round(SR * 0.4), Math.round(SR * 0.55)));
    expect(echo(withDelay)).toBeGreaterThan(0.02);
    expect(echo(without)).toBeLessThan(0.002);
  });
  it('delay: com feedback no máximo a cauda decai (não explode)', async () => {
    const p = allOff();
    p.delay = { enabled: true, timeMs: 100, feedback: 5, mix: 1 }; // fora da faixa: deve ser limitado
    const d = await render(p, { seconds: 3, burstS: 0.1, amp: 0.3 });
    expect(finite(d)).toBe(true);
    expect(peak(d.slice(SR * 2.5))).toBeLessThan(peak(d.slice(0, SR * 1))) ;
  });
  it('reverb: há energia depois que o sinal de entrada acaba, e mais com mix maior', async () => {
    const mk = (mix: number) => {
      const p = allOff();
      p.reverb = { enabled: true, decayS: 1.5, mix };
      return p;
    };
    const tail = (d: Float32Array) => rms(d.slice(Math.round(SR * 0.6), Math.round(SR * 1.2)));
    const lo = await render(mk(0.1), { seconds: 1.5, burstS: 0.2 });
    const hi = await render(mk(0.8), { seconds: 1.5, burstS: 0.2 });
    const none = await render(allOff(), { seconds: 1.5, burstS: 0.2 });
    expect(tail(none)).toBeLessThan(1e-4);
    expect(tail(lo)).toBeGreaterThan(tail(none));
    expect(tail(hi)).toBeGreaterThan(tail(lo));
  });
  it('canal: ouvir só a entrada 2 com sinal só na entrada 1 dá silêncio', async () => {
    const ctx = new OfflineAudioContext(2, SR, SR);
    const osc = ctx.createOscillator();
    const merger = ctx.createChannelMerger(2);
    osc.connect(merger, 0, 0); // somente canal 1
    osc.start();
    const stereo = ctx.createGain(); // fonte estéreo explícita (como o stream da interface)
    stereo.channelCount = 2;
    stereo.channelCountMode = 'explicit';
    merger.connect(stereo);
    const engine = new StudioEngine(ctx as unknown as BaseAudioContext, stereo as unknown as AudioNode);
    engine.setParams(allOff({ inputChannel: 'ch2' }));
    engine.setOutputEnabled(true);
    const silent = Float32Array.from((await ctx.startRendering()).getChannelData(0));
    expect(peak(silent, 24000)).toBeLessThan(1e-4);

    const ctx2 = new OfflineAudioContext(2, SR, SR);
    const osc2 = ctx2.createOscillator();
    const merger2 = ctx2.createChannelMerger(2);
    osc2.connect(merger2, 0, 0);
    osc2.start();
    const stereo2 = ctx2.createGain();
    stereo2.channelCount = 2;
    stereo2.channelCountMode = 'explicit';
    merger2.connect(stereo2);
    const engine2 = new StudioEngine(ctx2 as unknown as BaseAudioContext, stereo2 as unknown as AudioNode);
    engine2.setParams(allOff({ inputChannel: 'ch1' }));
    engine2.setOutputEnabled(true);
    const heard = Float32Array.from((await ctx2.startRendering()).getChannelData(0));
    expect(peak(heard, 24000)).toBeGreaterThan(0.1);
  });
  it('ligar um bloco no meio do sinal não causa degrau: variação amostra a amostra é suave', async () => {
    const ctx = new OfflineAudioContext(2, SR, SR);
    const osc = ctx.createOscillator();
    osc.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    osc.connect(g);
    osc.start();
    const engine = new StudioEngine(ctx as unknown as BaseAudioContext, g as unknown as AudioNode);
    const off = allOff();
    engine.setParams(off);
    engine.setOutputEnabled(true);
    ctx.suspend(0.5).then(() => {
      const on = structuredClone(off);
      on.eq = { enabled: true, lowDb: 0, midDb: 0, highDb: 0 };
      on.cabinet = { enabled: false, kind: '4x12' };
      engine.setParams(on);
      return ctx.resume();
    });
    const d = Float32Array.from((await ctx.startRendering()).getChannelData(0));
    let maxStep = 0;
    for (let i = 1; i < d.length; i++) maxStep = Math.max(maxStep, Math.abs(d[i]! - d[i - 1]!));
    // Um seno de 220 Hz e amplitude 0,3 muda no máximo 2*pi*220/48000*0,3 ~ 0,0086 por amostra.
    expect(maxStep).toBeLessThan(0.02);
  });
});