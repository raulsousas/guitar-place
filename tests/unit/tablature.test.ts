import { describe, expect, it } from 'vitest';
import { SequenceDecoder } from '../../src/inference/decoder';
import { exportAscii } from '../../src/tablature/ascii';
import { formatTime, layoutColumns, visibleItems } from '../../src/tablature/layout';
import { quantizeDuration } from '../../src/tablature/quantize';
import { TabRecorder } from '../../src/tablature/recorder';
import { midiToFrequency } from '../../src/music/notes';
import { STANDARD_TUNING } from '../../src/music/tuning';
import type { NoteEvent } from '../../src/types/engine';
import type { TabNote } from '../../src/types/tablature';
import { SAMPLE_RATE, runEngine, synthesize } from '../helpers/signals';

const T = STANDARD_TUNING;

/** Alimenta o decodificador e o gravador como o hook faz, mas com eventos fornecidos pelo teste. */
class Rig {
  decoder = new SequenceDecoder(T, 24);
  rec = new TabRecorder();
  play(midi: number, onsetTime: number, duration?: number, confidence = 0.95): void {
    const update = this.decoder.observe({ midi, onsetTime });
    this.rec.addNote({ midi, frequency: midiToFrequency(midi), pitchConfidence: confidence, onsetTime }, update.latest);
    this.rec.applyInferences(this.decoder.inferences());
    if (duration !== undefined) this.rec.release(onsetTime, duration);
  }
  notes(): TabNote[] {
    return this.rec.items.filter((i): i is TabNote => i.kind === 'note');
  }
}

describe('quantizeDuration', () => {
  it('usa faixas grossas e é monótona', () => {
    expect(quantizeDuration(0.05)).toBe('xs');
    expect(quantizeDuration(0.2)).toBe('s');
    expect(quantizeDuration(0.45)).toBe('m');
    expect(quantizeDuration(0.9)).toBe('l');
    expect(quantizeDuration(3)).toBe('xl');
  });
  it('valores inválidos viram a menor faixa em vez de quebrar', () => {
    expect(quantizeDuration(NaN)).toBe('xs');
    expect(quantizeDuration(-1)).toBe('xs');
  });
});

describe('TabRecorder: registro e ordem', () => {
  it('registra cada ataque uma vez e na ordem temporal', () => {
    const r = new Rig();
    r.play(64, 1.0, 0.4);
    r.play(66, 1.5, 0.4);
    r.play(68, 2.0, 0.4);
    const n = r.notes();
    expect(n.map((x) => x.midi)).toEqual([64, 66, 68]);
    expect(n.map((x) => x.onsetTime)).toEqual([1.0, 1.5, 2.0]);
    expect(new Set(n.map((x) => x.id)).size).toBe(3);
  });

  it('o mesmo evento entregue duas vezes não cria entrada duplicada (sustentação)', () => {
    const r = new Rig();
    r.play(64, 1.0);
    r.rec.addNote(
      { midi: 64, frequency: midiToFrequency(64), pitchConfidence: 0.9, onsetTime: 1.0 },
      r.decoder.inferences()[0]!,
    );
    expect(r.notes()).toHaveLength(1);
  });

  it('ataques repetidos da mesma nota viram entradas separadas', () => {
    const r = new Rig();
    r.play(65, 1.0, 0.3);
    r.play(65, 1.4, 0.3);
    r.play(65, 1.8, 0.3);
    expect(r.notes()).toHaveLength(3);
  });

  it('release define a duração aproximada e a faixa; sem release a nota fica em andamento', () => {
    const r = new Rig();
    r.play(64, 1.0, 1.5);
    r.play(66, 3.0);
    const [a, b] = r.notes();
    expect(a!.duration).toBeCloseTo(1.5);
    expect(a!.bucket).toBe('xl');
    expect(b!.duration).toBeNull();
    expect(b!.bucket).toBeNull();
  });

  it('mudança de altura sem release encerra a nota anterior no instante da nova', () => {
    const r = new Rig();
    r.play(64, 1.0);
    r.play(66, 1.5);
    expect(r.notes()[0]!.duration).toBeCloseTo(0.5);
  });

  it('release de uma nota que já não é a aberta é ignorado', () => {
    const r = new Rig();
    r.play(64, 1.0);
    r.rec.release(9.9, 1);
    expect(r.notes()[0]!.duration).toBeNull();
  });

  it('o histórico é limitado (memória)', () => {
    const rec = new TabRecorder({ maxItems: 10 });
    const decoder = new SequenceDecoder(T, 24);
    for (let i = 0; i < 40; i++) {
      const midi = 60 + (i % 5);
      const t = 1 + i * 0.4;
      const up = decoder.observe({ midi, onsetTime: t });
      rec.addNote({ midi, frequency: midiToFrequency(midi), pitchConfidence: 1, onsetTime: t }, up.latest);
    }
    expect(rec.items.length).toBe(10);
    expect(rec.items.at(-1)!.onsetTime).toBeCloseTo(1 + 39 * 0.4);
  });
});

