import type { DetectorParams, EngineConfig } from '../types/engine';

/**
 * Parâmetros padrão. Cada um tem efeito e custo documentados; nenhum foi
 * escolhido sem justificativa. Os valores são pontos de partida, a serem
 * revistos com as medições em `docs/detection.md` e com testes em guitarra real.
 */
export const DEFAULT_PARAMS: DetectorParams = {
  algorithm: 'mpm',

  /**
   * Menor frequência procurada. 70 Hz fica abaixo do E2 (82,41 Hz) com folga
   * para desafinação e uma corda caída até cerca de D2 (73,4 Hz).
   * Efeito: define o maior atraso (período) pesquisado.
   * Custo: baixar demais exige janelas maiores e amplia o risco de erro de oitava grave.
   * Obs.: o limite efetivo também depende da janela (ver `minDetectableHz`).
   */
  minFrequencyHz: 70,

  /**
   * Maior frequência procurada. 1500 Hz cobre a casa 24 da 1ª corda (E6 = 1318,5 Hz).
   * Efeito: define o menor período pesquisado e evita picos espúrios de alta frequência.
   */
  maxFrequencyHz: 1500,

  /**
   * MPM: fração do maior pico da NSDF que um pico precisa atingir para ser escolhido
   * (McLeod sugere 0,8 a 1,0). O primeiro pico acima deste corte vence.
   * Efeito: valor maior → prefere o pico mais alto (risco de subharmônico/oitava abaixo);
   * valor menor → prefere o primeiro pico (risco de harmônico/oitava acima).
   */
  mpmCutoff: 0.93,

  /**
   * YIN: limiar da diferença normalizada cumulativa (Cheveigné e Kawahara sugerem 0,1 a 0,15).
   * Usado só na referência de comparação.
   */
  yinThreshold: 0.15,

  /**
   * Clareza mínima (altura do pico da NSDF) para aceitar uma estimativa.
   * Efeito: valor maior → menos notas falsas, mas rejeita palm mute, ruído e notas com distorção.
   * Custo: valor menor → mais falsos positivos e erros de oitava.
   */
  minClarity: 0.8,

  /**
   * Quadros consecutivos com a mesma nota para confirmar um ataque.
   * Efeito: filtra estimativas isoladas. Custo: soma `stableFrames × passo` ao atraso.
   */
  stableFrames: 3,

  /**
   * Quadros consecutivos exigidos para aceitar, SEM novo ataque, um salto de altura que se
   * parece com erro de oitava (12, 19, 24 semitons) durante a mesma nota.
   * Efeito: durante o decaimento, harmônicos podem dominar por poucos quadros; exigir muitos
   * quadros evita trocar a nota por um harmônico. Uma oitava real vem com palhetada, que passa
   * pelo caminho de novo ataque e não depende deste valor.
   * Custo: corrige um erro de oitava no início da nota só depois deste tempo
   * (12 quadros de 512 amostras a 48 kHz ≈ 128 ms).
   */
  octaveJumpFrames: 12,

  /**
   * Distância (em semitons) do centro da nota atual a partir da qual uma nova altura
   * começa a contar como mudança de nota sem ataque (legato, bend).
   * 0,75 deixa margem para vibrato de ±50 cents sem gerar notas falsas.
   * Custo: bends menores que isso não geram evento novo.
   */
  changeSemitones: 0.75,

  /**
   * Aumento de energia (dB) sobre o mínimo recente que conta como novo ataque.
   * Efeito: detecta repetição da mesma nota. Custo: valor baixo confunde oscilações de
   * volume com ataques; valor alto perde ataques suaves.
   */
  onsetRiseDb: 6,

  /** Janela para o mínimo recente de energia no teste de ataque. Deve ser menor que reattackMinMs. */
  onsetLookbackMs: 60,

  /**
   * Intervalo mínimo entre dois ataques. 80 ms permite semicolcheias a cerca de 190 BPM.
   * Evita que a subida de um mesmo ataque conte duas vezes.
   */
  reattackMinMs: 80,

  /**
   * Tempo com o portão fechado (silêncio) antes de encerrar a nota.
   * Efeito: valor menor → fim de nota mais rápido, mas oscilações de decaimento cortam a nota.
   */
  releaseMs: 60,

  /**
   * Tempo sem altura válida (sinal presente, mas sem periodicidade) antes de encerrar a nota.
   * Cobre ruído, palm mute e fim de decaimento.
   */
  unpitchedReleaseMs: 200,

  /** Diferença entre o limiar de abertura e o de fechamento do portão de silêncio. */
  hysteresisDb: 6,

  /**
   * Com o filtro de ruído ligado, o portão só abre acima do ruído de fundo medido + esta margem.
   * Efeito: ignora ruído estacionário (zumbido, chiado) mesmo com sensibilidade alta.
   * Custo: em ambiente ruidoso, notas suaves podem ficar abaixo do limiar.
   */
  noiseMarginDb: 10,


  /**
   * Janela da medida de energia usada no portão e nos ataques. 20 ms supera um período do E2
   * (12,1 ms), então a energia não oscila com a fase da onda; é curta o bastante para acompanhar ataques.
   */
  energyWindowMs: 20,

  /**
   * Passa-altas (Hz) do filtro de ruído. Remove DC e ronco abaixo do E2.
   * Custo: um filtro Butterworth de 2ª ordem em 60 Hz atenua o E2 (82,4 Hz) em cerca de 1 dB.
   */
  highpassHz: 60,

  /**
   * Passa-baixas (Hz) do filtro de ruído. Reduz chiado e parte dos harmônicos agudos,
   * o que ajuda contra erros de oitava com distorção.
   * Custo: 2500 Hz preserva a fundamental até o E6; valores menores já atenuam notas agudas.
   */
  lowpassHz: 2500,
};

export const DEFAULT_HOP_SIZE = 512;
export const DEFAULT_WINDOW_SIZE = 4096;

export function createEngineConfig(
  partial: Partial<EngineConfig> & { sampleRate: number },
): EngineConfig {
  return {
    ...DEFAULT_PARAMS,
    windowSize: DEFAULT_WINDOW_SIZE,
    hopSize: DEFAULT_HOP_SIZE,
    sensitivity: 70,
    noiseFilter: true,
    a4Hz: 440,
    ...partial,
  };
}

/**
 * Limiar de abertura do portão (dBFS RMS) a partir da sensibilidade 0..100:
 * 0 → −25 dBFS (só sinais fortes), 100 → −60 dBFS (muito sensível).
 * O padrão 70 dá cerca de −49,5 dBFS. Com o filtro de ruído ligado, o limiar também
 * acompanha o ruído de fundo medido (ver PitchEngine).
 */
export function sensitivityToOpenDb(sensitivity: number): number {
  const s = Math.min(100, Math.max(0, sensitivity));
  return -25 - (s / 100) * 35;
}
