import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    applyAuto: () => undefined,
    undoAuto: () => undefined,
    canUndoAuto: false,
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
    measureLoopback: () => Promise.resolve({ ok: false as const, reason: 'unavailable' as const }),
    measureNoise: () => Promise.resolve({ ok: false as const, reason: 'unavailable' as const }),
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
describe('Portão de ruído (interface)', () => {
  it('bloco aparece na cadeia e em Efeitos, desligado por padrão, com aviso de atraso e do limiar', () => {
    render(<StudioPanel studio={api()} />);
    expect(screen.getByTestId('chain-gate')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('gate-switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('gate-threshold')).toBeInTheDocument();
    expect(screen.getByTestId('studio-pane-effects')).toHaveTextContent(/cerca de 5 ms de atraso/);
    expect(screen.getByTestId('studio-pane-effects')).toHaveTextContent(/Limiar alto demais corta/);
  });

  it('ligar o portão altera só o bloco do portão', () => {
    const update = vi.fn();
    render(<StudioPanel studio={api({ update })} />);
    fireEvent.click(screen.getByTestId('gate-switch'));
    const next = (update.mock.calls[0]![0] as (p: typeof DEFAULT_STUDIO) => typeof DEFAULT_STUDIO)(structuredClone(DEFAULT_STUDIO));
    expect(next.gate.enabled).toBe(true);
    expect(next.gate.thresholdDb).toBe(DEFAULT_STUDIO.gate.thresholdDb);
    expect(next.drive).toEqual(DEFAULT_STUDIO.drive);
    expect(next.masterDb).toBe(DEFAULT_STUDIO.masterDb);
  });

  it('medir ruído: sucesso define limiar e liga o portão, mostrando o que foi medido', async () => {
    const update = vi.fn();
    const measureNoise = vi.fn().mockResolvedValue({ ok: true, noiseDb: -62, thresholdDb: -51 });
    render(<StudioPanel studio={api({ update, measureNoise, available: true, outputEnabled: true })} />);
    fireEvent.click(screen.getByTestId('noise-measure-btn'));
    await waitFor(() => expect(screen.getByTestId('noise-measure-result')).toBeInTheDocument());
    expect(screen.getByTestId('noise-measure-result')).toHaveTextContent('-62 dBFS');
    expect(screen.getByTestId('noise-measure-result')).toHaveTextContent('-51 dB');
    const next = (update.mock.calls[0]![0] as (p: typeof DEFAULT_STUDIO) => typeof DEFAULT_STUDIO)(structuredClone(DEFAULT_STUDIO));
    expect(next.gate).toEqual({ enabled: true, thresholdDb: -51 });
    expect(next.masterDb).toBe(DEFAULT_STUDIO.masterDb);
  });

  it.each([
    ['unavailable', /Ligue a saída/],
    ['too-loud', /Abafe as cordas/],
    ['unstable', /variou durante a medida/],
    ['no-signal', /Nenhum sinal chegou/],
  ])('medir ruído: falha %s mostra mensagem clara e não altera parâmetros', async (reason, text) => {
    const update = vi.fn();
    const measureNoise = vi.fn().mockResolvedValue({ ok: false, reason });
    render(<StudioPanel studio={api({ update, measureNoise })} />);
    fireEvent.click(screen.getByTestId('noise-measure-btn'));
    await waitFor(() => expect(screen.getByTestId('noise-measure-error')).toBeInTheDocument());
    expect(screen.getByTestId('noise-measure-error')).toHaveTextContent(text);
    expect(update).not.toHaveBeenCalled();
  });

  it('predefinições de distorção ligam o portão; as limpas não', async () => {
    const { STUDIO_PRESETS } = await import('../../src/fx/presets');
    const gate = (id: string) => STUDIO_PRESETS.find((p) => p.id === id)!.params.gate.enabled;
    expect(gate('crunch')).toBe(true);
    expect(gate('lead')).toBe(true);
    expect(gate('direct')).toBe(false);
    expect(gate('clean')).toBe(false);
  });
});
describe('Medidor de latência por loopback (interface)', () => {
  it('traz as instruções do cabo e o botão fica bloqueado sem captura', () => {
    render(<StudioPanel studio={api()} />);
    const box = screen.getByTestId('studio-loopback');
    expect(box).toHaveTextContent(/SAÍDA da interface/);
    expect(box).toHaveTextContent(/monitoramento direto/);
    expect(screen.getByTestId('loopback-btn')).toBeDisabled();
    expect(screen.queryByTestId('loopback-result')).not.toBeInTheDocument();
    expect(screen.getByTestId('studio-latency')).toHaveTextContent(/medidor por loopback/);
  });

  it('sucesso: mostra mediana, mínimo, máximo e as ressalvas, sem prometer o valor para outro equipamento', async () => {
    const measureLoopback = vi.fn().mockResolvedValue({ ok: true, matched: 10, total: 10, minMs: 31.2, medianMs: 32.5, maxMs: 34.1, extraneous: 0 });
    render(<StudioPanel studio={api({ available: true, measureLoopback })} />);
    fireEvent.click(screen.getByTestId('loopback-btn'));
    await waitFor(() => expect(screen.getByTestId('loopback-result')).toBeInTheDocument());
    const r = screen.getByTestId('loopback-result');
    expect(r).toHaveTextContent('Mediana: 32.5 ms');
    expect(r).toHaveTextContent('mínimo 31.2 ms');
    expect(r).toHaveTextContent('máximo 34.1 ms');
    expect(r).toHaveTextContent('10 de 10 cliques');
    expect(r).toHaveTextContent(/Não inclui o detector/);
    expect(r).toHaveTextContent(/não vale para outra combinação/);
  });

  it.each([
    ['output-on', /Desligue a saída do Estúdio/],
    ['no-signal', /Nenhum clique voltou/],
    ['noisy', /Pare de tocar/],
    ['too-fast', /atalho/],
    ['unstable', /variaram mais de/],
  ])('falha %s: mensagem clara, nenhum número inventado', async (reason, text) => {
    const measureLoopback = vi.fn().mockResolvedValue({ ok: false, reason, matched: 0, total: 10, latenciesMs: [] });
    render(<StudioPanel studio={api({ available: true, measureLoopback })} />);
    fireEvent.click(screen.getByTestId('loopback-btn'));
    await waitFor(() => expect(screen.getByTestId('loopback-error')).toBeInTheDocument());
    expect(screen.getByTestId('loopback-error')).toHaveTextContent(text);
    expect(screen.queryByTestId('loopback-result')).not.toBeInTheDocument();
  });
});
