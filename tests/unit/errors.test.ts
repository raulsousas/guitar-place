import { describe, expect, it } from 'vitest';
import { AudioCaptureError, describeAudioError, mapCaptureError } from '../../src/audio/errors';

function domError(name: string, message = ''): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe('mapCaptureError', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'device-not-found'],
    ['OverconstrainedError', 'device-not-found'],
    ['NotReadableError', 'device-busy'],
    ['AbortError', 'device-busy'],
    ['SomethingElse', 'unknown'],
  ])('%s -> %s', (name, kind) => {
    expect(mapCaptureError(domError(name)).kind).toBe(kind);
  });

  it('preserva o erro já classificado', () => {
    expect(mapCaptureError(new AudioCaptureError('worklet-failed')).kind).toBe('worklet-failed');
  });

  it('trata valores que não são Error', () => {
    expect(mapCaptureError('falha').kind).toBe('unknown');
    expect(mapCaptureError(null).kind).toBe('unknown');
  });

  it('anexa o detalhe técnico quando existe', () => {
    expect(mapCaptureError(domError('NotReadableError', 'Could not start')).message).toContain(
      'Could not start',
    );
  });
});

describe('mensagens de erro', () => {
  const kinds = [
    'unsupported',
    'permission-denied',
    'no-devices',
    'device-not-found',
    'device-busy',
    'device-disconnected',
    'context-suspended',
    'worklet-failed',
    'unknown',
  ] as const;

  it.each(kinds)('%s tem título, mensagem e instruções de recuperação', (kind) => {
    const e = describeAudioError(kind);
    expect(e.title.length).toBeGreaterThan(0);
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.instructions.length).toBeGreaterThan(0);
  });
});
