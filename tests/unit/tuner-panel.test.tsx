import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TunerPanel } from '../../src/components/TunerPanel';
import type { AudioCaptureApi } from '../../src/hooks/useAudioCapture';
import { readTuner } from '../../src/music/tuner';
import { frequencyToMidiFloat } from '../../src/music/notes';

// Mock apenas de props de interface (nunca de áudio na aplicação).
function api(over: Partial<AudioCaptureApi>): AudioCaptureApi {
  return {
    supported: true,
    status: 'idle',
    error: null,
    devices: [],
    labelsAvailable: false,
    selectedDeviceId: '',
    settings: {} as AudioCaptureApi['settings'],
    info: null,
    meter: { level: 0, peak: 0, rmsDb: -Infinity, clipping: false },
    channelMeters: [],
    live: {} as AudioCaptureApi['live'],
    tuner: null,
    events: [],
    lastNote: null,
    stats: null,
    contextSuspended: false,
    selectDevice: () => undefined,
    updateSettings: () => undefined,
    clearEvents: () => undefined,
    start: async () => undefined,
    stop: async () => undefined,
    resume: async () => undefined,
    ...over,
  } as AudioCaptureApi;
}

describe('TunerPanel', () => {
  it('parado: sem leitura inventada, instrução clara e botão Iniciar', () => {
    render(<TunerPanel audio={api({})} />);
    expect(screen.getByTestId('tuner-note')).toHaveTextContent('—');
    expect(screen.getByTestId('tuner-hz')).toHaveTextContent('— Hz');
    expect(screen.getByTestId('tuner-message')).toHaveTextContent('Inicie a captura para afinar');
    expect(screen.getByTestId('tuner-stage')).toHaveAttribute('data-state', 'idle');
    expect(screen.getByTestId('tuner-start')).toBeEnabled();
    expect(screen.getByTestId('tuner-gauge')).toHaveAttribute('data-angle', '0.0');
  });

  it('exibe os quatro passos', () => {
    render(<TunerPanel audio={api({})} />);
    expect(screen.getByTestId('tuner-steps').querySelectorAll('article')).toHaveLength(4);
    expect(screen.getByText('Passo 4')).toBeInTheDocument();
  });

  it('A4 afinado: nota em verde (estado in-tune), 440 Hz, ponteiro no centro', () => {
    const tuner = readTuner(frequencyToMidiFloat(440));
    render(<TunerPanel audio={api({ status: 'active', tuner })} />);
    expect(screen.getByTestId('tuner-stage')).toHaveAttribute('data-state', 'in-tune');
    expect(screen.getByTestId('tuner-note')).toHaveTextContent('A');
    expect(screen.getByTestId('tuner-note')).toHaveTextContent('4');
    expect(screen.getByTestId('tuner-hz')).toHaveTextContent('440,00 Hz');
    expect(screen.getByTestId('tuner-message')).toHaveTextContent('Afinada');
    expect(Number(screen.getByTestId('tuner-gauge').getAttribute('data-angle'))).toBeCloseTo(0, 1);
    expect(screen.getByTestId('tuner-stop')).toBeInTheDocument();
  });

  it('G3 20 cents acima: fora do tom, ponteiro à direita, orienta afrouxar', () => {
    const tuner = readTuner(frequencyToMidiFloat(196 * Math.pow(2, 20 / 1200)));
    render(<TunerPanel audio={api({ status: 'active', tuner })} />);
    expect(screen.getByTestId('tuner-stage')).toHaveAttribute('data-state', 'off');
    expect(Number(screen.getByTestId('tuner-gauge').getAttribute('data-angle'))).toBeGreaterThan(15);
    expect(screen.getByTestId('tuner-message')).toHaveTextContent('afrouxe');
    expect(screen.getByTestId('tuner-cents')).toHaveTextContent('+20 cents');
  });

  it('nota 30 cents abaixo: ponteiro à esquerda, orienta apertar e sugere a corda como estimativa', () => {
    const tuner = readTuner(frequencyToMidiFloat(196 * Math.pow(2, -30 / 1200)));
    render(<TunerPanel audio={api({ status: 'active', tuner })} />);
    expect(Number(screen.getByTestId('tuner-gauge').getAttribute('data-angle'))).toBeLessThan(-15);
    expect(screen.getByTestId('tuner-message')).toHaveTextContent('aperte');
    expect(screen.getByTestId('tuner-string-hint')).toHaveTextContent('3ª (G3)');
    expect(screen.getByTestId('tuner-string-hint')).toHaveTextContent('o áudio não identifica a corda');
  });

  it('ativo sem nota: pede para tocar uma corda', () => {
    render(<TunerPanel audio={api({ status: 'active', tuner: null })} />);
    expect(screen.getByTestId('tuner-message')).toHaveTextContent('Toque uma corda solta');
  });
});
