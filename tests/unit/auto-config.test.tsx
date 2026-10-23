import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fft } from '../../src/fx/fft';
import { analyzeMusic, type MusicAnalysis } from '../../src/fx/music-analysis';
import { ANALYSIS_MAP, configFromAnalysis } from '../../src/fx/auto-config';
import { DEFAULT_STUDIO } from '../../src/fx/presets';
import { toMonoSegment, MAX_ANALYZED_S } from '../../src/audio/decode-file';
import { AutoConfigSection } from '../../src/components/studio/AutoConfigSection';
import type { StudioApi } from '../../src/hooks/useStudio';

const SR = 44100;

interface Opts {
  seconds?: number;
  /** Constante de tempo do decaimento de cada nota (s). */
  tau?: number;
  /** Intervalo entre notas (s). */
  every?: number;
  /** Ganho antes de tanh: 0 = sem distorção. */
  drive?: number;
  /** Número de harmônicos da nota (1 = seno puro). */
  harmonics?: number;
  /** Passa-baixa de 1 polo (Hz) aplicado no fim, para escurecer. */
  lowpassHz?: number;
}

/** Notas dedilhadas sintéticas (A2 a E3...) com decaimento exponencial. Só para validar o ALGORITMO. */
function melody(o: Opts = {}): Float32Array {
  const seconds = o.seconds ?? 20;
  const tau = o.tau ?? 0.15;
  const every = o.every ?? 0.8;
  const harmonics = o.harmonics ?? 4;
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  const f0s = [110, 146.83, 196, 164.81, 130.81, 220];
  for (let t0 = 0.1, k = 0; t0 < seconds - 0.1; t0 += every, k++) {
    const f0 = f0s[k % f0s.length]!;
    const start = Math.round(t0 * SR);
    for (let i = start; i < n; i++) {
      const t = (i - start) / SR;
      const env = Math.exp(-t / tau);
      if (env < 1e-4) break;
      let s = 0;
      for (let h = 1; h <= harmonics; h++) s += Math.sin(2 * Math.PI * f0 * h * t) / h;
      x[i]! += 0.35 * env * s;
    }
  }
  if (o.drive) {
    // Normaliza o nível antes e depois: a distorção não pode mudar o volume geral entre os casos comparados.
    let pk = 0;
    for (const v of x) pk = Math.max(pk, Math.abs(v));
    for (let i = 0; i < n; i++) x[i] = Math.tanh((o.drive * x[i]!) / pk) * 0.5;
  }
  if (o.lowpassHz) {
    const a = 1 - Math.exp((-2 * Math.PI * o.lowpassHz) / SR);
    let y = 0;
    for (let i = 0; i < n; i++) {
      y += a * (x[i]! - y);
      x[i] = y;
    }
  }
  return x;
}

const ok = (x: Float32Array): MusicAnalysis => {
  const r = analyzeMusic(x, SR);
  if (!r.ok) throw new Error(`análise falhou: ${r.reason}`);
  return r;
};

describe('fft', () => {
  it('um seno em um bin exato aparece só nesse bin', () => {
    const N = 1024;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = Math.sin((2 * Math.PI * 64 * i) / N);
    fft(re, im);
    const mag = (k: number) => Math.hypot(re[k]!, im[k]!);
    expect(mag(64)).toBeCloseTo(N / 2, 0);
    expect(mag(10)).toBeLessThan(1e-2);
  });
  it('rejeita tamanho que não é potência de 2', () => {
    expect(() => fft(new Float32Array(1000), new Float32Array(1000))).toThrow();
  });
});

