import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listAudioOutputs, watchDeviceChanges } from '../audio/devices';
import { thresholdFromNoise, type NoiseMeasure } from '../fx/curves';
import { StudioEngine } from '../fx/engine';
import type { LoopbackOutcome } from '../fx/loopback';
import { runLoopback } from '../fx/loopback-runner';
import { DEFAULT_STUDIO, STUDIO_PRESETS } from '../fx/presets';
import type { StudioLevels, StudioParams } from '../fx/types';
import type { AudioOutputDevice, CaptureGraph } from '../types/audio';

export interface BrowserLatency {
  /** `AudioContext.baseLatency` em ms (estimativa do navegador, não uma medição). */
  baseMs: number | null;
  /** `AudioContext.outputLatency` em ms (estimativa do navegador; 0 ou ausente antes de tocar). */
  outputMs: number | null;
}

export interface StudioApi {
  /** Há captura ativa: só então existe motor e a saída pode ser ligada. */
  available: boolean;
  params: StudioParams;
  /** Substitui os parâmetros (limites são aplicados pelo motor). */
  update(patch: (p: StudioParams) => StudioParams): void;
  presetId: string | null;
  applyPreset(id: string): void;
  /** Aplica ajustes calculados (ex.: pela análise de uma música). Guarda os anteriores para desfazer. Não altera volume geral, canal nem ganho de entrada. */
  applyAuto(params: StudioParams): void;
  /** Desfaz o último ajuste automático. */
  undoAuto(): void;
  canUndoAuto: boolean;
  outputEnabled: boolean;
  setOutputEnabled(enabled: boolean): void;
  outputDevices: AudioOutputDevice[];
  outputDeviceId: string;
  outputSelectionSupported: boolean;
  selectOutputDevice(deviceId: string): void;
  outputError: string | null;
  playTestTone(): void;
  /** Níveis do último bloco; null sem captura. Chamar a cada quadro apenas por quem exibe medidores. */
  readLevels(): StudioLevels | null;
  readLatency(): BrowserLatency | null;
  /**
   * Mede o ruído de fundo da entrada por MEASURE_MS (cordas abafadas) e sugere o limiar do portão. Exige a saída ligada
   * (só então o sinal chega ao motor). Não altera nenhum parâmetro: quem chama decide aplicar.
   */
  measureNoise(): Promise<NoiseMeasure | { ok: false; reason: 'unavailable' }>;
  /**
   * Mede a latência de ida e volta por loopback (cabo da saída da interface para a entrada). Toca cliques direto na saída, sem
   * passar pelos efeitos. Recusa se a saída do Estúdio estiver LIGADA (fecharia um laço de realimentação).
   */
  measureLoopback(): Promise<LoopbackOutcome>;
}

/** Duração da medida de ruído (ms) e intervalo entre leituras. 2 s dão ~60 quadros de 1024 amostras. */
export const MEASURE_MS = 2000;
const MEASURE_STEP_MS = 30;

/**
 * Liga o Estúdio (src/fx) à captura. O motor nasce quando a captura inicia e morre quando ela para, é
 * interrompida ou o dispositivo some. A saída SEMPRE recomeça desligada: ligar exige ação explícita do
 * usuário a cada captura. Os parâmetros persistem entre capturas.
 *
 * O detector não é tocado: o Estúdio cria um ramo paralelo a partir da mesma fonte (ver `CaptureGraph`).
 */
