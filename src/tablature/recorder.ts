import type { FretPosition } from '../music/fretmap';
import type { NoteEvent } from '../types/engine';
import type { PositionInference } from '../types/position';
import type { TabItem, TabNote } from '../types/tablature';
import { quantizeDuration } from './quantize';

/**
 * Gravador da tablatura (Fase 5b). Consome SOMENTE eventos de nota e inferências de posição
 * (nunca amostras de áudio nem detalhes do DSP) e mantém uma lista imutável de itens para a interface.
 *
 * Regras:
 * - Uma nota é registrada UMA vez, no ataque (`onset`) ou na mudança de altura (`change`). Enquanto ela
 *   sustenta não há novos eventos, então a sustentação nunca vira entradas repetidas. Cada reataque da
 *   mesma altura gera um evento próprio (`release` 'reattack' + novo `onset`) e, portanto, outra entrada.
 * - Pausas: se o intervalo entre o fim de uma nota e o ataque seguinte for >= `restMinS`, insere-se um
 *   item de pausa. Não se inventa pausa depois da última nota (o silêncio atual ainda não terminou) nem
 *   entre trechos separados por pausa de gravação ou reinício do motor.
 * - Posição incerta (estado 'ambiguous' ou sem posição no braço) fica marcada em `uncertain`; só uma
 *   correção manual do usuário a estabelece (`manual`).
 * - A memória é limitada a `maxItems` itens (os mais antigos são descartados).
 */

export interface RecorderOptions {
  /**
   * Máximo de itens guardados. Padrão 400: cerca de 7 minutos a uma nota por segundo. Valores maiores
   * aumentam a memória e o custo de renderização do histórico; menores perdem o início da sessão.
   */
  maxItems: number;
  /**
   * Intervalo mínimo (s) entre o fim de uma nota e o ataque seguinte para registrar uma pausa.
   * Padrão 0,6 s: abaixo disso é a articulação normal entre notas (o detector libera a nota ~100-200 ms
   * após o fim do som), não uma pausa musical. Menor => pausas espúrias; maior => pausas curtas somem.
   */
  restMinS: number;
}

export const DEFAULT_RECORDER_OPTIONS: RecorderOptions = { maxItems: 400, restMinS: 0.6 };

export type NoteStart = Pick<NoteEvent, 'midi' | 'frequency' | 'pitchConfidence' | 'onsetTime'>;

const samePos = (a: FretPosition | null, b: FretPosition | null): boolean =>
  a === b || (a !== null && b !== null && a.stringIndex === b.stringIndex && a.fret === b.fret);

export class TabRecorder {
  private list: TabItem[] = [];
  private readonly opts: RecorderOptions;
  private nextId = 0;
  /** timeline = tempo do motor + offset (o motor reinicia em 0 a cada captura/motor novo). */
  private offset = 0;
  private timelineEnd = 0;
  private noRestNext = true;
  private isPaused = false;
  /** Nota ainda soando (id na tablatura e ataque no relógio do motor). */
  private open: { id: number; engineOnset: number } | null = null;
  private lastEngineOnset: { midi: number; onset: number } | null = null;

  constructor(options: Partial<RecorderOptions> = {}) {
    this.opts = { ...DEFAULT_RECORDER_OPTIONS, ...options };
  }