describe('analyzeMusic: entradas inválidas', () => {
  it('trecho curto, silêncio, NaN e taxa inválida', () => {
    expect(analyzeMusic(melody({ seconds: 2 }), SR)).toEqual({ ok: false, reason: 'too-short' });
    expect(analyzeMusic(new Float32Array(SR * 10), SR)).toEqual({ ok: false, reason: 'mostly-silent' });
    const bad = melody({ seconds: 6 });
    bad[100] = Number.NaN;
    expect(analyzeMusic(bad, SR)).toEqual({ ok: false, reason: 'invalid' });
    expect(analyzeMusic(melody({ seconds: 6 }), 100)).toEqual({ ok: false, reason: 'invalid' });
    expect(analyzeMusic(new Float32Array(0), SR)).toEqual({ ok: false, reason: 'invalid' });
  });
  it('ruído muito baixo (-70 dBFS) conta como silêncio', () => {
    const n = new Float32Array(SR * 8);
    for (let i = 0; i < n.length; i++) n[i] = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 3e-4;
    expect(analyzeMusic(n, SR)).toEqual({ ok: false, reason: 'mostly-silent' });
  });
});

describe('analyzeMusic: direção das medidas com sinais sintéticos', () => {
  it('mais distorção -> mais energia de 2 a 5 kHz sobre os médios', () => {
    const clean = ok(melody({ harmonics: 3 }));
    const dist = ok(melody({ harmonics: 3, drive: 12 }));
    expect(dist.highMidDb).toBeGreaterThan(clean.highMidDb + 3);
  });
  it('filtrar os agudos reduz o centróide', () => {
    const bright = ok(melody({ harmonics: 12 }));
    const dark = ok(melody({ harmonics: 12, lowpassHz: 800 }));
    expect(dark.centroidHz).toBeLessThan(bright.centroidHz);
  });
  it('decaimento lento -> queda de 10 dB mais demorada', () => {
    const fast = ok(melody({ tau: 0.05, every: 1.2 }));
    const slow = ok(melody({ tau: 0.4, every: 1.2 }));
    expect(fast.tFall10S).not.toBeNull();
    expect(slow.tFall10S).not.toBeNull();
    expect(slow.tFall10S!).toBeGreaterThan(fast.tFall10S! * 2);
    // tau*ln(sqrt(10)) = 1,151*tau: 0,058 s e 0,46 s esperados, com resolução de ~12 ms.
    expect(fast.tFall10S!).toBeGreaterThan(0.03);
    expect(fast.tFall10S!).toBeLessThan(0.11);
    expect(slow.tFall10S!).toBeGreaterThan(0.35);
    expect(slow.tFall10S!).toBeLessThan(0.6);
  });
  it('poucos picos válidos: a queda fica inconclusiva (null)', () => {
    const few = ok(melody({ seconds: 6, every: 3, tau: 0.2 }));
    expect(few.validPeaks).toBeLessThan(8);
    expect(few.tFall10S).toBeNull();
  });
  it('é determinística', () => {
    const a = ok(melody());
    const b = ok(melody());
    expect(a).toEqual(b);
  });
});

