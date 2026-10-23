import type { TabItem } from '../types/tablature';
import { bucketIndex } from './quantize';

/** Geometria da tablatura em SVG (unidades do viewBox). */
export const TAB_LEFT = 44;
export const TAB_TOP = 26;
export const TAB_ROW_GAP = 22;
export const TAB_PAD_RIGHT = 16;

/** Largura horizontal por faixa de duração: só espaçamento visual, NÃO é duração rítmica. */
const NOTE_WIDTH = [34, 38, 44, 52, 62] as const;
const REST_BASE = 18;
const REST_STEP = 6;
/** Intervalo mínimo (s) entre rótulos de tempo no topo. */
const TIME_LABEL_EVERY_S = 5;

export interface TabColumn {
  item: TabItem;
  /** Centro da coluna. */
  x: number;
  width: number;
  /** Rótulo de tempo exibido acima da coluna, se houver. */
  timeLabel: string | null;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Últimos `count` registros de nota (e as pausas entre eles). `Infinity` = tudo. */
export function visibleItems(items: readonly TabItem[], count: number): readonly TabItem[] {
  if (!Number.isFinite(count)) return items;
  let notes = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]!.kind === 'note') notes++;
    if (notes > count) return items.slice(i + 1);
  }
  return items;
}

export function layoutColumns(items: readonly TabItem[]): { columns: TabColumn[]; width: number } {
  const columns: TabColumn[] = [];
  let x = TAB_LEFT + 6;
  let lastLabel = -Infinity;
  for (const item of items) {
    const idx = bucketIndex(item.bucket);
    const width = item.kind === 'note' ? NOTE_WIDTH[idx]! : REST_BASE + REST_STEP * idx;
    let timeLabel: string | null = null;
    if (item.onsetTime - lastLabel >= TIME_LABEL_EVERY_S) {
      timeLabel = formatTime(item.onsetTime);
      lastLabel = item.onsetTime;
    }
    columns.push({ item, x: x + width / 2, width, timeLabel });
    x += width;
  }
  return { columns, width: x + TAB_PAD_RIGHT };
}
