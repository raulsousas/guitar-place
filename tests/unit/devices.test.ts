import { describe, expect, it, vi } from 'vitest';
import { listAudioInputs, toAudioInputs, watchDeviceChanges } from '../../src/audio/devices';

// Estes objetos imitam a resposta do navegador apenas dentro dos testes.
function info(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: '', toJSON: () => ({}) } as MediaDeviceInfo;
}

describe('toAudioInputs', () => {
  it('mantém apenas entradas de áudio', () => {
    const r = toAudioInputs([
      info('audioinput', 'a', 'Focusrite USB'),
      info('audiooutput', 'b', 'Alto-falantes'),
      info('videoinput', 'c', 'Câmera'),
    ]);
    expect(r.devices).toEqual([{ deviceId: 'a', label: 'Focusrite USB' }]);
    expect(r.labelsAvailable).toBe(true);
  });

  it('usa nomes genéricos e sinaliza rótulos ocultos antes da permissão', () => {
    const r = toAudioInputs([info('audioinput', '', ''), info('audioinput', '', '')]);
    expect(r.labelsAvailable).toBe(false);
    expect(r.devices.map((d) => d.label)).toEqual(['Entrada de áudio 1', 'Entrada de áudio 2']);
  });

  it('lista vazia: nenhum dispositivo', () => {
    const r = toAudioInputs([info('audiooutput', 'x', 'Fone')]);
    expect(r.devices).toEqual([]);
    expect(r.labelsAvailable).toBe(false);
  });
});

describe('listAudioInputs / watchDeviceChanges', () => {
  it('consulta enumerateDevices', async () => {
    const enumerateDevices = vi.fn().mockResolvedValue([info('audioinput', 'a', 'Mic')]);
    const r = await listAudioInputs({ enumerateDevices });
    expect(r.devices).toHaveLength(1);
    expect(enumerateDevices).toHaveBeenCalledOnce();
  });

  it('registra e remove o ouvinte de devicechange', () => {
    const add = vi.fn();
    const remove = vi.fn();
    const cb = vi.fn();
    const stop = watchDeviceChanges(cb, {
      enumerateDevices: vi.fn(),
      addEventListener: add,
      removeEventListener: remove,
    });
    expect(add).toHaveBeenCalledWith('devicechange', cb);
    stop();
    expect(remove).toHaveBeenCalledWith('devicechange', cb);
  });
});