describe('TabRecorder: pausas', () => {
  it('insere uma pausa quando o silêncio passa do limite, com duração aproximada', () => {
    const r = new Rig();
    r.play(64, 1.0, 0.4);
    r.play(66, 3.0, 0.4);
    const kinds = r.rec.items.map((i) => i.kind);
    expect(kinds).toEqual(['note', 'rest', 'note']);
    const rest = r.rec.items[1]!;
    expect(rest.kind === 'rest' && rest.duration).toBeCloseTo(1.6);
  });

  it('articulação normal entre notas não vira pausa', () => {
    const r = new Rig();
    r.play(64, 1.0, 0.4);
    r.play(66, 1.6, 0.4);
    expect(r.rec.items.map((i) => i.kind)).toEqual(['note', 'note']);
  });

  it('não há pausa antes da primeira nota nem depois da última', () => {
    const r = new Rig();
    r.play(64, 5.0, 0.4);
    expect(r.rec.items.map((i) => i.kind)).toEqual(['note']);
  });
});

describe('TabRecorder: incerteza e posição', () => {
  it('nota sem contexto fica incerta; o gravador nunca a marca como estabelecida', () => {
    const r = new Rig();
    r.play(55, 1.0);
    const [n] = r.notes();
    expect(n!.state).toBe('ambiguous');
    expect(n!.uncertain).toBe(true);
    expect(n!.manual).toBe(false);
    expect(n!.position).not.toBeNull();
  });

  it('E2 é posição única: não é incerta', () => {
    const r = new Rig();
    r.play(40, 1.0);
    expect(r.notes()[0]!.uncertain).toBe(false);
    expect(r.notes()[0]!.state).toBe('unique');
  });

  it('nota fora do alcance do braço fica sem posição e incerta', () => {
    const r = new Rig();
    r.play(30, 1.0);
    const n = r.notes()[0]!;
    expect(n.position).toBeNull();
    expect(n.uncertain).toBe(true);
  });

  it('o estado da nota é atualizado quando notas seguintes dão contexto', () => {
    const r = new Rig();
    r.play(55, 1.0, 0.3);
    const first = r.notes()[0]!;
    expect(first.uncertain).toBe(true);
    [57, 59, 60, 62, 64].forEach((m, i) => r.play(m, 1.4 + i * 0.4, 0.3));
    const after = r.notes()[0]!;
    expect(after.state === 'confident' || after.state === 'ambiguous').toBe(true);
    expect(r.notes()).toHaveLength(6);
  });

  it('o item é imutável: atualizar cria objeto novo e preserva o antigo', () => {
    const r = new Rig();
    r.play(55, 1.0, 0.3);
    const before = r.notes()[0]!;
    const snapshot = JSON.stringify(before);
    r.play(57, 1.4, 0.3);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('TabRecorder: correção manual', () => {
  it('corrigir define a posição, marca como manual e remove a incerteza', () => {
    const r = new Rig();
    r.play(55, 1.0, 0.4);
    const n = r.notes()[0]!;
    const choice = n.candidates.find((c) => c.position.stringNumber === 4)!.position;
    expect(choice.fret).toBe(5);
    const res = r.rec.correct(n.id, choice);
    expect(res).not.toBeNull();
    const after = r.notes()[0]!;
    expect(after.manual).toBe(true);
    expect(after.uncertain).toBe(false);
    expect(after.position).toEqual(choice);
    expect(after.autoPosition).not.toBeNull();
  });

  it('rejeita posição que não produz a nota', () => {
    const r = new Rig();
    r.play(55, 1.0, 0.4);
    const n = r.notes()[0]!;
    const bogus = { ...n.candidates[0]!.position, fret: 3, stringIndex: 0 };
    expect(r.rec.correct(n.id, bogus)).toBeNull();
    expect(r.notes()[0]!.manual).toBe(false);
  });

  it('a correção manual não é sobrescrita por novas inferências', () => {
    const r = new Rig();
    r.play(55, 1.0, 0.4);
    const n = r.notes()[0]!;
    const choice = n.candidates.find((c) => c.position.stringNumber === 6)!.position; // 6ª corda, casa 15
    r.rec.correct(n.id, choice);
    [57, 59, 60].forEach((m, i) => r.play(m, 1.4 + i * 0.4, 0.3));
    const after = r.notes()[0]!;
    expect(after.manual).toBe(true);
    expect(after.position).toEqual(choice);
  });

  it('"voltar à estimativa" remove a correção', () => {
    const r = new Rig();
    r.play(55, 1.0, 0.4);
    const n = r.notes()[0]!;
    r.rec.correct(n.id, n.candidates.at(-1)!.position);
    r.rec.correct(n.id, null);
    const after = r.notes()[0]!;
    expect(after.manual).toBe(false);
    expect(after.position).toEqual(after.autoPosition);
  });

  it('id inexistente devolve null', () => {
    const r = new Rig();
    expect(r.rec.correct(123, null)).toBeNull();
  });
});

describe('TabRecorder: pausar, limpar e reiniciar o relógio', () => {
  it('pausado não registra; retomar não cria pausa musical', () => {
    const r = new Rig();
    r.play(64, 1.0, 0.4);
    r.rec.setPaused(true);
    r.play(66, 2.0, 0.4);
    expect(r.notes()).toHaveLength(1);
    r.rec.setPaused(false);
    r.play(68, 9.0, 0.4);
    expect(r.rec.items.map((i) => i.kind)).toEqual(['note', 'note']);
  });

  it('limpar apaga o conteúdo e o tempo continua; a próxima nota não cria pausa', () => {
    const r = new Rig();
    r.play(64, 1.0, 0.4);
    r.rec.clear();
    expect(r.rec.items).toHaveLength(0);
    r.play(66, 5.0, 0.4);
    expect(r.rec.items.map((i) => i.kind)).toEqual(['note']);
  });

  it('o relógio do motor reinicia em 0: a linha do tempo continua crescendo', () => {
    const r = new Rig();
    r.play(64, 1.0, 0.4);
    r.play(66, 1.5, 0.4);
    const endBefore = r.rec.endTime;
    r.rec.restartClock();
    r.decoder = new SequenceDecoder(T, 24);
    r.play(68, 0.5, 0.4);
    const times = r.notes().map((n) => n.onsetTime);
    expect(times[2]!).toBeGreaterThan(times[1]!);
    expect(times[2]!).toBeGreaterThanOrEqual(endBefore);
    expect(r.rec.items.map((i) => i.kind)).toEqual(['note', 'note', 'note']);
  });

  it('detach remove o vínculo com o decodificador antigo e congela a nota', () => {
    const r = new Rig();
    r.play(55, 1.0, 0.4);
    r.rec.detach();
    const n = r.notes()[0]!;
    expect(n.noteId).toBeNull();
    expect(n.provisional).toBe(false);
  });
});

describe('SequenceDecoder: evidência externa e quebra de contexto', () => {
  it('applyEvidence puxa as notas vizinhas para a mesma região e devolve revisões', () => {
    const d = new SequenceDecoder(T, 24);
    const ids: number[] = [];
    // Frase na região da casa 5: G3 (3/0 ou 4/5 ou ...), A3, B3...
    [55, 57, 59].forEach((m, i) => ids.push(d.observe({ midi: m, onsetTime: 1 + i * 0.4 }).latest.noteId));
    const g3 = d.inferences()[0]!.candidates.find((c) => c.position.stringNumber === 4 && c.position.fret === 5)!;
    const update = d.applyEvidence(ids[0]!, [
      { source: 'manual', stringIndex: g3.position.stringIndex, fret: g3.position.fret, support: 1 },
    ]);
    expect(update).not.toBeNull();
    const first = d.inferences()[0]!;
    expect(first.primary!.position.stringNumber).toBe(4);
    expect(first.primary!.position.fret).toBe(5);
    expect(first.state).toBe('confident');
  });

  it('applyEvidence devolve null para nota já consolidada ou desconhecida', () => {
    const d = new SequenceDecoder(T, 24);
    expect(d.applyEvidence(99, [])).toBeNull();
    const id = d.observe({ midi: 55, onsetTime: 1 }).latest.noteId;
    d.breakContext();
    expect(d.applyEvidence(id, [])).toBeNull();
  });

  it('breakContext: a nota seguinte não usa as anteriores como contexto', () => {
    const d = new SequenceDecoder(T, 24);
    d.observe({ midi: 64, onsetTime: 1 });
    d.observe({ midi: 66, onsetTime: 1.4 });
    d.breakContext();
    const next = d.observe({ midi: 55, onsetTime: 1.8 }).latest;
    expect(next.hasContext).toBe(false);
    expect(next.state).toBe('ambiguous');
  });
});

describe('layout e exportação', () => {
  it('visibleItems devolve as últimas N notas (e as pausas entre elas)', () => {
    const r = new Rig();
    [64, 65, 66, 67].forEach((m, i) => r.play(m, 1 + i * 0.5, 0.3));
    const last2 = visibleItems(r.rec.items, 2).filter((i) => i.kind === 'note');
    expect(last2).toHaveLength(2);
    expect((last2[1] as TabNote).midi).toBe(67);
    expect(visibleItems(r.rec.items, Infinity)).toBe(r.rec.items);
  });

  it('layoutColumns mantém a ordem e a largura cresce com as notas', () => {
    const r = new Rig();
    [64, 65, 66].forEach((m, i) => r.play(m, 1 + i * 0.5, 0.3));
    const { columns, width } = layoutColumns(r.rec.items);
    expect(columns.map((c) => c.x)).toEqual([...columns.map((c) => c.x)].sort((a, b) => a - b));
    expect(width).toBeGreaterThan(columns.at(-1)!.x);
    expect(formatTime(75)).toBe('01:15');
  });

  it('ASCII: posição única sem "?", incerta com "?", pausa como colunas vazias', () => {
    const r = new Rig();
    r.play(40, 1.0, 0.3); // E2: posição única (6ª corda, solta)
    r.play(55, 1.5, 0.3); // G3 sem contexto: incerta
    r.play(57, 4.0, 0.3); // depois de uma pausa
    const text = exportAscii(r.rec.items, T, { columnsPerSystem: 16 });
    const lines = text.split('\n');
    const e = lines.find((l) => l.startsWith('E|'))!;
    expect(e).toContain('-0--');
    expect(text).toContain('?');
    expect(text).toMatch(/palpite do algoritmo/);
    expect(lines.filter((l) => /^[eBGDAE]\|/.test(l))).toHaveLength(6);
    // Todas as linhas da tablatura têm o mesmo comprimento.
    const widths = new Set(lines.filter((l) => /^[eBGDAE]\|/.test(l)).map((l) => l.length));
    expect(widths.size).toBe(1);
  });

  it('ASCII: tablatura vazia e quebra em sistemas', () => {
    expect(exportAscii([], T)).toContain('(sem notas)');
    const r = new Rig();
    for (let i = 0; i < 10; i++) r.play(64 + (i % 3), 1 + i * 0.5, 0.3);
    const text = exportAscii(r.rec.items, T, { columnsPerSystem: 4 });
    expect(text.split('\n').filter((l) => l.startsWith('e|'))).toHaveLength(3);
  });
});

describe('Áudio sintético -> detector real -> gravador (não é guitarra real)', () => {
  it('uma sequência com sustentação e um reataque gera exatamente uma entrada por ataque', () => {
    const notes = [64, 64, 67, 71].map((m, i) => ({
      frequency: midiToFrequency(m),
      start: 0.2 + i * 0.8,
      duration: 0.6,
      decay: 0.5,
    }));
    const signal = synthesize(notes, 0.2 + 4 * 0.8 + 0.5, SAMPLE_RATE);
    const { events } = runEngine(signal, { windowSize: 4096 });
    const decoder = new SequenceDecoder(T, 24);
    const rec = new TabRecorder();
    for (const e of events as NoteEvent[]) {
      if (e.type === 'release') {
        rec.release(e.onsetTime, e.duration ?? 0);
      } else {
        const up = decoder.observe({ midi: e.midi, onsetTime: e.onsetTime });
        rec.addNote(e, up.latest);
        rec.applyInferences(decoder.inferences());
      }
    }
    const notesOut = rec.items.filter((i): i is TabNote => i.kind === 'note');
    expect(notesOut.map((n) => n.midi)).toEqual([64, 64, 67, 71]);
    expect(notesOut.every((n) => n.duration !== null)).toBe(true);
    expect(notesOut.every((n) => n.onsetTime >= 0)).toBe(true);
    const sorted = [...notesOut].sort((a, b) => a.onsetTime - b.onsetTime);
    expect(notesOut).toEqual(sorted);
  });
});
