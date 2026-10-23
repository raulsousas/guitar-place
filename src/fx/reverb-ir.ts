/**
 * Resposta de impulso SINTÉTICA do reverb: ruído gaussiano com decaimento exponencial e filtro passa-baixa
 * simples que escurece a cauda. Gerada aqui, com semente fixa (resultado reproduzível): não há arquivo de
 * terceiros nem nenhuma sala real. `decayS` é o tempo para a cauda cair 60 dB (RT60 aproximado).
 */
export function generateReverbIr(sampleRate: number, decayS: number, channels = 2, seed = 12345): Float32Array<ArrayBuffer>[] {
  const length = Math.max(1, Math.round(sampleRate * Math.max(0.1, decayS)));
  const out: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < channels; c++) {
    let s = (seed + c * 7919) >>> 0;
    const rand = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const data = new Float32Array(length);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const u1 = Math.max(rand(), 1e-12);
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand());
      const env = 10 ** ((-60 * (i / sampleRate)) / Math.max(0.1, decayS) / 20);
      // Caudas mais escuras com o tempo: o coeficiente do filtro cai ao longo da cauda.
      const a = 0.6 - 0.45 * (i / length);
      lp += a * (g - lp);
      data[i] = lp * env;
    }
    out.push(data);
  }
  // Normaliza a energia para o ganho do reverb não depender do tempo de decaimento.
  let energy = 0;
  for (const d of out) for (const v of d) energy += v * v;
  const scale = 1 / Math.sqrt(Math.max(1e-12, energy / channels)) * 0.35;
  for (const d of out) for (let i = 0; i < d.length; i++) d[i]! *= scale;
  return out;
}