  /** Itens atuais. A referência só muda quando o conteúdo muda. */
  get items(): readonly TabItem[] {
    return this.list;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  /** Tempo (s) do fim do último item gravado, na linha do tempo da tablatura. */
  get endTime(): number {
    return this.timelineEnd;
  }

  /** O relógio do motor recomeçou em 0 (captura nova ou motor recriado): continua a linha do tempo. */
  restartClock(): void {
    this.offset = this.timelineEnd;
    this.noRestNext = true;
    this.open = null;
    this.lastEngineOnset = null;
  }

  setPaused(paused: boolean): void {
    if (paused === this.isPaused) return;
    this.isPaused = paused;
    // Retomar começa um trecho novo: o tempo parado não vira pausa musical.
    this.noRestNext = true;
  }

  /** Registra uma nota iniciada, com a inferência de posição do decodificador. Ignora se pausado. */
  addNote(start: NoteStart, inference: PositionInference): void {
    if (this.isPaused) return;
    // Evento duplicado do mesmo ataque (mesma altura e mesmo instante): nunca gera outra entrada.
    const last = this.lastEngineOnset;
    if (last && last.midi === start.midi && Math.abs(last.onset - start.onsetTime) < 1e-6) return;
    this.lastEngineOnset = { midi: start.midi, onset: start.onsetTime };

    const t = start.onsetTime + this.offset;
    const items = [...this.list];

    // Mudança de altura sem 'release': a nota anterior termina onde a nova começa.
    if (this.open) {
      const prev = items.find((i) => i.id === this.open!.id);
      if (prev && prev.kind === 'note' && prev.duration === null) {
        const d = Math.max(0, t - prev.onsetTime);
        items[items.indexOf(prev)] = { ...prev, duration: d, bucket: quantizeDuration(d) };
        this.timelineEnd = Math.max(this.timelineEnd, prev.onsetTime + d);
      }
    }

    const gap = t - this.timelineEnd;
    if (!this.noRestNext && gap >= this.opts.restMinS) {
      items.push({ kind: 'rest', id: this.nextId++, onsetTime: this.timelineEnd, duration: gap, bucket: quantizeDuration(gap) });
    }
    this.noRestNext = false;

    const id = this.nextId++;
    items.push(this.buildNote(id, start, t, inference));
    this.open = { id, engineOnset: start.onsetTime };
    this.timelineEnd = Math.max(this.timelineEnd, t);
    this.commit(items);
  }

  /** Fim de uma nota (silêncio, perda de altura ou reataque). `duration` em segundos. */
  release(onsetTime: number, duration: number): void {
    const open = this.open;
    if (!open || Math.abs(open.engineOnset - onsetTime) > 1e-6) return;
    this.open = null;
    const idx = this.list.findIndex((i) => i.id === open.id);
    const item = this.list[idx];
    if (!item || item.kind !== 'note') return;
    const d = Math.max(0, duration);
    const items = [...this.list];
    items[idx] = { ...item, duration: d, bucket: quantizeDuration(d) };
    this.timelineEnd = Math.max(this.timelineEnd, item.onsetTime + d);
    this.commit(items);
  }

  /**
   * Atualiza notas com as inferências atuais do decodificador (que pode ter revisado notas anteriores).
   * Notas corrigidas manualmente mantêm a posição do usuário. Só altera o que de fato mudou.
   */
  applyInferences(inferences: readonly PositionInference[]): void {
    if (this.list.length === 0 || inferences.length === 0) return;
    const byId = new Map<number, PositionInference>();
    for (const inf of inferences) byId.set(inf.noteId, inf);
    let changed = false;
    const items = this.list.map((item) => {
      if (item.kind !== 'note' || item.noteId === null) return item;
      const inf = byId.get(item.noteId);
      if (!inf || inf.midi !== item.midi) return item;
      const next = this.refresh(item, inf);
      if (next !== item) changed = true;
      return next;
    });
    if (changed) this.commit(items);
  }

  /** O decodificador foi recriado (região ou número de casas mudou): os vínculos antigos deixam de valer. */
  detach(): void {
    if (!this.list.some((i) => i.kind === 'note' && i.noteId !== null)) return;
    this.commit(
      this.list.map((i) => (i.kind === 'note' && i.noteId !== null ? { ...i, noteId: null, provisional: false } : i)),
    );
  }

  /**
   * Correção manual: define a posição de uma nota (uma das candidatas dela) ou, com `null`, volta à
   * estimativa do algoritmo. Devolve o `noteId` do decodificador para propagar a evidência, ou null.
   */
  correct(id: number, position: FretPosition | null): { noteId: number | null } | null {
    const idx = this.list.findIndex((i) => i.id === id);
    const item = this.list[idx];
    if (!item || item.kind !== 'note') return null;
    if (position && !item.candidates.some((c) => samePos(c.position, position))) return null;
    const items = [...this.list];
    items[idx] =
      position === null
        ? this.withDisplay({ ...item, manual: false }, item.autoPosition)
        : { ...item, manual: true, position, uncertain: false };
    this.commit(items);
    return { noteId: item.noteId };
  }

  clear(): void {
    this.commit([]);
    this.open = null;
    this.lastEngineOnset = null;
    this.noRestNext = true;
    // O tempo da linha do tempo continua; só o conteúdo é apagado.
  }

  // --- interno ---

  private commit(items: TabItem[]): void {
    const max = this.opts.maxItems;
    this.list = items.length > max ? items.slice(items.length - max) : items;
  }

  private buildNote(id: number, s: NoteStart, t: number, inf: PositionInference): TabNote {
    const base: TabNote = {
      kind: 'note',
      id,
      noteId: inf.noteId >= 0 ? inf.noteId : null,
      midi: s.midi,
      frequency: s.frequency,
      pitchConfidence: s.pitchConfidence,
      onsetTime: t,
      duration: null,
      bucket: null,
      position: null,
      autoPosition: null,
      manual: false,
      state: inf.state,
      positionConfidence: inf.positionConfidence,
      uncertain: true,
      candidates: inf.candidates,
      revisedFrom: inf.revisedFrom,
      revisionCount: inf.revisionCount,
      provisional: inf.provisional,
    };
    return this.withDisplay(base, inf.primary?.position ?? null);
  }

  /** Aplica a melhor estimativa como posição exibida (a menos que haja correção manual). */
  private withDisplay(item: TabNote, auto: FretPosition | null): TabNote {
    const uncertain = auto === null || (item.state !== 'confident' && item.state !== 'unique');
    return item.manual
      ? { ...item, autoPosition: auto }
      : { ...item, autoPosition: auto, position: auto, uncertain };
  }

  private refresh(item: TabNote, inf: PositionInference): TabNote {
    const auto = inf.primary?.position ?? null;
    const same =
      samePos(item.autoPosition, auto) &&
      item.state === inf.state &&
      item.positionConfidence === inf.positionConfidence &&
      item.revisionCount === inf.revisionCount &&
      item.provisional === inf.provisional &&
      item.candidates === inf.candidates;
    if (same) return item;
    return this.withDisplay(
      {
        ...item,
        state: inf.state,
        positionConfidence: inf.positionConfidence,
        candidates: inf.candidates,
        revisedFrom: inf.revisedFrom,
        revisionCount: inf.revisionCount,
        provisional: inf.provisional,
      },
      auto,
    );
  }
}
