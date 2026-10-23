import {
  AMP_DC_HZ,
  AMP_FILTERS,
  AMP_VOICINGS,
  DRIVE_PRE_LP_HZ,
  GATE_ENV_HZ,
  GATE_LOOKAHEAD_S,
  absCurve,
  gateCurve,
  gateScale,
  MAX_FEEDBACK,
  ampLevelGain,
  ampPreGain,
  clamp,
  softLimitCurve,
  dbToGain,
  driveLevelGain,
  driveToGain,
  driveToneHz,
  saturationCurve,
  toneToDb,
} from './curves';
import { generateReverbIr } from './reverb-ir';
import type { AmpVoicing, CabinetKind, StudioLevels, StudioParams } from './types';

/**
 * Motor do Estúdio: grafo Web Audio que processa a guitarra e a envia para a saída escolhida.
 *
 * Cadeia (mono até o reverb):
 *   fonte -> [canal] -> trim -> portão de ruído -> pedal (drive) -> EQ -> amplificador -> gabinete -> delay -> reverb
 *         -> volume -> limitador suave (máx. 0,98) -> porta de saída -> destino
 *
 * Regras de segurança (ver docs/studio.md):
 * - A saída começa DESLIGADA: a porta tem ganho 0 e a fonte nem está ligada ao grafo até `setOutputEnabled(true)`.
 * - Ligar/desligar um bloco é um crossfade de ganho igual (constante de tempo 10 ms), sem clique audível esperado.
 * - Todos os parâmetros são suavizados com `setTargetAtTime`.
 * - Este módulo NÃO importa nada de `src/dsp` (o detector) e o detector não importa nada daqui.
 */

/** Constante de tempo (s) de toda suavização de parâmetro. ~10 ms: sem degraus audíveis, resposta imediata. */
const SMOOTH_S = 0.01;
/** Tempo (s) para a porta de saída abrir/fechar. */
const GATE_S = 0.02;

type Stage = {
  input: GainNode;
  output: GainNode;
  dry: GainNode;
  wet: GainNode;
};

type SinkContext = {
  setSinkId?: (id: string) => Promise<void>;
  sinkId?: string | { type: string };
};

export class StudioEngine {
  private readonly ctx: BaseAudioContext;
  private readonly source: AudioNode;
  private sourceConnected = false;
  private outputEnabled = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cabinet: CabinetKind | null = null;
  private reverbDecay = -1;

  // entrada
  private readonly splitter: ChannelSplitterNode;
  private readonly g1: GainNode;
  private readonly g2: GainNode;
  private readonly mono: GainNode;
  private readonly trim: GainNode;
  private readonly inAnalyser: AnalyserNode;
  // blocos
  private readonly noiseGate: Stage;
  private readonly gateEnvScale: GainNode;
  private readonly gateCtl: AnalyserNode;
  private readonly gateCtlBuf: Float32Array<ArrayBuffer>;
  private readonly driveLp: BiquadFilterNode;
  private readonly driveDc: BiquadFilterNode;
  private readonly ampPreLp: BiquadFilterNode;
  private readonly ampDc: BiquadFilterNode;
  private readonly ampLp2: BiquadFilterNode;
  private readonly drive: Stage;
  private readonly drivePre: GainNode;
  private readonly driveHp: BiquadFilterNode;
  private readonly driveShaper: WaveShaperNode;
  private readonly driveTone: BiquadFilterNode;
  private readonly driveLevel: GainNode;
  private readonly eq: Stage;
  private readonly eqLow: BiquadFilterNode;
  private readonly eqMid: BiquadFilterNode;
  private readonly eqHigh: BiquadFilterNode;
  private readonly amp: Stage;
  private readonly ampHp: BiquadFilterNode;
  private readonly ampPre: GainNode;
  /** Um shaper por voz: a curva de um WaveShaper não pode ser trocada depois de definida, então a voz muda por crossfade. */
  private readonly ampVoices: Record<AmpVoicing, { shaper: WaveShaperNode; gain: GainNode }>;
  private readonly ampLow: BiquadFilterNode;
  private readonly ampMid: BiquadFilterNode;
  private readonly ampHigh: BiquadFilterNode;
  private readonly ampLp: BiquadFilterNode;
  private readonly ampLevel: GainNode;
  private readonly cab: Stage;
  private readonly cabHp: BiquadFilterNode;
  private readonly cabBody: BiquadFilterNode;
  private readonly cabPresence: BiquadFilterNode;
  private readonly cabLp1: BiquadFilterNode;
  private readonly cabLp2: BiquadFilterNode;
  private readonly delayStage: GainNode;
  private readonly delayNode: DelayNode;
  private readonly delayFeedback: GainNode;
  private readonly delayWet: GainNode;
  private readonly delayOut: GainNode;
  private readonly reverbIn: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly reverbWet: GainNode;
  private readonly reverbOut: GainNode;
  // saída
  private readonly master: GainNode;
  private readonly limiter: WaveShaperNode;
  private readonly outAnalyser: AnalyserNode;
  private readonly gate: GainNode;
  private readonly inBuf: Float32Array<ArrayBuffer>;
  private readonly outBuf: Float32Array<ArrayBuffer>;
  private sourceChannels: number;

