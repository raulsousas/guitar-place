// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { LOOPBACK, analyzeHits, clickBuffer, clickOffsets, thresholdFromAmbient, type LoopbackHit } from '../../src/fx/loopback';

const clicks = (n = 10, t0 = 1) => clickOffsets(n).map((o) => t0 + o);
const hitsAt = (times: number[], delayS: number, peak = 0.2): LoopbackHit[] => times.map((t) => ({ time: t + delayS, peak }));

describe('loopback: clique e limiar', () => {
  it('o clique tem a duração e a amplitude documentadas, começa abrupto e termina sem degrau', () => {
    const c = clickBuffer(48000);
    expect(c.length).toBe(Math.round((LOOPBACK.burstMs / 1000) * 48000));
    expect(Math.max(...Array.from(c).map(Math.abs))).toBeLessThanOrEqual(LOOPBACK.amplitude + 1e-6);
    expect(Math.max(...Array.from(c).map(Math.abs))).toBeGreaterThan(LOOPBACK.amplitude * 0.9);
    expect(Math.abs(c[c.length - 1]!)).toBeLessThan(0.02);
    expect(c.every(Number.isFinite)).toBe(true);
  });
  it('limiar: piso sem ruído, 6x o ruído de fundo, teto, e entradas inválidas caem no piso', () => {
    expect(thresholdFromAmbient(0)).toBe(LOOPBACK.thresholdFloor);
    expect(thresholdFromAmbient(0.01)).toBeCloseTo(0.06);
    expect(thresholdFromAmbient(0.9)).toBe(LOOPBACK.thresholdCeiling);
    expect(thresholdFromAmbient(Number.NaN)).toBe(LOOPBACK.thresholdFloor);
    expect(thresholdFromAmbient(-1)).toBe(LOOPBACK.thresholdFloor);
  });
  it('o limiar é sempre menor que o clique (senão ele nunca seria detectado)', () => {
    expect(LOOPBACK.thresholdCeiling).toBeLessThan(LOOPBACK.amplitude * 5);
    expect(LOOPBACK.thresholdFloor).toBeLessThan(LOOPBACK.amplitude);
  });
});

describe('loopback: análise dos tempos', () => {
  it('atraso constante conhecido: devolve exatamente esse atraso', () => {
    const t = clicks();
    const r = analyzeHits(t, hitsAt(t, 0.0345));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.medianMs).toBeCloseTo(34.5, 6);
      expect(r.minMs).toBeCloseTo(34.5, 6);
      expect(r.maxMs).toBeCloseTo(34.5, 6);
      expect(r.matched).toBe(10);
      expect(r.extraneous).toBe(0);
    }
  });
  it('atrasos que variam um pouco: mediana, mínimo e máximo corretos', () => {
    const t = clicks();
    const h = t.map((x, i) => ({ time: x + (0.03 + (i % 3) * 0.002), peak: 0.2 }));
    const r = analyzeHits(t, h);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.minMs).toBeCloseTo(30, 6);
      expect(r.maxMs).toBeCloseTo(34, 6);
      expect(r.medianMs).toBeGreaterThanOrEqual(30);
      expect(r.medianMs).toBeLessThanOrEqual(34);
    }
  });
  it('um clique perdido ainda vale se passar do mínimo; detecção extra é contada e ignorada', () => {
    const t = clicks();
    const h = hitsAt(t, 0.04).filter((_, i) => i !== 3);
    h.push({ time: 0.6, peak: 0.1 }); // antes do primeiro clique: não pertence a nenhum
    const r = analyzeHits(t, h.sort((a, b) => a.time - b.time));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matched).toBe(9);
      expect(r.extraneous).toBe(1);
      expect(r.medianMs).toBeCloseTo(40, 6);
    }
  });
  it('falhas: sem detecção, só ruído, poucos cliques, rápido demais, instável', () => {
    const t = clicks();
    expect(analyzeHits(t, [])).toMatchObject({ ok: false, reason: 'no-signal' });
    // detecções que nunca caem dentro da janela de um clique
    expect(analyzeHits(t, [{ time: 0.2, peak: 0.3 }])).toMatchObject({ ok: false, reason: 'noisy' });
    expect(analyzeHits(t, hitsAt(t, 0.04).slice(0, 5))).toMatchObject({ ok: false, reason: 'too-few' });
    expect(analyzeHits(t, hitsAt(t, 0.0005))).toMatchObject({ ok: false, reason: 'too-fast' });
    const wild = t.map((x, i) => ({ time: x + (i % 2 ? 0.1 : 0.03), peak: 0.2 }));
    expect(analyzeHits(t, wild)).toMatchObject({ ok: false, reason: 'unstable' });
  });
  it('muitas detecções fora dos cliques (guitarra tocando) invalidam a medida', () => {
    const t = clicks();
    const extra = Array.from({ length: 20 }, (_, i) => ({ time: 0.1 + i * 0.011, peak: 0.1 }));
    const h = [...extra, ...hitsAt(t, 0.04)].sort((a, b) => a.time - b.time);
    expect(analyzeHits(t, h)).toMatchObject({ ok: false, reason: 'noisy' });
  });
  it('entrada vazia não quebra', () => {
    expect(analyzeHits([], [])).toMatchObject({ ok: false });
  });
  it('um clique só pode casar com uma detecção (a mesma não conta duas vezes)', () => {
    const t = [1, 1.01];
    const r = analyzeHits(t, [{ time: 1.04, peak: 0.2 }]);
    expect(r.ok).toBe(false);
    expect(r.matched).toBe(1);
  });
});

