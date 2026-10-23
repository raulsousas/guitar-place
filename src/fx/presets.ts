import type { StudioParams } from './types';

/**
 * Estado inicial do Estúdio. A saída começa desligada (ver `StudioEngine.setOutputEnabled`) e o volume
 * geral começa baixo (-18 dB). Os blocos começam desligados: o primeiro som que você ouve é o da guitarra
 * sem processamento, para conferir o caminho de áudio antes de ligar efeitos.
 */
export const DEFAULT_STUDIO: StudioParams = {
  inputChannel: 'sum',
  inputTrimDb: 0,
  gate: { enabled: false, thresholdDb: -58 },
  drive: { enabled: false, drive: 0.45, tone: 0.6, level: 0.7 },
  eq: { enabled: false, lowDb: 0, midDb: 0, highDb: 0 },
  amp: { enabled: false, voicing: 'crunch', gain: 0.5, bass: 0.5, mid: 0.5, treble: 0.5, level: 0.6 },
  cabinet: { enabled: false, kind: '4x12' },
  delay: { enabled: false, timeMs: 420, feedback: 0.35, mix: 0.25 },
  reverb: { enabled: false, decayS: 1.8, mix: 0.3 },
  masterDb: -18,
};

export interface StudioPreset {
  id: string;
  name: string;
  /** O que o preset tenta soar. Descrição subjetiva, NÃO uma réplica de equipamento real. */
  description: string;
  params: StudioParams;
}

const base = (): StudioParams => structuredClone(DEFAULT_STUDIO);

function make(id: string, name: string, description: string, edit: (p: StudioParams) => void): StudioPreset {
  const params = base();
  edit(params);
  return { id, name, description, params };
}

export const STUDIO_PRESETS: StudioPreset[] = [
  make('direct', 'Direto (sem efeitos)', 'Só o sinal da guitarra, para conferir a saída.', () => undefined),
  make('clean', 'Limpo com espaço', 'Amplificador limpo, gabinete, um pouco de reverb.', (p) => {
    p.amp = { ...p.amp, enabled: true, voicing: 'clean', gain: 0.35, level: 0.7 };
    p.cabinet = { enabled: true, kind: '1x12' };
    p.reverb = { enabled: true, decayS: 1.6, mix: 0.2 };
  }),
  make('crunch', 'Crunch', 'Distorção média de amplificador com gabinete 4x12.', (p) => {
    p.gate = { ...p.gate, enabled: true };
    p.amp = { ...p.amp, enabled: true, voicing: 'crunch', gain: 0.55, level: 0.6 };
    p.cabinet = { enabled: true, kind: '4x12' };
  }),
  make('lead', 'Solo', 'Pedal na frente de um amplificador saturado, com delay e reverb.', (p) => {
    p.gate = { ...p.gate, enabled: true };
    p.drive = { enabled: true, drive: 0.4, tone: 0.65, level: 0.65 };
    p.amp = { ...p.amp, enabled: true, voicing: 'high', gain: 0.5, level: 0.5 };
    p.cabinet = { enabled: true, kind: '4x12' };
    p.delay = { enabled: true, timeMs: 380, feedback: 0.3, mix: 0.22 };
    p.reverb = { enabled: true, decayS: 1.8, mix: 0.22 };
  }),
];