  constructor(ctx: BaseAudioContext, source: AudioNode) {
    this.ctx = ctx;
    this.source = source;
    this.sourceChannels = source.channelCount;

    this.splitter = ctx.createChannelSplitter(2);
    this.g1 = ctx.createGain();
    this.g2 = ctx.createGain();
    this.mono = ctx.createGain();
    this.mono.channelCount = 1;
    this.mono.channelCountMode = 'explicit';
    this.splitter.connect(this.g1, 0);
    this.splitter.connect(this.g2, 1);
    this.g1.connect(this.mono);
    this.g2.connect(this.mono);

    this.trim = ctx.createGain();
    this.inAnalyser = ctx.createAnalyser();
    this.inAnalyser.fftSize = 1024;
    this.mono.connect(this.trim);
    this.trim.connect(this.inAnalyser);

    // Portão de ruído (ver GATE_* em curves.ts). O ramo lateral mede a envoltória do sinal (valor absoluto -> passa-baixas)
    // e comanda o ganho do caminho do áudio. O áudio passa por um atraso curto (antecipação) para o portão abrir ANTES do ataque.
    const gateAbs = ctx.createWaveShaper();
    gateAbs.curve = absCurve();
    const gateEnv = this.biquad('lowpass', GATE_ENV_HZ, 0.707);
    this.gateEnvScale = ctx.createGain();
    this.gateEnvScale.gain.value = gateScale(-58);
    const gateShaper = ctx.createWaveShaper();
    gateShaper.curve = gateCurve();
    const gateVca = ctx.createGain();
    gateVca.gain.value = 0; // o ganho vem só do ramo lateral
    const gateDelay = ctx.createDelay(0.05);
    gateDelay.delayTime.value = GATE_LOOKAHEAD_S;
    this.trim.connect(gateAbs);
    gateAbs.connect(gateEnv);
    gateEnv.connect(this.gateEnvScale);
    this.gateEnvScale.connect(gateShaper);
    gateShaper.connect(gateVca.gain);
    this.gateCtl = ctx.createAnalyser();
    this.gateCtl.fftSize = 32;
    this.gateCtlBuf = new Float32Array(this.gateCtl.fftSize);
    gateShaper.connect(this.gateCtl);
    this.noiseGate = this.stage(this.trim, [gateDelay, gateVca]);

    // Pedal de drive: passa-altas -> ganho -> saturação (4x de sobreamostragem contra aliasing) -> tom -> volume.
    this.driveHp = this.biquad('highpass', 120, 0.707);
    this.drivePre = ctx.createGain();
    this.driveShaper = this.shaper(saturationCurve(2.2, 0.05));
    this.driveLp = this.biquad('lowpass', DRIVE_PRE_LP_HZ, 0.707); // tira o chiado agudo ANTES de a saturação multiplicá-lo
    this.driveDc = this.biquad('highpass', AMP_DC_HZ, 0.707); // remove o nível DC criado pela curva assimétrica
    this.driveTone = this.biquad('lowpass', 4000, 0.707);
    this.driveLevel = ctx.createGain();
    this.drive = this.stage(this.noiseGate.output, [this.driveHp, this.driveLp, this.drivePre, this.driveShaper, this.driveDc, this.driveTone, this.driveLevel]);

    // EQ de três bandas. Desligado = ganhos em 0 dB (transparente) por crossfade.
    this.eqLow = this.biquad('lowshelf', 100, 0.707);
    this.eqMid = this.biquad('peaking', 800, 0.9);
    this.eqHigh = this.biquad('highshelf', 3000, 0.707);
    this.eq = this.stage(this.drive.output, [this.eqLow, this.eqMid, this.eqHigh]);

    // Amplificador: passa-altas -> ganho de entrada -> saturação -> três tons -> passa-baixas -> volume.
    this.ampHp = this.biquad('highpass', 80, 0.707);
    this.ampPre = ctx.createGain();
    const voiceIn = ctx.createGain();
    const voiceOut = ctx.createGain();
    const voices = {} as Record<AmpVoicing, { shaper: WaveShaperNode; gain: GainNode }>;
    for (const id of Object.keys(AMP_VOICINGS) as AmpVoicing[]) {
      const v = AMP_VOICINGS[id];
      const shaper = this.shaper(saturationCurve(v.hardness, v.asymmetry));
      const gain = ctx.createGain();
      gain.gain.value = id === 'clean' ? 1 : 0;
      voiceIn.connect(shaper);
      shaper.connect(gain);
      gain.connect(voiceOut);
      voices[id] = { shaper, gain };
    }
    this.ampVoices = voices;
    this.ampLow = this.biquad('lowshelf', 120, 0.707);
    this.ampMid = this.biquad('peaking', 700, 0.8);
    this.ampHigh = this.biquad('highshelf', 3200, 0.707);
    this.ampLp = this.biquad('lowpass', 7500, 0.707);
    this.ampLp2 = this.biquad('lowpass', 7500, 0.707); // em série com o anterior: 24 dB/oitava contra a 'lixa' dos harmônicos agudos
    this.ampPreLp = this.biquad('lowpass', 7000, 0.707); // antes da saturação: não deixa o chiado agudo virar fritura
    this.ampDc = this.biquad('highpass', AMP_DC_HZ, 0.707);
    this.ampLevel = ctx.createGain();
    this.amp = this.stage(this.eq.output, [
      this.ampHp, this.ampPreLp, this.ampPre, { in: voiceIn, out: voiceOut }, this.ampDc, this.ampLow, this.ampMid, this.ampHigh, this.ampLp, this.ampLp2, this.ampLevel,
    ]);

    // Gabinete: passa-altas, corpo, presença e dois passa-baixas em série (declive ~24 dB/oitava).
    this.cabHp = this.biquad('highpass', 90, 0.707);
    this.cabBody = this.biquad('peaking', 120, 0.9);
    this.cabPresence = this.biquad('peaking', 2500, 1);
    this.cabLp1 = this.biquad('lowpass', 5200, 0.707);
    this.cabLp2 = this.biquad('lowpass', 5200, 0.707);
    this.cab = this.stage(this.amp.output, [this.cabHp, this.cabBody, this.cabPresence, this.cabLp1, this.cabLp2]);

    // Delay: o eco é somado ao sinal direto; a realimentação é limitada (MAX_FEEDBACK) para decair sempre.
    this.delayStage = ctx.createGain();
    this.delayNode = ctx.createDelay(1.2);
    this.delayFeedback = ctx.createGain();
    this.delayWet = ctx.createGain();
    this.delayOut = ctx.createGain();
    this.cab.output.connect(this.delayStage);
    this.delayStage.connect(this.delayOut);
    this.delayStage.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayWet.connect(this.delayOut);

    // Reverb por convolução com resposta de impulso sintética (src/fx/reverb-ir.ts).
    this.reverbIn = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.reverbWet = ctx.createGain();
    this.reverbOut = ctx.createGain();
    this.delayOut.connect(this.reverbIn);
    this.reverbIn.connect(this.reverbOut);
    this.reverbIn.connect(this.convolver);
    this.convolver.connect(this.reverbWet);
    this.reverbWet.connect(this.reverbOut);

    // Saída: volume -> limitador suave -> corte duro -> medidor -> porta (fechada) -> destino.
    this.master = ctx.createGain();
    // Sem sobreamostragem de propósito: ela faz o sinal ultrapassar o limite ao voltar à taxa original.
    this.limiter = ctx.createWaveShaper();
    this.limiter.curve = softLimitCurve();
    this.outAnalyser = ctx.createAnalyser();
    this.outAnalyser.fftSize = 1024;
    this.gate = ctx.createGain();
    this.gate.gain.value = 0;
    this.reverbOut.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.outAnalyser);
    this.outAnalyser.connect(this.gate);
    this.gate.connect(ctx.destination);