describe('configFromAnalysis: regras', () => {
  const base: MusicAnalysis = {
    ok: true,
    durationS: 60,
    activeFraction: 0.9,
    lowMidDb: 0,
    highMidDb: -16,
    centroidHz: 2000,
    loudnessSpreadDb: 10,
    tFall10S: 0.5,
    validPeaks: 20,
  };
  const withHigh = (v: number) => configFromAnalysis({ ...base, highMidDb: v }, DEFAULT_STUDIO);

  it('mais harmônicos agudos -> voz mais saturada e mais ganho (monótono)', () => {
    const r = [-30, -20, -16, -4].map((v) => withHigh(v));
    expect(r.map((x) => x.params.amp.voicing)).toEqual(['clean', 'clean', 'crunch', 'high']);
    const gains = r.map((x) => x.params.amp.gain);
    for (let i = 1; i < gains.length; i++) expect(gains[i]!).toBeGreaterThanOrEqual(gains[i - 1]!);
  });
  it('sempre liga amplificador e gabinete; gabinete compacto só no som limpo', () => {
    const c = withHigh(-30).params;
    const h = withHigh(-4).params;
    expect(c.amp.enabled && c.cabinet.enabled).toBe(true);
    expect(c.cabinet.kind).toBe('1x12');
    expect(h.cabinet.kind).toBe('4x12');
  });
  it('pedal de drive só liga com saturação muito alta', () => {
    expect(withHigh(-16).params.drive.enabled).toBe(false);
    expect(withHigh(-4).params.drive.enabled).toBe(true);
  });
  it('mais brilho -> mais agudos no amplificador', () => {
    const dark = configFromAnalysis({ ...base, centroidHz: 900 }, DEFAULT_STUDIO).params.amp.treble;
    const bright = configFromAnalysis({ ...base, centroidHz: 4000 }, DEFAULT_STUDIO).params.amp.treble;
    expect(bright).toBeGreaterThan(dark);
  });
  it('queda lenta -> reverb ligado e mais mix; queda rápida -> reverb desligado; inconclusivo -> desligado com aviso', () => {
    const fast = configFromAnalysis({ ...base, tFall10S: 0.08 }, DEFAULT_STUDIO);
    const slow = configFromAnalysis({ ...base, tFall10S: 1.2 }, DEFAULT_STUDIO);
    const none = configFromAnalysis({ ...base, tFall10S: null, validPeaks: 3 }, DEFAULT_STUDIO);
    expect(fast.params.reverb.enabled).toBe(false);
    expect(slow.params.reverb.enabled).toBe(true);
    expect(slow.params.reverb.mix).toBeLessThanOrEqual(ANALYSIS_MAP.reverbMaxMix);
    expect(none.params.reverb.enabled).toBe(false);
    expect(none.notes.find((n) => n.control === 'Reverb')!.why).toMatch(/inconclusiva/);
  });
  it('todos os valores ficam dentro das faixas, mesmo com medidas extremas', () => {
    for (const m of [{ highMidDb: 99, centroidHz: 99999, lowMidDb: 99 }, { highMidDb: -99, centroidHz: 0, lowMidDb: -99 }]) {
      const p = configFromAnalysis({ ...base, ...m }, DEFAULT_STUDIO).params;
      for (const v of [p.amp.gain, p.amp.bass, p.amp.mid, p.amp.treble, p.amp.level, p.drive.drive, p.drive.tone, p.reverb.mix]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(p.reverb.decayS).toBeGreaterThanOrEqual(0.3);
      expect(p.reverb.decayS).toBeLessThanOrEqual(4);
    }
  });
  it('não estima delay nem EQ, e diz isso', () => {
    const r = configFromAnalysis(base, { ...DEFAULT_STUDIO, delay: { ...DEFAULT_STUDIO.delay, enabled: true }, eq: { ...DEFAULT_STUDIO.eq, enabled: true } });
    expect(r.params.delay.enabled).toBe(false);
    expect(r.params.eq.enabled).toBe(false);
    expect(r.notEstimated.join(' ')).toMatch(/Delay e equalizador/);
  });
  it('preserva volume geral, canal e ganho de entrada', () => {
    const cur = { ...DEFAULT_STUDIO, masterDb: -9, inputChannel: 'ch2' as const, inputTrimDb: 4 };
    const p = configFromAnalysis(base, cur).params;
    expect([p.masterDb, p.inputChannel, p.inputTrimDb]).toEqual([-9, 'ch2', 4]);
  });
});

describe('toMonoSegment', () => {
  it('faz a média dos canais e limita o trecho analisado', () => {
    const sr = 1000;
    const len = (MAX_ANALYZED_S + 100) * sr;
    const l = new Float32Array(len).fill(0.5);
    const r = new Float32Array(len).fill(-0.5);
    const out = toMonoSegment([l, r], sr);
    expect(out.samples.length).toBe(MAX_ANALYZED_S * sr);
    expect(out.samples[10]).toBeCloseTo(0, 6);
    expect(out.durationS).toBe(MAX_ANALYZED_S);
  });
  it('arquivo curto é usado inteiro', () => {
    const out = toMonoSegment([new Float32Array(5000).fill(0.2)], 1000);
    expect(out.samples.length).toBe(5000);
  });
});

// Mock apenas de props de interface; a decodificação é injetada porque o jsdom não decodifica áudio.
function api(over: Partial<StudioApi> = {}): StudioApi {
  return {
    available: false,
    params: structuredClone(DEFAULT_STUDIO),
    update: () => undefined,
    presetId: 'direct',
    applyPreset: () => undefined,
    applyAuto: () => undefined,
    undoAuto: () => undefined,
    canUndoAuto: false,
    outputEnabled: false,
    setOutputEnabled: () => undefined,
    outputDevices: [],
    outputDeviceId: '',
    outputSelectionSupported: false,
    selectOutputDevice: () => undefined,
    outputError: null,
    playTestTone: () => undefined,
    readLevels: () => null,
    readLatency: () => null,
    ...over,
  };
}
const pick = (file: File) => fireEvent.change(screen.getByTestId('auto-file'), { target: { files: [file] } });
const file = new File([new Uint8Array(10)], 'musica.mp3', { type: 'audio/mpeg' });

describe('AutoConfigSection', () => {
  it('antes de escolher: explica que links do YouTube não funcionam e que o arquivo não sai do navegador', () => {
    render(<AutoConfigSection studio={api()} />);
    const s = screen.getByTestId('auto-config');
    expect(s).toHaveTextContent(/YouTube não funcionam/);
    expect(s).toHaveTextContent(/não é enviado, gravado nem tocado/);
    expect(screen.queryByTestId('auto-result')).not.toBeInTheDocument();
  });

  it('arquivo válido: aplica sozinho, mostra o porquê de cada ajuste, os limites e permite desfazer', async () => {
    const applyAuto = vi.fn();
    const undoAuto = vi.fn();
    const decode = vi.fn(async () => ({ samples: melody({ harmonics: 3, drive: 12, tau: 0.4, every: 1.2 }), sampleRate: SR, durationS: 20 }));
    render(<AutoConfigSection studio={api({ applyAuto, undoAuto, canUndoAuto: true })} decode={decode} />);
    pick(file);
    await waitFor(() => expect(screen.getByTestId('auto-result')).toBeInTheDocument());
    expect(applyAuto).toHaveBeenCalledOnce();
    const applied = applyAuto.mock.calls[0]![0] as typeof DEFAULT_STUDIO;
    expect(applied.amp.enabled).toBe(true);
    expect(applied.masterDb).toBe(-18);
    const result = screen.getByTestId('auto-result');
    expect(result).toHaveTextContent('musica.mp3');
    expect(result).toHaveTextContent(/já foram aplicados/);
    expect(result).toHaveTextContent(/Amplificador \(voz\)/);
    expect(screen.getByTestId('auto-limits')).toHaveTextContent(/Estimativa, não o timbre do disco/);
    expect(screen.getByTestId('auto-limits')).toHaveTextContent(/A saída de áudio continua desligada/);
    fireEvent.click(screen.getByTestId('auto-undo'));
    expect(undoAuto).toHaveBeenCalledOnce();
  });

  it('arquivo quase silencioso: mostra erro claro e NÃO altera o Estúdio', async () => {
    const applyAuto = vi.fn();
    const decode = async () => ({ samples: new Float32Array(SR * 10), sampleRate: SR, durationS: 10 });
    render(<AutoConfigSection studio={api({ applyAuto })} decode={decode} />);
    pick(file);
    await waitFor(() => expect(screen.getByTestId('auto-error')).toHaveTextContent(/quase todo silêncio/));
    expect(applyAuto).not.toHaveBeenCalled();
  });

  it('arquivo que não decodifica: mensagem útil, sem alterar nada', async () => {
    const { DecodeError } = await import('../../src/audio/decode-file');
    const applyAuto = vi.fn();
    const decode = async (): Promise<never> => {
      throw new DecodeError('decode-failed');
    };
    render(<AutoConfigSection studio={api({ applyAuto })} decode={decode} />);
    pick(file);
    await waitFor(() => expect(screen.getByTestId('auto-error')).toHaveTextContent(/Não foi possível ler este arquivo/));
    expect(applyAuto).not.toHaveBeenCalled();
  });

  it('arquivo grande demais é recusado com o limite explicado', async () => {
    const { DecodeError } = await import('../../src/audio/decode-file');
    const decode = async (): Promise<never> => {
      throw new DecodeError('too-large');
    };
    render(<AutoConfigSection studio={api()} decode={decode} />);
    pick(file);
    await waitFor(() => expect(screen.getByTestId('auto-error')).toHaveTextContent(/grande demais \(máximo 60 MB\)/));
  });
});