import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureSession } from '../audio/capture-session';
import { isCaptureSupported, listAudioInputs, watchDeviceChanges } from '../audio/devices';
import { mapCaptureError, describeAudioError } from '../audio/errors';
import { EngineHost, type DetectionLatency, type EngineStats } from '../audio/engine-host';
import { createEngineConfig } from '../dsp/defaults';
import {
  DEFAULT_CAPTURE_SETTINGS,
  type AudioBlock,
  type AudioError,
  type AudioInputDevice,
  type CaptureGraph,
  type CaptureInfo,
  type CaptureSettings,
  type CaptureStatus,
  type LevelReading,
} from '../types/audio';
import { SequenceDecoder } from '../inference/decoder';
import { TabRecorder } from '../tablature/recorder';
import type { FretPosition } from '../music/fretmap';
import type { TabItem } from '../types/tablature';
import { STANDARD_TUNING } from '../music/tuning';
import { TunerSmoother, type TunerReading } from '../music/tuner';
import type { ActiveNote, NoteEvent, PitchFrame } from '../types/engine';
import type { FretRegion, PositionInference, PositionRevision } from '../types/position';

/** Faixa exibida no medidor: -60 dBFS (vazio) a 0 dBFS (clipping). */
const METER_FLOOR_DB = -60;
/** Quantidade máxima de eventos mantidos em memória para a interface. */
const MAX_EVENTS = 500;
const MAX_REVISIONS = 50;

export interface MeterValue {
  /** 0..1 já mapeado para a escala do medidor (dBFS). */
  level: number;
  /** 0..1 do pico, com retenção. */
  peak: number;
  rmsDb: number;
  clipping: boolean;
}

export interface ChannelMeter {
  level: number;
  rmsDb: number;
  peakDb: number;
  clipping: boolean;
}

/** Estado instantâneo do detector, atualizado no ritmo dos quadros de tela. */
export interface LiveDetection {
  /** Nota em andamento, ou null em silêncio / sem nota válida. */
  note: ActiveNote | null;
  /** O portão de silêncio está aberto (há sinal acima do limiar). */
  gateOpen: boolean;
  energyDb: number;
  /** Diagnóstico do portão e da estimativa de altura (último quadro analisado). */
  openDb: number;
  noiseFloorDb: number;
  clarity: number;
  frequency: number | null;
}

const EMPTY_METER: MeterValue = { level: 0, peak: 0, rmsDb: -Infinity, clipping: false };
const EMPTY_LIVE: LiveDetection = {
  note: null,
  gateOpen: false,
  energyDb: -Infinity,
  openDb: -Infinity,
  noiseFloorDb: -Infinity,
  clarity: 0,
  frequency: null,
};

function toDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

