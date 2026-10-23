import workletUrl from './loopback.worklet.ts?worker&url';
import { LOOPBACK, analyzeHits, clickBuffer, clickOffsets, thresholdFromAmbient, type LoopbackHit, type LoopbackOutcome } from './loopback';

const loaded = new WeakSet<BaseAudioContext>();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

type WorkletMessage = { type: 'peak'; peak: number } | { type: 'hit'; time: number; peak: number };

/**
 * Executa a medida de loopback no AudioContext da captura: ouve o ruído de fundo, arma o limiar, toca `LOOPBACK.clicks` cliques
 * direto no destino de áudio (SEM passar pelos efeitos nem pelo volume geral) e analisa quando eles voltam pela entrada.
 *
 * Segurança: quem chama deve garantir que a saída do Estúdio esteja DESLIGADA. Com ela ligada, o sinal que volta pela entrada
 * seria enviado de novo à saída, fechando um laço de realimentação.
 */
export async function runLoopback(ctx: AudioContext, source: AudioNode): Promise<LoopbackOutcome> {
  if (ctx.state !== 'running') return { ok: false, reason: 'unavailable' };
  if (!loaded.has(ctx)) {
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      loaded.add(ctx);
    } catch {
      return { ok: false, reason: 'worklet-failed' };
    }
  }

  const L = LOOPBACK;
  const node = new AudioWorkletNode(ctx, 'loopback-processor', { numberOfInputs: 1, numberOfOutputs: 0 });
  const hits: LoopbackHit[] = [];
  let ambient = 0;
  let listeningAmbient = true;
  node.port.onmessage = (ev: MessageEvent<WorkletMessage>) => {
    const m = ev.data;
    if (m.type === 'peak') {
      if (listeningAmbient) ambient = Math.max(ambient, m.peak);
    } else {
      hits.push({ time: m.time, peak: m.peak });
    }
  };
  source.connect(node);

  try {
    await sleep(L.ambientS * 1000);
    listeningAmbient = false;
    node.port.postMessage({ type: 'arm', threshold: thresholdFromAmbient(ambient), holdoffS: L.holdoffS });

    const click = clickBuffer(ctx.sampleRate);
    const buf = ctx.createBuffer(1, click.length, ctx.sampleRate);
    buf.copyToChannel(click, 0);
    const t0 = ctx.currentTime + 0.3;
    const clickTimes: number[] = [];
    const offsets = clickOffsets();
    for (const off of offsets) {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(ctx.destination);
      const t = t0 + off;
      s.start(t);
      clickTimes.push(t);
    }
    await sleep((t0 - ctx.currentTime + offsets[offsets.length - 1]! + L.windowS + 0.2) * 1000);
    node.port.postMessage({ type: 'disarm' });
    return analyzeHits(clickTimes, hits);
  } finally {
    try {
      source.disconnect(node);
    } catch {
      /* já desconectado */
    }
    node.port.onmessage = null;
    node.port.close();
    node.disconnect();
  }
}
