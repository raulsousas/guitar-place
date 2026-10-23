import type { AudioInputDevice, AudioOutputDevice, DeviceListing } from '../types/audio';

/** Contrato mínimo de MediaDevices usado aqui (facilita testes sem simular áudio no app). */
export interface MediaDevicesLike {
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  addEventListener(type: 'devicechange', listener: () => void): void;
  removeEventListener(type: 'devicechange', listener: () => void): void;
}

export function isCaptureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined'
  );
}

/**
 * Converte a lista bruta do navegador em entradas de áudio.
 * Antes da permissão de microfone os rótulos vêm vazios; nesse caso usamos
 * nomes genéricos numerados e sinalizamos `labelsAvailable: false`.
 */
export function toAudioInputs(infos: readonly MediaDeviceInfo[]): DeviceListing {
  const inputs = infos.filter((d) => d.kind === 'audioinput');
  const labelsAvailable = inputs.length > 0 && inputs.every((d) => d.label.trim().length > 0);
  const devices: AudioInputDevice[] = inputs.map((d, i) => ({
    deviceId: d.deviceId,
    label: d.label.trim().length > 0 ? d.label : `Entrada de áudio ${i + 1}`,
  }));
  return { devices, labelsAvailable };
}

export async function listAudioInputs(
  mediaDevices: Pick<MediaDevicesLike, 'enumerateDevices'> = navigator.mediaDevices,
): Promise<DeviceListing> {
  return toAudioInputs(await mediaDevices.enumerateDevices());
}

/** Observa conexões/desconexões de dispositivos. Retorna a função de cancelamento. */
export function watchDeviceChanges(
  onChange: () => void,
  mediaDevices: MediaDevicesLike = navigator.mediaDevices,
): () => void {
  mediaDevices.addEventListener('devicechange', onChange);
  return () => mediaDevices.removeEventListener('devicechange', onChange);
}

/** Saídas de áudio (fones, caixas). Vazia quando o navegador não lista saídas. */
export function toAudioOutputs(infos: readonly MediaDeviceInfo[]): AudioOutputDevice[] {
  return infos
    .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label.trim().length > 0 ? d.label : `Saída de áudio ${i + 1}`,
    }));
}

export async function listAudioOutputs(
  mediaDevices: Pick<MediaDevicesLike, 'enumerateDevices'> = navigator.mediaDevices,
): Promise<AudioOutputDevice[]> {
  return toAudioOutputs(await mediaDevices.enumerateDevices());
}