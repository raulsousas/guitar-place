import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);

describe('fronteira entre o Estúdio (src/fx) e o detector (src/dsp)', () => {
  it('src/fx não importa nada de src/dsp, src/inference nem src/tablature', () => {
    const bad = files('src/fx').flatMap((f) =>
      importsOf(f).filter((i) => /(^|\/)(dsp|inference|tablature|audio\/engine-host)(\/|$)/.test(i)).map((i) => `${f}: ${i}`),
    );
    expect(bad).toEqual([]);
  });
  it('src/dsp não importa nada de src/fx', () => {
    const bad = files('src/dsp').flatMap((f) => importsOf(f).filter((i) => /(^|\/)fx(\/|$)/.test(i)).map((i) => `${f}: ${i}`));
    expect(bad).toEqual([]);
  });
  it('o caminho de captura e o detector (src/audio, src/inference, src/tablature) não conhecem o Estúdio', () => {
    const bad = ['src/audio', 'src/inference', 'src/tablature', 'src/music'].flatMap((d) =>
      files(d).flatMap((f) => importsOf(f).filter((i) => /(^|\/)(fx|hooks\/useStudio)(\/|$)/.test(i)).map((i) => `${f}: ${i}`)),
    );
    expect(bad).toEqual([]);
  });
  it('o teste enxerga os arquivos (guarda contra passar vazio)', () => {
    expect(files('src/fx').length).toBeGreaterThanOrEqual(5);
    expect(files('src/dsp').length).toBeGreaterThan(3);
  });
});