    this.inBuf = new Float32Array(this.inAnalyser.fftSize);
    this.outBuf = new Float32Array(this.outAnalyser.fftSize);
  }

  // --- construção ---

  private biquad(type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private shaper(curve: Float32Array<ArrayBuffer>): WaveShaperNode {
    const s = this.ctx.createWaveShaper();
    s.curve = curve;
    s.oversample = '4x';
    return s;
  }

  /** Bloco com crossfade: entrada -> (seco | cadeia -> molhado) -> saída. */
  private stage(from: AudioNode, chain: (AudioNode | { in: AudioNode; out: AudioNode })[]): Stage {
    const input = this.ctx.createGain();
    const output = this.ctx.createGain();
    const dry = this.ctx.createGain();
    const wet = this.ctx.createGain();
    from.connect(input);
    input.connect(dry);
    dry.connect(output);
    let prev: AudioNode = input;
    for (const n of chain) {
      if ('in' in n) {
        prev.connect(n.in);
        prev = n.out;
      } else {
        prev.connect(n);
        prev = n;
      }
    }
    prev.connect(wet);
    wet.connect(output);
    dry.gain.value = 1;
    wet.gain.value = 0;
    return { input, output, dry, wet };
  }

  private smooth(p: AudioParam, value: number): void {
    p.setTargetAtTime(value, this.ctx.currentTime, SMOOTH_S);
  }

  private crossfade(stage: Stage, enabled: boolean): void {
    this.smooth(stage.dry.gain, enabled ? 0 : 1);
    this.smooth(stage.wet.gain, enabled ? 1 : 0);
  }

  // --- API ---

  /** Aplica todos os parâmetros (valores fora da faixa são limitados). */
  setParams(p: StudioParams): void {
    // Canal ouvido.
    const mode = this.sourceChannels < 2 ? 'ch1' : p.inputChannel;
    this.smooth(this.g1.gain, mode === 'ch2' ? 0 : mode === 'sum' ? 0.5 : 1);
    this.smooth(this.g2.gain, mode === 'ch1' ? 0 : mode === 'sum' ? 0.5 : 0);
    this.smooth(this.trim.gain, dbToGain(clamp(p.inputTrimDb, -20, 20)));

    const g = p.gate;
    this.smooth(this.gateEnvScale.gain, gateScale(g.thresholdDb));
    this.crossfade(this.noiseGate, g.enabled);

    const d = p.drive;
    this.smooth(this.drivePre.gain, driveToGain(d.drive));
    this.smooth(this.driveTone.frequency, driveToneHz(d.tone));
    this.smooth(this.driveLevel.gain, driveLevelGain(d.level));
    this.crossfade(this.drive, d.enabled);

    const e = p.eq;
    this.smooth(this.eqLow.gain, clamp(e.lowDb, -12, 12));
    this.smooth(this.eqMid.gain, clamp(e.midDb, -12, 12));
    this.smooth(this.eqHigh.gain, clamp(e.highDb, -12, 12));
    this.crossfade(this.eq, e.enabled);

    const a = p.amp;
    for (const id of Object.keys(this.ampVoices) as AmpVoicing[]) {
      this.smooth(this.ampVoices[id].gain.gain, id === a.voicing ? 1 : 0);
    }
    const f = AMP_FILTERS[a.voicing];
    this.smooth(this.ampHp.frequency, f.hpHz);
    this.smooth(this.ampPreLp.frequency, f.preLpHz);
    this.smooth(this.ampLp.frequency, f.postLpHz);
    this.smooth(this.ampLp2.frequency, f.postLpHz);
    this.smooth(this.ampPre.gain, ampPreGain(a.voicing, a.gain));
    this.smooth(this.ampLow.gain, toneToDb(a.bass));
    this.smooth(this.ampMid.gain, toneToDb(a.mid));
    this.smooth(this.ampHigh.gain, toneToDb(a.treble));
    this.smooth(this.ampLevel.gain, ampLevelGain(a.level));
    this.crossfade(this.amp, a.enabled);

    const c = p.cabinet;
    if (c.kind !== this.cabinet) {
      const big = c.kind === '4x12';
      this.cabBody.frequency.value = big ? 105 : 140;
      this.cabBody.gain.value = big ? 4 : 2.5;
      this.cabPresence.gain.value = big ? 2.5 : 3.5;
      this.cabLp1.frequency.value = big ? 4600 : 5400;
      this.cabLp2.frequency.value = big ? 4600 : 5400;
      this.cabinet = c.kind;
    }
    this.crossfade(this.cab, c.enabled);

    const dl = p.delay;
    this.smooth(this.delayNode.delayTime, clamp(dl.timeMs, 40, 1000) / 1000);
    this.smooth(this.delayFeedback.gain, dl.enabled ? clamp(dl.feedback, 0, MAX_FEEDBACK) : 0);
    this.smooth(this.delayWet.gain, dl.enabled ? clamp(dl.mix, 0, 1) : 0);

    const rv = p.reverb;
    const decay = clamp(rv.decayS, 0.3, 4);
    if (decay !== this.reverbDecay) {
      const data = generateReverbIr(this.ctx.sampleRate, decay);
      const buf = this.ctx.createBuffer(data.length, data[0]!.length, this.ctx.sampleRate);
      data.forEach((ch, i) => buf.copyToChannel(ch, i));
      this.convolver.buffer = buf;
      this.reverbDecay = decay;
    }
    this.smooth(this.reverbWet.gain, rv.enabled ? clamp(rv.mix, 0, 1) : 0);

    this.smooth(this.master.gain, dbToGain(clamp(p.masterDb, -40, 0)));
  }

  /**
   * Liga ou desliga a saída. Desligada: a porta fecha e a fonte é desconectada do grafo (nenhum áudio
   * passa pelo Estúdio). A captura e o detector continuam funcionando.
   */
  setOutputEnabled(enabled: boolean): void {
    if (enabled === this.outputEnabled) return;
    this.outputEnabled = enabled;
    if (this.disconnectTimer !== null) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (enabled) {
      this.connectSource();
      this.gate.gain.setTargetAtTime(1, this.ctx.currentTime, GATE_S / 3);
    } else {
      this.gate.gain.setTargetAtTime(0, this.ctx.currentTime, GATE_S / 3);
      this.disconnectTimer = setTimeout(() => {
        this.disconnectTimer = null;
        if (!this.outputEnabled) this.disconnectSource();
      }, 120);
    }
  }

  get isOutputEnabled(): boolean {
    return this.outputEnabled;
  }

  private connectSource(): void {
    if (this.sourceConnected) return;
    this.sourceChannels = this.source.channelCount;
    this.source.connect(this.splitter);
    this.sourceConnected = true;
  }

  private disconnectSource(): void {
    if (!this.sourceConnected) return;
    try {
      this.source.disconnect(this.splitter);
    } catch {
      /* já desconectada */
    }
    this.sourceConnected = false;
  }

  /** Escolhe a saída de áudio. Devolve false quando o navegador não suporta a troca. */
  async setOutputDevice(deviceId: string): Promise<boolean> {
    const c = this.ctx as unknown as SinkContext;
    if (typeof c.setSinkId !== 'function') return false;
    await c.setSinkId(deviceId);
    return true;
  }

  static supportsOutputSelection(ctx: BaseAudioContext): boolean {
    return typeof (ctx as unknown as SinkContext).setSinkId === 'function';
  }

  /** Níveis medidos nas amostras do último bloco analisado (sem cópia contínua: chamar a cada quadro de tela). */
  levels(): StudioLevels {
    this.inAnalyser.getFloatTimeDomainData(this.inBuf);
    this.outAnalyser.getFloatTimeDomainData(this.outBuf);
    let ip = 0;
    let isq = 0;
    for (const v of this.inBuf) {
      ip = Math.max(ip, Math.abs(v));
      isq += v * v;
    }
    this.gateCtl.getFloatTimeDomainData(this.gateCtlBuf);
    let gsum = 0;
    for (const v of this.gateCtlBuf) gsum += v;
    let op = 0;
    let sq = 0;
    for (const v of this.outBuf) {
      op = Math.max(op, Math.abs(v));
      sq += v * v;
    }
    const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    return {
      inputPeakDb: db(ip),
      inputRmsDb: db(Math.sqrt(isq / this.inBuf.length)),
      gateOpen: gsum / this.gateCtlBuf.length,
      outputPeakDb: db(op),
      outputRmsDb: db(Math.sqrt(sq / this.outBuf.length)),
      inputClip: ip >= 0.99,
      outputClip: op >= 0.97,
    };
  }

  /** Tom curto (440 Hz, cerca de -26 dBFS) direto na saída, para conferir o fone/caixa sem tocar a guitarra. */
  playTestTone(): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.frequency.value = 440;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.03);
    g.gain.setValueAtTime(0.05, t + 0.4);
    g.gain.linearRampToValueAtTime(0, t + 0.5);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
    osc.start(t);
    osc.stop(t + 0.55);
  }

  dispose(): void {
    if (this.disconnectTimer !== null) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
    this.outputEnabled = false;
    this.disconnectSource();
    this.gate.disconnect();
  }
}