describe('loopback: cliques irregulares e sinais que não vêm do cabo', () => {
  it('o intervalo mínimo entre cliques é maior que a janela de busca (um clique nunca casa com o seguinte)', () => {
    const o = clickOffsets();
    for (let i = 1; i < o.length; i++) expect(o[i]! - o[i - 1]!).toBeGreaterThan(LOOPBACK.windowS);
    expect(o).toHaveLength(LOOPBACK.clicks);
  });
  it('os intervalos não são todos iguais', () => {
    const o = clickOffsets();
    const gaps = new Set(o.slice(1).map((v, i) => (v - o[i]!).toFixed(4)));
    expect(gaps.size).toBeGreaterThan(5);
  });
  it('som periódico que já existe na entrada (bipes a cada 1 s) NÃO vira uma latência falsa', () => {
    const t = clicks();
    const beeps = Array.from({ length: 12 }, (_, i) => ({ time: 0.37 + i, peak: 0.3 }));
    const r = analyzeHits(t, beeps);
    expect(r.ok).toBe(false);
  });
  it('som periódico com outros períodos também é rejeitado', () => {
    const t = clicks();
    for (const period of [0.5, 0.7, 0.8, 1.3]) {
      const beeps = Array.from({ length: 14 }, (_, i) => ({ time: 0.21 + i * period, peak: 0.3 }));
      expect(analyzeHits(t, beeps).ok).toBe(false);
    }
  });
});

describe('loopback: caminho de áudio simulado com atraso conhecido (renderização offline do motor real)', () => {
  const SR = 48000;

  /** Toca os cliques, atrasa por `delayMs` (simula buffer + driver + cabo) e detecta a primeira amostra acima do limiar. */
  async function simulate(delayMs: number, noiseRms = 0): Promise<{ clickTimes: number[]; hits: LoopbackHit[] }> {
    const seconds = 1.5 + clickOffsets().at(-1)!;
    const n = Math.round(SR * seconds);
    const ctx = new OfflineAudioContext(1, n, SR);
    const click = clickBuffer(SR);
    const buf = ctx.createBuffer(1, click.length, SR);
    buf.copyToChannel(click, 0);
    const clickTimes: number[] = [];
    const d = ctx.createDelay(1);
    d.delayTime.value = delayMs / 1000;
    d.connect(ctx.destination);
    for (const off of clickOffsets()) {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(d);
      const t = 0.5 + off;
      s.start(t);
      clickTimes.push(Math.round(t * SR) / SR);
    }
    const out = Float32Array.from((await ctx.startRendering()).getChannelData(0));
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    const thr = thresholdFromAmbient(noiseRms * 4);
    const hits: LoopbackHit[] = [];
    let hold = 0;
    for (let i = 0; i < out.length; i++) {
      const v = out[i]! + noiseRms * rnd();
      if (Math.abs(v) > thr && i / SR >= hold) {
        hits.push({ time: i / SR, peak: Math.abs(v) });
        hold = i / SR + LOOPBACK.holdoffS;
      }
    }
    return { clickTimes, hits };
  }

  it.each([5, 23.5, 47, 120])('recupera um atraso conhecido de %s ms (erro menor que 0,7 ms)', async (delay) => {
    const { clickTimes, hits } = await simulate(delay);
    const r = analyzeHits(clickTimes, hits);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.abs(r.medianMs - delay)).toBeLessThan(0.7);
      expect(r.maxMs - r.minMs).toBeLessThan(0.7);
    }
  });
  it('com ruído de fundo leve a medida continua correta', async () => {
    const { clickTimes, hits } = await simulate(35, 0.003);
    const r = analyzeHits(clickTimes, hits);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.medianMs - 35)).toBeLessThan(1);
  });
  it('cabo desconectado (nada volta): erro claro, nunca um número', async () => {
    const { clickTimes } = await simulate(35);
    const r = analyzeHits(clickTimes, []);
    expect(r).toMatchObject({ ok: false, reason: 'no-signal' });
  });
});
