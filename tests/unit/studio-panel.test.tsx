import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StudioPanel } from '../../src/components/studio/StudioPanel';
import { StudioMeters } from '../../src/components/studio/OutputSection';
import type { StudioApi } from '../../src/hooks/useStudio';
import { DEFAULT_STUDIO } from '../../src/fx/presets';
import { App } from '../../src/App';

// Mock apenas de props de interface: o motor de áudio é testado em studio-engine.test.ts.
function api(over: Partial<StudioApi> = {}): StudioApi {
  return {
    available: false,
    params: structuredClone(DEFAULT_STUDIO),
    update: () => undefined,
    presetId: 'direct',
    applyPreset: () => undefined,
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

describe('StudioPanel', () => {
  it('sem captura: saída desligada e bloqueada, aviso de fones visível, sem medidores inventados', () => {
    render(<StudioPanel studio={api()} />);
    expect(screen.getByTestId('studio-output-switch')).toBeDisabled();
    expect(screen.getByTestId('studio-output-switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('studio-output-state')).toHaveTextContent(/Indisponível: inicie a captura/);
    expect(screen.getByTestId('studio-feedback-warning')).toHaveTextContent(/fones de ouvido/i);
    expect(screen.getByTestId('studio-feedback-warning')).toHaveTextContent('-18 dB');
    expect(screen.getByTestId('studio-test-tone')).toBeDisabled();
    expect(screen.getByTestId('studio-meters-off')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-meters')).not.toBeInTheDocument();
  });

  it('privacidade, monitoramento direto e latência sem número inventado', () => {
    render(<StudioPanel studio={api()} />);
    expect(screen.getByTestId('studio-privacy')).toHaveTextContent(/sem envio de dados/);
    expect(screen.getByTestId('studio-direct-monitoring')).toHaveTextContent(/monitoramento direto/i);
    expect(screen.getByTestId('studio-direct-monitoring')).toHaveTextContent(/ASIO/);
    const lat = screen.getByTestId('studio-latency');
    expect(lat).toHaveTextContent(/não medições/);
    expect(lat).toHaveTextContent('n/d');
  });

  it('latência: mostra só o que o navegador reporta, rotulado como estimativa', () => {
    render(<StudioPanel studio={api({ available: true, readLatency: () => ({ baseMs: 10.7, outputMs: null }) })} />);
    const lat = screen.getByTestId('studio-latency');
    expect(lat).toHaveTextContent('10.7 ms');
    expect(lat).toHaveTextContent('n/d');
    expect(lat).toHaveTextContent(/reportada pelo navegador/);
  });

  it('com captura: liga a saída por ação explícita do usuário', () => {
    const set = vi.fn();
    render(<StudioPanel studio={api({ available: true, setOutputEnabled: set })} />);
    const sw = screen.getByTestId('studio-output-switch');
    expect(sw).toBeEnabled();
    expect(set).not.toHaveBeenCalled();
    fireEvent.click(sw);
    expect(set).toHaveBeenCalledWith(true);
  });

  it('saída ligada: o estado é anunciado e o interruptor desliga', () => {
    const set = vi.fn();
    render(<StudioPanel studio={api({ available: true, outputEnabled: true, setOutputEnabled: set })} />);
    expect(screen.getByTestId('studio-output-state')).toHaveTextContent('Saída LIGADA');
    fireEvent.click(screen.getByTestId('studio-output-switch'));
    expect(set).toHaveBeenCalledWith(false);
  });

  it('seleção de saída: indisponível sem setSinkId, lista real quando há suporte', () => {
    const { unmount } = render(<StudioPanel studio={api({ available: true })} />);
    expect(screen.getByTestId('studio-device-unsupported')).toHaveTextContent(/Indisponível neste navegador/);
    expect(screen.queryByTestId('studio-device')).not.toBeInTheDocument();
    unmount();
    const pick = vi.fn();
    render(
      <StudioPanel
        studio={api({
          available: true,
          outputSelectionSupported: true,
          outputDevices: [{ deviceId: 'abc', label: 'Fones USB' }],
          selectOutputDevice: pick,
        })}
      />,
    );
    const sel = screen.getByTestId('studio-device');
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['Saída padrão do sistema', 'Fones USB']);
    fireEvent.change(sel, { target: { value: 'abc' } });
    expect(pick).toHaveBeenCalledWith('abc');
  });

  it('erro de saída é mostrado como alerta', () => {
    render(<StudioPanel studio={api({ available: true, outputSelectionSupported: true, outputError: 'Saída indisponível' })} />);
    expect(screen.getByTestId('studio-output-error')).toHaveTextContent('Saída indisponível');
  });

  it('tom de teste chama o motor', () => {
    const tone = vi.fn();
    render(<StudioPanel studio={api({ available: true, playTestTone: tone })} />);
    fireEvent.click(screen.getByTestId('studio-test-tone'));
    expect(tone).toHaveBeenCalledOnce();
  });

  it('sub-abas Efeitos, Amplificador, Gabinete e Mixer trazem seus controles', () => {
    render(<StudioPanel studio={api()} />);
    for (const id of ['drive-drive', 'drive-tone', 'drive-level', 'eq-low', 'eq-mid', 'eq-high', 'delay-time', 'delay-feedback', 'delay-mix', 'reverb-decay', 'reverb-mix']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId('studio-tab-amp'));
    for (const id of ['amp-gain', 'amp-bass', 'amp-mid', 'amp-treble', 'amp-level']) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId('amp-voicing')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('studio-tab-cabinet'));
    expect(screen.getByTestId('cabinet-kind')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('studio-tab-mixer'));
    for (const id of ['studio-channel', 'studio-trim']) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it('alterar um botão chama update com o valor novo e invalida a predefinição', () => {
    const update = vi.fn();
    render(<StudioPanel studio={api({ update })} />);
    fireEvent.change(screen.getByTestId('drive-drive'), { target: { value: '0.8' } });
    expect(update).toHaveBeenCalledOnce();
    const next = (update.mock.calls[0]![0] as (p: typeof DEFAULT_STUDIO) => typeof DEFAULT_STUDIO)(structuredClone(DEFAULT_STUDIO));
    expect(next.drive.drive).toBe(0.8);
    expect(next.drive.enabled).toBe(false); // não liga o bloco sozinho
    expect(next.masterDb).toBe(-18);
  });

  it('interruptor do bloco e cadeia ligam o bloco correspondente', () => {
    const update = vi.fn();
    render(<StudioPanel studio={api({ update })} />);
    fireEvent.click(screen.getByTestId('delay-switch'));
    fireEvent.click(screen.getByTestId('chain-reverb'));
    const apply = (i: number) => (update.mock.calls[i]![0] as (p: typeof DEFAULT_STUDIO) => typeof DEFAULT_STUDIO)(structuredClone(DEFAULT_STUDIO));
    expect(apply(0).delay.enabled).toBe(true);
    expect(apply(1).reverb.enabled).toBe(true);
  });

  it('predefinição: lista as quatro e aplica a escolhida', () => {
    const applyPreset = vi.fn();
    render(<StudioPanel studio={api({ applyPreset })} />);
    expect(within(screen.getByTestId('studio-preset')).getAllByRole('option')).toHaveLength(4);
    fireEvent.change(screen.getByTestId('studio-preset'), { target: { value: 'crunch' } });
    expect(applyPreset).toHaveBeenCalledWith('crunch');
  });

  it('não usa nomes de marcas de equipamentos', () => {
    const { container } = render(<StudioPanel studio={api()} />);
    fireEvent.click(screen.getByTestId('studio-tab-amp'));
    fireEvent.click(screen.getByTestId('studio-tab-cabinet'));
    expect(container.textContent).not.toMatch(/marshall|fender|celestion|tube screamer|boss|vox|mesa|orange/i);
    expect(container.textContent).toMatch(/Não é um modelo de equipamento real|Sem respostas de impulso de equipamentos reais/);
  });
});

describe('StudioMeters', () => {
  it('sem captura mostra o aviso e nenhum nível', () => {
    render(<StudioMeters studio={api()} />);
    expect(screen.getByTestId('studio-meters-off')).toBeInTheDocument();
  });
});

describe('Aba Estúdio no App', () => {
  it('a aba existe, o Rastreador continua sendo o padrão e o Estúdio abre com a saída bloqueada', () => {
    render(<App />);
    expect(screen.getByTestId('fretboard-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tab-studio'));
    expect(screen.getByTestId('studio-view')).toBeInTheDocument();
    expect(screen.queryByTestId('fretboard-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('studio-output-switch')).toBeDisabled();
    expect(screen.getByTestId('studio-output-switch')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByTestId('tab-tracker'));
    expect(screen.getByTestId('fretboard-panel')).toBeInTheDocument();
  });
});