import { clamp } from './curves';
import type { MusicAnalysis } from './music-analysis';
import type { StudioParams } from './types';

/**
 * Regras que convertem as medidas de um trecho de música em ajustes do Estúdio.
 *
 * HONESTIDADE: as constantes abaixo (ANALYSIS_MAP) são uma HEURÍSTICA escolhida à mão. Não foram calibradas
 * com gravações reais, e a medida é da MISTURA inteira (guitarra + baixo + bateria + voz), não só da guitarra.
 * Os testes só verificam a direção das respostas com sinais sintéticos (mais harmônicos -> mais ganho etc.).
 * O resultado é um ponto de partida; o usuário deve ajustar de ouvido.
 *
 * Nunca alterados aqui (segurança e escolha do usuário): saída ligada/desligada, volume geral, canal e ganho de entrada.
 * Não estimados (não há medida confiável): delay, equalizador e pedal de drive (o drive só liga em ganho muito alto).
 */
export const ANALYSIS_MAP = {
  /** highMidDb (2-5 kHz / 250-2000 Hz) que corresponde a "sem distorção" e a "muito saturado". */
  gainFromDb: -24,
  gainToDb: -8,
  /** Índice de ganho (0..1) que separa as vozes: abaixo de clean, abaixo de crunch, senão alto ganho. */
  cleanBelow: 0.33,
  crunchBelow: 0.66,
  /** O pedal de drive só liga acima deste índice, como reforço. */
  driveAbove: 0.85,
  /** Faixa do centróide (Hz) mapeada para brilho 0..1. */
  brightFromHz: 1200,
  brightToHz: 3500,
  /** Faixa de lowMidDb mapeada para o controle de graves. */
  bassFromDb: -10,
  bassToDb: 5,
  /** Queda de 10 dB (s): abaixo disto sem reverb; teto do mix do reverb. */
  fallDrySec: 0.15,
  fallWetSec: 1.0,
  reverbMaxMix: 0.3,
} as const;

export interface AutoConfigNote {
  /** Nome do controle em português. */
  control: string;
  value: string;
  /** Por que, em uma frase, citando a medida. */
  why: string;
}

export interface AutoConfigResult {
  /** Parâmetros completos para aplicar (já preservando volume geral, canal e ganho de entrada). */
  params: StudioParams;
  notes: AutoConfigNote[];
  /** O que NÃO foi estimado, para a interface dizer com todas as letras. */
  notEstimated: string[];
  /** Índice interno 0..1 de saturação medida (não é probabilidade). */
  gainIndex: number;
  brightness: number;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function configFromAnalysis(a: MusicAnalysis, current: StudioParams): AutoConfigResult {
  const M = ANALYSIS_MAP;
  const gainIndex = clamp((a.highMidDb - M.gainFromDb) / (M.gainToDb - M.gainFromDb), 0, 1);
  const brightness = clamp((a.centroidHz - M.brightFromHz) / (M.brightToHz - M.brightFromHz), 0, 1);
  const bassIdx = clamp((a.lowMidDb - M.bassFromDb) / (M.bassToDb - M.bassFromDb), 0, 1);

  const params = structuredClone(current);
  const notes: AutoConfigNote[] = [];

  const voicing = gainIndex < M.cleanBelow ? 'clean' : gainIndex < M.crunchBelow ? 'crunch' : 'high';
  const voiceName = voicing === 'clean' ? 'Limpo' : voicing === 'crunch' ? 'Crunch' : 'Alto ganho';
  const ampGain = clamp(0.25 + 0.6 * gainIndex, 0, 1);
  params.amp = {
    enabled: true,
    voicing,
    gain: ampGain,
    bass: 0.35 + 0.3 * bassIdx,
    mid: voicing === 'high' ? 0.45 : 0.5,
    treble: 0.35 + 0.3 * brightness,
    level: 0.6,
  };
  notes.push({
    control: 'Amplificador (voz)',
    value: `${voiceName}, ganho ${pct(ampGain)}`,
    why: `a energia de 2 a 5 kHz em relação aos médios é ${a.highMidDb.toFixed(1)} dB (mais harmônicos agudos indicam mais saturação)`,
  });
  notes.push({
    control: 'Amplificador (tom)',
    value: `graves ${pct(params.amp.bass)}, médios ${pct(params.amp.mid)}, agudos ${pct(params.amp.treble)}`,
    why: `brilho (centróide) de ${Math.round(a.centroidHz)} Hz e graves/médios de ${a.lowMidDb.toFixed(1)} dB`,
  });

  params.cabinet = { enabled: true, kind: gainIndex < M.cleanBelow ? '1x12' : '4x12' };
  notes.push({
    control: 'Gabinete',
    value: params.cabinet.kind === '1x12' ? 'Compacto (1x12)' : 'Grande (4x12)',
    why: gainIndex < M.cleanBelow ? 'som pouco saturado: gabinete mais aberto' : 'som saturado: gabinete mais fechado e encorpado',
  });

  const driveOn = gainIndex > M.driveAbove;
  params.drive = { ...params.drive, enabled: driveOn, drive: 0.3, tone: 0.4 + 0.4 * brightness, level: 0.6 };
  notes.push({
    control: 'Pedal de drive',
    value: driveOn ? 'ligado, reforço leve' : 'desligado',
    why: driveOn ? 'saturação medida muito alta' : 'a saturação medida não exige reforço',
  });

  let reverbWhy: string;
  if (a.tFall10S === null) {
    params.reverb = { ...params.reverb, enabled: false };
    reverbWhy = `medida inconclusiva (${a.validPeaks} picos válidos): reverb desligado`;
  } else {
    const wet = clamp((a.tFall10S - M.fallDrySec) / (M.fallWetSec - M.fallDrySec), 0, 1);
    const mix = wet * M.reverbMaxMix;
    const on = mix > 0.05;
    params.reverb = { enabled: on, decayS: clamp(0.8 + a.tFall10S * 2, 0.8, 3), mix };
    reverbWhy = `o volume cai 10 dB em ${a.tFall10S.toFixed(2)} s (mediana de ${a.validPeaks} picos). Isto não distingue reverb de sustentação natural`;
  }
  notes.push({
    control: 'Reverb',
    value: params.reverb.enabled ? `ligado, mix ${pct(params.reverb.mix)}, decaimento ${params.reverb.decayS.toFixed(1)} s` : 'desligado',
    why: reverbWhy,
  });

  // Delay e EQ não são estimados: ficam desligados para não carregar ajustes antigos que pareçam fazer parte do resultado.
  params.delay = { ...params.delay, enabled: false };
  params.eq = { ...params.eq, enabled: false };

  return {
    params,
    notes,
    gainIndex,
    brightness,
    notEstimated: [
      'Delay e equalizador (sem medida confiável a partir da mistura): desligados.',
      'Mixer: volume geral, canal e ganho de entrada não são alterados, por segurança e porque dependem da sua guitarra.',
      'A saída de áudio continua desligada até você ligá-la.',
    ],
  };
}
