/** Resultado de decodificar um arquivo de áudio local, já em mono. */
export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  durationS: number;
}

/** Tamanho máximo do arquivo aceito (bytes): decodificar vira PCM de 32 bits e consome muito mais memória. */
export const MAX_FILE_BYTES = 60 * 1024 * 1024;
/** Trecho analisado (s). Arquivos mais longos usam este trecho a partir de 25% da duração. */
export const MAX_ANALYZED_S = 120;
const DECODE_RATE = 44100;

export class DecodeError extends Error {
  constructor(public readonly kind: 'too-large' | 'unsupported' | 'decode-failed') {
    super(kind);
  }
}

/** Mistura os canais em mono e recorta o trecho central. Pura (testável sem o navegador). */
export function toMonoSegment(channels: readonly Float32Array[], sampleRate: number): DecodedAudio {
  const n = channels[0]?.length ?? 0;
  const maxLen = Math.round(MAX_ANALYZED_S * sampleRate);
  const start = n > maxLen ? Math.min(n - maxLen, Math.floor(n * 0.25)) : 0;
  const len = Math.min(n - start, maxLen);
  const out = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) out[i]! += ch[start + i]! / channels.length;
  return { samples: out, sampleRate, durationS: len / sampleRate };
}

/**
 * Decodifica um arquivo escolhido pelo usuário, localmente. Usa um contexto OFFLINE: não abre dispositivo
 * de áudio, não toca nada e nada sai do navegador.
 */
export async function decodeAudioFile(file: File): Promise<DecodedAudio> {
  if (file.size > MAX_FILE_BYTES) throw new DecodeError('too-large');
  if (typeof OfflineAudioContext === 'undefined') throw new DecodeError('unsupported');
  const bytes = await file.arrayBuffer();
  let buffer: AudioBuffer;
  try {
    buffer = await new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(bytes);
  } catch {
    throw new DecodeError('decode-failed');
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return toMonoSegment(channels, buffer.sampleRate);
}
