/** Tipos compartilhados da camada de áudio (sem dependência de React). */

export type CaptureStatus = 'idle' | 'requesting' | 'active' | 'error';

export type AudioErrorKind =
  | 'unsupported'
  | 'permission-denied'
  | 'no-devices'
  | 'device-not-found'
  | 'device-busy'
  | 'device-disconnected'
  | 'context-suspended'
  | 'worklet-failed'
  | 'unknown';

/** Erro de áudio já traduzido para o usuário (pt-BR). */
export interface AudioError {
  kind: AudioErrorKind;
  title: string;
  message: string;
  /** Passos objetivos para recuperar a captura. */
  instructions: string[];
}

export interface AudioInputDevice {
  /** Pode ser vazio antes da permissão de microfone. */
  deviceId: string;
  label: string;
}

export interface DeviceListing {
  devices: AudioInputDevice[];
  /** false enquanto o navegador oculta os nomes (antes da permissão). */
  labelsAvailable: boolean;
}

/** Nível de um canal (escala linear, fundo de escala = 1). */
export interface ChannelLevel {
  rms: number;
  peak: number;
}

/** Leitura de nível medida sobre amostras reais. rms/peak referem-se ao canal selecionado. */
export interface LevelReading {
  rms: number;
  peak: number;
  /** Níveis por canal de entrada (1 ou 2 itens), antes da seleção de canal. */
  channels: ChannelLevel[];
  /** Quantidade de amostras agregadas nesta leitura. */
  samples: number;
  /** Relógio do AudioContext (s) no fim do bloco. */
  frameTime: number;
  /** Relógio de performance.now() (ms) na chegada à thread principal. */
  receivedAt: number;
}

/** Como combinar os canais de entrada em um sinal mono para o detector. */
export type ChannelMode = 'sum' | 'ch1' | 'ch2';

/** Mensagem enviada pelo AudioWorklet: um bloco mono + níveis. O buffer é transferido, não copiado. */
export interface BlockMessage {
  type: 'block';
  samples: Float32Array;
  /** Total acumulado de amostras mono emitidas até o fim deste bloco. */
  endSample: number;
  /** currentTime do AudioContext (s) no fim do bloco. */
  frameTime: number;
  rms: number;
  peak: number;
  channels: ChannelLevel[];
}

/** Bloco entregue ao motor de detecção. */
export interface AudioBlock {
  samples: Float32Array;
  endSample: number;
  frameTime: number;
  /** currentTime do AudioContext (s) no momento em que a thread principal recebeu o bloco. */
  contextNow: number;
  receivedAt: number;
}

export interface CaptureSettings {
  /**
   * Redução de ruído do próprio navegador (constraint noiseSuppression).
   * Desligada por padrão porque pode alterar o timbre e prejudicar a altura.
   */
  browserNoiseReduction: boolean;
  /** Sensibilidade 0..100 do portão de silêncio do detector. */
  sensitivity: number;
  /** Janela de análise do detector, em amostras. */
  windowSize: WindowSize;
  /** Filtros passa-faixa e limiar adaptativo ao ruído de fundo, no detector. */
  detectorNoiseFilter: boolean;
  /** Canal usado pelo detector. */
  channelMode: ChannelMode;
}

export type WindowSize = 2048 | 4096 | 8192;

export const WINDOW_SIZES: readonly WindowSize[] = [2048, 4096, 8192];

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  browserNoiseReduction: false,
  sensitivity: 70,
  windowSize: 4096,
  detectorNoiseFilter: true,
  channelMode: 'sum',
};

/**
 * Nós da captura que o Estúdio (src/fx) usa para ouvir a guitarra. O Estúdio cria um ramo PARALELO
 * a partir da fonte; o caminho do detector (fonte -> worklet de captura) não é alterado.
 */
export interface CaptureGraph {
  context: AudioContext;
  source: AudioNode;
}

export interface AudioOutputDevice {
  /** Vazio = saída padrão do sistema. */
  deviceId: string;
  label: string;
}

export interface CaptureInfo {
  deviceLabel: string;
  sampleRate: number;
  baseLatencyMs: number | null;
  outputLatencyMs: number | null;
  /** O que o navegador reporta ter aplicado (pode ignorar o pedido). */
  appliedProcessing: {
    echoCancellation: boolean | null;
    noiseSuppression: boolean | null;
    autoGainControl: boolean | null;
  };
  /** Canais que o navegador reporta para a trilha (o worklet confirma o valor real em uso). */
  channelCount: number | null;
}