export function useStudio(graph: CaptureGraph | null): StudioApi {
  const [params, setParams] = useState<StudioParams>(() => structuredClone(DEFAULT_STUDIO));
  const [presetId, setPresetId] = useState<string | null>('direct');
  const [undoParams, setUndoParams] = useState<StudioParams | null>(null);
  // Guardar o grafo para o qual a saída foi ligada faz a saída "desligar" sozinha quando o grafo muda.
  const [enabledFor, setEnabledFor] = useState<CaptureGraph | null>(null);
  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [outputDeviceId, setOutputDeviceId] = useState('');
  const [outputError, setOutputError] = useState<string | null>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const outputEnabled = graph !== null && enabledFor === graph;
  const outputSelectionSupported = useMemo(
    () => graph !== null && StudioEngine.supportsOutputSelection(graph.context),
    [graph],
  );

  // Motor: um por captura. Declarado antes dos efeitos que o usam (a ordem de execução é a de declaração).
  useEffect(() => {
    if (!graph) return undefined;
    const engine = new StudioEngine(graph.context, graph.source);
    engineRef.current = engine;
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [graph]);

  useEffect(() => {
    engineRef.current?.setParams(params);
  }, [params, graph]);

  useEffect(() => {
    engineRef.current?.setOutputEnabled(outputEnabled);
  }, [outputEnabled, graph]);

  // A saída escolhida volta ao padrão quando o contexto é recriado: reaplica a escolha.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !outputSelectionSupported) return undefined;
    let cancelled = false;
    engine.setOutputDevice(outputDeviceId).then(
      () => {
        if (!cancelled) setOutputError(null);
      },
      () => {
        if (!cancelled) {
          setOutputError('Não foi possível usar essa saída de áudio. Ela pode ter sido desconectada; escolha outra.');
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [graph, outputDeviceId, outputSelectionSupported]);

  // Lista de saídas: real, via enumerateDevices; atualiza quando algo é conectado ou removido.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return undefined;
    let alive = true;
    const refresh = () => {
      listAudioOutputs().then(
        (list) => {
          if (!alive) return;
          setOutputDevices(list);
          // Saída escolhida sumiu: volta para o padrão do sistema.
          setOutputDeviceId((cur) => (cur && !list.some((d) => d.deviceId === cur) ? '' : cur));
        },
        () => {
          if (alive) setOutputDevices([]);
        },
      );
    };
    refresh();
    const unwatch = watchDeviceChanges(refresh);
    return () => {
      alive = false;
      unwatch();
    };
  }, [graph]);

  const update = useCallback((patch: (p: StudioParams) => StudioParams) => {
    setParams((p) => patch(p));
    setPresetId(null);
  }, []);

  const applyPreset = useCallback((id: string) => {
    const preset = STUDIO_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    // Preset não mexe no volume geral nem no canal: evita um salto de volume ao trocar de som.
    setParams((cur) => ({
      ...structuredClone(preset.params),
      masterDb: cur.masterDb,
      inputChannel: cur.inputChannel,
      inputTrimDb: cur.inputTrimDb,
    }));
    setPresetId(id);
  }, []);

  const applyAuto = useCallback((next: StudioParams) => {
    const cur = paramsRef.current;
    setUndoParams(cur);
    // Defesa: mesmo que o chamador envie outros valores, estes três nunca mudam por ajuste automático.
    setParams({ ...structuredClone(next), masterDb: cur.masterDb, inputChannel: cur.inputChannel, inputTrimDb: cur.inputTrimDb });
    setPresetId(null);
  }, []);

  const undoAuto = useCallback(() => {
    if (!undoParams) return;
    setParams(undoParams);
    setUndoParams(null);
    setPresetId(null);
  }, [undoParams]);

  const setOutputEnabled = useCallback(
    (enabled: boolean) => {
      setEnabledFor(enabled ? graph : null);
    },
    [graph],
  );

  return {
    available: graph !== null,
    params,
    update,
    presetId,
    applyPreset,
    applyAuto,
    undoAuto,
    canUndoAuto: undoParams !== null,
    outputEnabled,
    setOutputEnabled,
    outputDevices,
    outputDeviceId,
    outputSelectionSupported,
    selectOutputDevice: setOutputDeviceId,
    outputError,
    playTestTone: () => engineRef.current?.playTestTone(),
    readLevels: () => engineRef.current?.levels() ?? null,
    measureNoise: () =>
      new Promise((resolve) => {
        const engine = engineRef.current;
        if (!engine || !outputEnabled) {
          resolve({ ok: false, reason: 'unavailable' });
          return;
        }
        const frames: number[] = [];
        const t0 = Date.now();
        const timer = setInterval(() => {
          const l = engine.levels();
          frames.push(l.inputRmsDb);
          if (Date.now() - t0 >= MEASURE_MS) {
            clearInterval(timer);
            resolve(thresholdFromNoise(frames));
          }
        }, MEASURE_STEP_MS);
      }),
    measureLoopback: () => {
      if (!graph) return Promise.resolve({ ok: false, reason: 'unavailable' });
      if (outputEnabled) return Promise.resolve({ ok: false, reason: 'output-on' });
      return runLoopback(graph.context, graph.source);
    },
    readLatency: () => {
      if (!graph) return null;
      const c = graph.context;
      const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v * 1000 : null);
      return { baseMs: ms(c.baseLatency), outputMs: ms((c as { outputLatency?: number }).outputLatency) };
    },
  };
}
