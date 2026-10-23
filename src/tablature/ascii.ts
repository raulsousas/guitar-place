import type { Tuning } from '../types/music';
import type { TabItem } from '../types/tablature';
import { bucketIndex } from './quantize';

/**
 * Exporta a tablatura em ASCII (6 linhas, colunas de largura fixa).
 *
 * Formato (aproximado, NÃO é notação rítmica):
 * - Cada nota ocupa uma coluna de 4 caracteres: casa (até 2 dígitos) + `?` se a posição for incerta,
 *   completada com `-`. Uma posição marcada com `?` é um PALPITE do algoritmo, não uma casa confirmada.
 * - Uma pausa vira `1 + faixa` colunas vazias (faixas em quantize.ts); a duração das notas não é codificada.
 * - Notas sem posição no braço (fora do alcance) são omitidas e contadas na legenda.
 * - Quebra em sistemas de `columnsPerSystem` colunas para caber em texto simples.
 */
export interface AsciiOptions {
  columnsPerSystem: number;
  /** Texto de cabeçalho opcional (cada linha vira um comentário `#`). */
  header?: string;
}

export const DEFAULT_ASCII_OPTIONS: AsciiOptions = { columnsPerSystem: 16 };

const COL = 4;

function cell(text: string): string {
  return ('-' + text).padEnd(COL, '-').slice(0, COL);
}

export function exportAscii(items: readonly TabItem[], tuning: Tuning, options: Partial<AsciiOptions> = {}): string {
  const opts = { ...DEFAULT_ASCII_OPTIONS, ...options };
  const n = tuning.strings.length;
  // Cada coluna é um vetor de células (uma por corda).
  const columns: string[][] = [];
  let omitted = 0;
  let uncertain = 0;
  let notes = 0;
  const empty = () => Array.from({ length: n }, () => '-'.repeat(COL));

  for (const item of items) {
    if (item.kind === 'rest') {
      for (let k = 0; k < 1 + bucketIndex(item.bucket); k++) columns.push(empty());
      continue;
    }
    notes++;
    if (!item.position) {
      omitted++;
      continue;
    }
    if (item.uncertain) uncertain++;
    const col = empty();
    const text = `${item.position.fret}${item.uncertain ? '?' : ''}`;
    col[item.position.stringIndex] = cell(text);
    columns.push(col);
  }

  const lines: string[] = [];
  for (const h of (opts.header ?? '').split('\n')) if (h) lines.push(`# ${h}`);
  lines.push(`# Guitar Tracker: ${notes} nota(s); '?' = posicao incerta (palpite do algoritmo, nao confirmada).`);
  if (omitted > 0) lines.push(`# ${omitted} nota(s) sem posicao no braco foram omitidas.`);
  if (uncertain > 0) lines.push(`# ${uncertain} nota(s) com posicao incerta.`);
  lines.push('');

  if (columns.length === 0) {
    lines.push('(sem notas)');
    return lines.join('\n');
  }
  const labels = tuning.strings.map((s) => s.label.padEnd(1));
  for (let start = 0; start < columns.length; start += opts.columnsPerSystem) {
    const chunk = columns.slice(start, start + opts.columnsPerSystem);
    for (let s = 0; s < n; s++) {
      lines.push(`${labels[s]}|${chunk.map((c) => c[s]).join('')}|`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