function dbToMeter(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

export interface AudioCaptureApi {
  supported: boolean;
  status: CaptureStatus;
  error: AudioError | null;
  devices: AudioInputDevice[];
  labelsAvailable: boolean;
  selectedDeviceId: string;
  settings: CaptureSettings;
  info: CaptureInfo | null;
  /** Contexto e fonte da captura ativa, para o Estúdio ouvir a guitarra (null sem captura). Somente leitura. */
  graph: CaptureGraph | null;
  /** Medidor do canal efetivamente analisado pelo detector. */
  meter: MeterValue;
  /** Medidores por canal de entrada (1 ou 2 itens). */
  channelMeters: ChannelMeter[];
  live: LiveDetection;
  /** Leitura do afinador (nota cromática e cents), ou null sem sinal com altura válida. */
  tuner: TunerReading | null;
  /** Eventos de nota (ataques, mudanças, fins), do mais antigo ao mais recente. */
  events: NoteEvent[];
  /**
   * Inferência de corda/casa (Etapa B) da última nota iniciada. É uma ESTIMATIVA a partir da altura
   * e do contexto: o áudio sozinho não confirma a casa pressionada.
   */
  lastInference: PositionInference | null;
  /** Revisões recentes: notas anteriores cuja posição mudou por causa de notas seguintes (mais nova por último). */
  revisions: PositionRevision[];
  /** Notas e pausas registradas na tablatura (do mais antigo ao mais recente). */
  tabItems: readonly TabItem[];
  /** A gravação da tablatura está pausada (a detecção continua ativa). */
  tabPaused: boolean;
  setTabPaused(paused: boolean): void;
  /**
   * Correção manual da posição de uma nota da tablatura (
ull volta à estimativa do algoritmo).
   * propagated indica se a correção entrou no decodificador como evidência forte (só vale para notas
   * ainda dentro da janela de revisão); caso contrário vale apenas para essa entrada.
   */
  correctTab(id: number, position: FretPosition | null): { propagated: boolean } | null;
  /** Última nota iniciada e a latência medida para ela. */
  lastNote: { event: NoteEvent; latency: DetectionLatency | null } | null;
  stats: EngineStats | null;
  /** true quando o navegador suspendeu o AudioContext (use resume()). */
  contextSuspended: boolean;
  selectDevice(deviceId: string): void;
  updateSettings(patch: Partial<CaptureSettings>): void;
  clearEvents(): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  resume(): Promise<void>;
}

/**
 * Liga a interface ao módulo de captura e ao motor de detecção. Toda a lógica de áudio
 * e de DSP fica em `src/audio` e `src/dsp`; aqui só há estado de interface. Os blocos
 * chegam a cada ~10 ms, mas a tela é atualizada no máximo uma vez por quadro.
 */
export function useAudioCapture(fretCount: number = 24, region: FretRegion | null = null): AudioCaptureApi {
  const supported = isCaptureSupported();
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [error, setError] = useState<AudioError | null>(
    supported ? null : describeAudioError('unsupported'),
  );
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [labelsAvailable, setLabelsAvailable] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [settings, setSettings] = useState<CaptureSettings>(DEFAULT_CAPTURE_SETTINGS);
  const [info, setInfo] = useState<CaptureInfo | null>(null);
  const [graph, setGraph] = useState<CaptureGraph | null>(null);
  const [meter, setMeter] = useState<MeterValue>(EMPTY_METER);
  const [channelMeters, setChannelMeters] = useState<ChannelMeter[]>([]);
  const [live, setLive] = useState<LiveDetection>(EMPTY_LIVE);
  const [tuner, setTuner] = useState<TunerReading | null>(null);
  const [events, setEvents] = useState<NoteEvent[]>([]);
  const [lastInference, setLastInference] = useState<PositionInference | null>(null);
  const [revisions, setRevisions] = useState<PositionRevision[]>([]);
  const [tabItems, setTabItems] = useState<readonly TabItem[]>([]);
  const [tabPaused, setTabPausedState] = useState(false);
  const [lastNote, setLastNote] = useState<AudioCaptureApi['lastNote']>(null);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [contextSuspended, setContextSuspended] = useState(false);

  const sessionRef = useRef<CaptureSession | null>(null);
  const hostRef = useRef<EngineHost | null>(null);
  const latestRef = useRef<LevelReading | null>(null);
  const peakHoldRef = useRef({ value: 0, at: 0 });
  const rafRef = useRef<number | null>(null);
  const settingsRef = useRef(settings);
  const selectedRef = useRef(selectedDeviceId);
  const eventsRef = useRef<NoteEvent[]>([]);
  const eventsDirtyRef = useRef(false);
  const lastNoteRef = useRef<AudioCaptureApi['lastNote']>(null);
  const lastNoteDirtyRef = useRef(false);
  const frameRef = useRef<PitchFrame | null>(null);
  const smootherRef = useRef(new TunerSmoother());
  const tunerRef = useRef<TunerReading | null>(null);
  const lastStatsAtRef = useRef(0);
  const fretCountRef = useRef(fretCount);
  const regionRef = useRef(region);
  const decoderRef = useRef<SequenceDecoder | null>(null);
  const recorderRef = useRef(new TabRecorder());
  const revisionsRef = useRef<PositionRevision[]>([]);
  const inferenceRef = useRef<PositionInference | null>(null);
  const inferenceDirtyRef = useRef(false);

  useEffect(() => {
    // Mudar o número de casas ou a região declarada reinicia o contexto da inferência.
    fretCountRef.current = fretCount;
    regionRef.current = region;
    decoderRef.current = new SequenceDecoder(STANDARD_TUNING, fretCount, region);
    revisionsRef.current = [];
    // Os identificadores do decodificador antigo não valem mais: as entradas ficam, sem vínculo.
    recorderRef.current.detach();
    inferenceDirtyRef.current = true;
  }, [fretCount, region]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    selectedRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  const refreshDevices = useCallback(async () => {
    if (!supported) return;
    try {
      const listing = await listAudioInputs();
      setDevices(listing.devices);
      setLabelsAvailable(listing.labelsAvailable);
      setSelectedDeviceId((current) =>
        current && !listing.devices.some((d) => d.deviceId === current) ? '' : current,
      );
    } catch {
      setDevices([]);
    }
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    const initial = window.setTimeout(() => void refreshDevices(), 0);
    const unwatch = watchDeviceChanges(() => void refreshDevices());
    return () => {
      window.clearTimeout(initial);
      unwatch();
    };
  }, [supported, refreshDevices]);

  /** Cria um motor novo com a taxa real do contexto e as configurações atuais. */
  const createHost = useCallback((sampleRate: number): EngineHost => {
    const s = settingsRef.current;
    const host = new EngineHost(
      createEngineConfig({
        sampleRate,
        windowSize: s.windowSize,
        sensitivity: s.sensitivity,
        noiseFilter: s.detectorNoiseFilter,
      }),
      {
        onFrame: (frame) => {
          frameRef.current = frame;
          tunerRef.current = smootherRef.current.push(frame.frequency, frame.clarity, performance.now());
        },
        onEvent: (event, latency) => {
          eventsRef.current.push(event);
          if (eventsRef.current.length > MAX_EVENTS) eventsRef.current.shift();
          eventsDirtyRef.current = true;
          if (event.type === 'release') {
            if (event.duration !== undefined) recorderRef.current.release(event.onsetTime, event.duration);
          } else {
            lastNoteRef.current = { event, latency };
            lastNoteDirtyRef.current = true;
            const decoder = decoderRef.current;
            if (decoder) {
              const update = decoder.observe({ midi: event.midi, onsetTime: event.onsetTime });
              inferenceRef.current = update.latest;
              recorderRef.current.addNote(event, update.latest);
              recorderRef.current.applyInferences(decoder.inferences());
              if (update.revisions.length > 0) {
                revisionsRef.current = [...revisionsRef.current, ...update.revisions].slice(-MAX_REVISIONS);
              }
              inferenceDirtyRef.current = true;
            }
          }
        },
      },
    );
    host.observeLongTasks();
    // O relógio do motor recomeça em 0 a cada motor novo: o contexto antigo não vale mais.
    decoderRef.current = new SequenceDecoder(STANDARD_TUNING, fretCountRef.current, regionRef.current);
    recorderRef.current.detach();
    recorderRef.current.restartClock();
    revisionsRef.current = [];
    inferenceRef.current = null;
    inferenceDirtyRef.current = true;
    return host;
  }, []);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    latestRef.current = null;
    frameRef.current = null;
    smootherRef.current.reset();
    tunerRef.current = null;
    peakHoldRef.current = { value: 0, at: 0 };
  }, []);

  const startLoop = useCallback(() => {
    const tick = () => {
      const reading = latestRef.current;
      if (reading) {
        const now = performance.now();
        const peakMeter = dbToMeter(toDb(reading.peak));
        const hold = peakHoldRef.current;
        if (peakMeter >= hold.value || now - hold.at > 1000) {
          peakHoldRef.current = { value: peakMeter, at: now };
        }
        const rmsDb = toDb(reading.rms);
        setMeter({
          level: dbToMeter(rmsDb),
          peak: peakHoldRef.current.value,
          rmsDb,
          clipping: reading.peak >= 0.99,
        });
        setChannelMeters(
          reading.channels.map((c) => ({
            level: dbToMeter(toDb(c.rms)),
            rmsDb: toDb(c.rms),
            peakDb: toDb(c.peak),
            clipping: c.peak >= 0.99,
          })),
        );
      }
      const host = hostRef.current;
      const frame = frameRef.current;
      if (host && frame) {
        setLive({
          note: host.engine.activeNote,
          gateOpen: frame.gateOpen,
          energyDb: frame.energyDb,
          openDb: frame.openDb,
          noiseFloorDb: frame.noiseFloorDb,
          clarity: frame.clarity,
          frequency: frame.frequency,
        });
      }
      setTuner((prev) => (prev === tunerRef.current ? prev : tunerRef.current));
      if (eventsDirtyRef.current) {
        eventsDirtyRef.current = false;
        setEvents([...eventsRef.current]);
      }
      if (lastNoteDirtyRef.current) {
        lastNoteDirtyRef.current = false;
        setLastNote(lastNoteRef.current);
      }
      const tabNow = recorderRef.current.items;
      setTabItems((prev) => (prev === tabNow ? prev : tabNow));
      if (inferenceDirtyRef.current) {
        inferenceDirtyRef.current = false;
        setLastInference(inferenceRef.current);
        setRevisions(revisionsRef.current);
      }
      if (host && performance.now() - lastStatsAtRef.current > 500) {
        lastStatsAtRef.current = performance.now();
        setStats(host.stats());
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const teardown = useCallback(() => {
    stopLoop();
    hostRef.current?.dispose();
    hostRef.current = null;
    setMeter(EMPTY_METER);
    setChannelMeters([]);
    setLive(EMPTY_LIVE);
    setTuner(null);
    setLastInference(null);
    setRevisions([]);
    inferenceRef.current = null;
    setStats(null);
    setInfo(null);
    setGraph(null);
    setContextSuspended(false);
  }, [stopLoop]);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    await session?.stop();
    teardown();
    setStatus('idle');
    setError(null);
  }, [teardown]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    if (!isCaptureSupported()) {
      setError(describeAudioError('unsupported'));
      setStatus('error');
      return;
    }
    setError(null);
    setStatus('requesting');

    const session = new CaptureSession({
      onBlock: (block: AudioBlock, level: LevelReading) => {
        latestRef.current = level;
        hostRef.current?.pushBlock(block);
      },
      onInterrupted: (kind) => {
        if (kind === 'context-suspended') {
          setContextSuspended(true);
          return;
        }
        sessionRef.current = null;
        teardown();
        setError(describeAudioError(kind));
        setStatus('error');
        void refreshDevices();
      },
    });
    sessionRef.current = session;

    try {
      const captureInfo = await session.start({
        deviceId: selectedRef.current,
        settings: {
          browserNoiseReduction: settingsRef.current.browserNoiseReduction,
          channelMode: settingsRef.current.channelMode,
        },
      });
      // A taxa vem do contexto real (ex.: 48000 Hz na M-Track, 96000 Hz no dispositivo falso).
      hostRef.current = createHost(captureInfo.sampleRate);
      eventsRef.current = [];
      lastNoteRef.current = null;
      setEvents([]);
      setLastNote(null);
      setInfo(captureInfo);
      setGraph(session.graph);
      setStatus('active');
      startLoop();
      // Após a permissão, os nomes reais dos dispositivos passam a ser expostos.
      await refreshDevices();
    } catch (e) {
      sessionRef.current = null;
      teardown();
      setError(mapCaptureError(e));
      setStatus('error');
    }
  }, [createHost, refreshDevices, startLoop, teardown]);

  const resume = useCallback(async () => {
    try {
      await sessionRef.current?.resume();
      setContextSuspended(false);
    } catch (e) {
      setError(mapCaptureError(e));
    }
  }, []);

  // Ajustes ao vivo. Sensibilidade e canal valem na hora; janela e filtro recriam o motor.
  useEffect(() => {
    hostRef.current?.engine.setSensitivity(settings.sensitivity);
  }, [settings.sensitivity]);

  useEffect(() => {
    sessionRef.current?.setChannelMode(settings.channelMode);
  }, [settings.channelMode]);

  useEffect(() => {
    const host = hostRef.current;
    const session = sessionRef.current;
    if (!host || !session) return;
    if (
      host.config.windowSize === settings.windowSize &&
      host.config.noiseFilter === settings.detectorNoiseFilter
    ) {
      return;
    }
    host.dispose();
    hostRef.current = createHost(host.config.sampleRate);
    frameRef.current = null;
  }, [settings.windowSize, settings.detectorNoiseFilter, createHost]);

  useEffect(
    () => () => {
      stopLoop();
      hostRef.current?.dispose();
      hostRef.current = null;
      const session = sessionRef.current;
      sessionRef.current = null;
      void session?.stop();
    },
    [stopLoop],
  );

  const selectDevice = useCallback((deviceId: string) => setSelectedDeviceId(deviceId), []);
  const updateSettings = useCallback(
    (patch: Partial<CaptureSettings>) => setSettings((s) => ({ ...s, ...patch })),
    [],
  );
  const setTabPaused = useCallback((paused: boolean) => {
    recorderRef.current.setPaused(paused);
    // Retomar começa um trecho novo: notas anteriores à pausa não servem de contexto.
    if (!paused) decoderRef.current?.breakContext();
    setTabPausedState(paused);
  }, []);
  const correctTab = useCallback((id: number, position: FretPosition | null) => {
    const recorder = recorderRef.current;
    const result = recorder.correct(id, position);
    if (!result) return null;
    let propagated = false;
    const decoder = decoderRef.current;
    if (decoder && result.noteId !== null) {
      const evidence = position
        ? [{ source: 'manual', stringIndex: position.stringIndex, fret: position.fret, support: 1 }]
        : [];
      const update = decoder.applyEvidence(result.noteId, evidence);
      if (update) {
        propagated = true;
        recorder.applyInferences(decoder.inferences());
        inferenceRef.current = decoder.latest();
        if (update.revisions.length > 0) {
          revisionsRef.current = [...revisionsRef.current, ...update.revisions].slice(-MAX_REVISIONS);
        }
        inferenceDirtyRef.current = true;
      }
    }
    setTabItems(recorder.items);
    return { propagated };
  }, []);
  const clearEvents = useCallback(() => {
    recorderRef.current.clear();
    setTabItems(recorderRef.current.items);
    eventsRef.current = [];
    lastNoteRef.current = null;
    decoderRef.current?.reset();
    revisionsRef.current = [];
    setRevisions([]);
    inferenceRef.current = null;
    setEvents([]);
    setLastNote(null);
    setLastInference(null);
  }, []);

  return {
    supported,
    status,
    error,
    devices,
    labelsAvailable,
    selectedDeviceId,
    settings,
    info,
    graph,
    meter,
    channelMeters,
    live,
    tuner,
    events,
    lastInference,
    revisions,
    tabItems,
    tabPaused,
    setTabPaused,
    correctTab,
    lastNote,
    stats,
    contextSuspended,
    selectDevice,
    updateSettings,
    clearEvents,
    start,
    stop,
    resume,
  };
}
