import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { HistoryPanel } from '../../src/components/HistoryPanel';
import { TablaturePanel } from '../../src/components/TablaturePanel';
import { SequenceDecoder } from '../../src/inference/decoder';
import { midiToFrequency } from '../../src/music/notes';
import { STANDARD_TUNING } from '../../src/music/tuning';
import { TabRecorder } from '../../src/tablature/recorder';
import type { FretPosition } from '../../src/music/fretmap';
import type { TabItem } from '../../src/types/tablature';

/** Monta itens reais com o decodificador e o gravador (nada de dados fixos inventados). */
function build(midis: number[], gap = 0.5): { rec: TabRecorder; decoder: SequenceDecoder } {
  const decoder = new SequenceDecoder(STANDARD_TUNING, 24);
  const rec = new TabRecorder();
  midis.forEach((midi, i) => {
    const t = 1 + i * gap;
    const up = decoder.observe({ midi, onsetTime: t });
    rec.addNote({ midi, frequency: midiToFrequency(midi), pitchConfidence: 0.93, onsetTime: t }, up.latest);
    rec.applyInferences(decoder.inferences());
    rec.release(t, 0.3);
  });
  return { rec, decoder };
}

function Harness({ rec, decoder }: { rec: TabRecorder; decoder: SequenceDecoder }) {
  const [items, setItems] = useState<readonly TabItem[]>(rec.items);
  const [paused, setPaused] = useState(false);
  return (
    <>
      <TablaturePanel
        items={items}
        paused={paused}
        capturing
        onPausedChange={(p) => {
          rec.setPaused(p);
          setPaused(p);
        }}
        onClear={() => {
          rec.clear();
          setItems(rec.items);
        }}
        onCorrect={(id: number, position: FretPosition | null) => {
          const res = rec.correct(id, position);
          if (!res) return null;
          let propagated = false;
          if (res.noteId !== null) {
            const upd = decoder.applyEvidence(
              res.noteId,
              position ? [{ source: 'manual', stringIndex: position.stringIndex, fret: position.fret, support: 1 }] : [],
            );
            if (upd) {
              propagated = true;
              rec.applyInferences(decoder.inferences());
            }
          }
          setItems(rec.items);
          return { propagated };
        }}
      />
      <HistoryPanel items={items} />
    </>
  );
}

describe('TablaturePanel', () => {
  it('vazio: seis linhas reais, mensagem e nenhum dado inventado', () => {
    render(<TablaturePanel items={[]} paused={false} capturing={false} onPausedChange={() => undefined} onClear={() => undefined} onCorrect={() => null} />);
    expect(screen.getByTestId('tablature-svg')).toHaveAttribute('data-notes', '0');
    expect(screen.getByTestId('tab-empty')).toHaveTextContent('Inicie a captura');
    expect(screen.queryAllByTestId('tab-note')).toHaveLength(0);
    expect(screen.getByTestId('tab-clear')).toBeDisabled();
    expect(screen.getByTestId('tab-copy')).toBeDisabled();
  });

  it('mostra uma marca por nota, na ordem, com incerteza visível', () => {
    const { rec, decoder } = build([40, 55, 57]);
    render(<Harness rec={rec} decoder={decoder} />);
    const notes = screen.getAllByTestId('tab-note');
    expect(notes.map((n) => n.getAttribute('data-midi'))).toEqual(['40', '55', '57']);
    // E2 é posição única; as demais são palpites.
    expect(notes[0]).toHaveAttribute('data-uncertain', 'false');
    expect(notes[1]).toHaveAttribute('data-uncertain', 'true');
    expect(notes[1]).toHaveAttribute('aria-label', expect.stringContaining('INCERTA'));
    expect(screen.getByTestId('tab-legend')).toHaveTextContent(/incerta/i);
  });

  it('pausa entre notas aparece como pausa', () => {
    const { rec, decoder } = build([60, 62], 3);
    render(<Harness rec={rec} decoder={decoder} />);
    expect(screen.getAllByTestId('tab-rest')).toHaveLength(1);
  });

  it('clicar numa nota abre os detalhes e a correção a marca como manual', () => {
    const { rec, decoder } = build([55]);
    render(<Harness rec={rec} decoder={decoder} />);
    fireEvent.click(screen.getByTestId('tab-note'));
    const detail = screen.getByTestId('tab-detail');
    expect(detail).toHaveTextContent('G3');
    expect(detail).toHaveTextContent(/não confirma a casa/i);
    const choices = within(detail).getAllByTestId('tab-choice');
    expect(choices).toHaveLength(4);
    const fourth = choices.find((c) => c.textContent?.includes('4ª corda'))!;
    fireEvent.click(fourth);
    const note = screen.getByTestId('tab-note');
    expect(note).toHaveAttribute('data-manual', 'true');
    expect(note).toHaveAttribute('data-uncertain', 'false');
    expect(note).toHaveAttribute('data-string', '4');
    expect(note).toHaveAttribute('data-fret', '5');
    expect(screen.getByTestId('tab-message')).toHaveTextContent(/evidência forte/i);
    // Voltar à estimativa.
    fireEvent.click(screen.getByTestId('tab-reset'));
    expect(screen.getByTestId('tab-note')).toHaveAttribute('data-manual', 'false');
  });

  it('o histórico reflete a correção e mostra a confiança da NOTA', () => {
    const { rec, decoder } = build([55]);
    render(<Harness rec={rec} decoder={decoder} />);
    const before = screen.getByTestId('history-item');
    expect(before).toHaveAttribute('data-uncertain', 'true');
    expect(before).toHaveTextContent('93%');
    fireEvent.click(screen.getByTestId('tab-note'));
    fireEvent.click(screen.getAllByTestId('tab-choice')[1]!);
    expect(screen.getByTestId('history-item')).toHaveAttribute('data-manual', 'true');
  });

  it('pausar muda o rótulo e o aviso; limpar esvazia tablatura e histórico', () => {
    const { rec, decoder } = build([64, 66]);
    render(<Harness rec={rec} decoder={decoder} />);
    fireEvent.click(screen.getByTestId('tab-pause'));
    expect(screen.getByTestId('tab-pause')).toHaveTextContent('Retomar gravação');
    expect(screen.getByTestId('tab-paused-note')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tab-clear'));
    expect(screen.queryAllByTestId('tab-note')).toHaveLength(0);
    expect(screen.queryAllByTestId('history-item')).toHaveLength(0);
  });

  it('o seletor de últimas notas limita o que é exibido sem apagar o histórico', () => {
    const { rec, decoder } = build([60, 61, 62, 63, 64, 65, 66, 67, 68, 69]);
    render(<Harness rec={rec} decoder={decoder} />);
    expect(screen.getAllByTestId('tab-note')).toHaveLength(10);
    fireEvent.change(screen.getByTestId('tab-count'), { target: { value: '8' } });
    expect(screen.getAllByTestId('tab-note')).toHaveLength(8);
    expect(screen.getAllByTestId('history-item')).toHaveLength(10);
  });

  it('copiar usa a área de transferência com texto ASCII e nunca envia nada para fora', () => {
    const { rec, decoder } = build([40, 55]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Harness rec={rec} decoder={decoder} />);
    fireEvent.click(screen.getByTestId('tab-copy'));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]![0]).toMatch(/E\|/);
    expect(writeText.mock.calls[0]![0]).toContain('?');
  });
});

describe('HistoryPanel', () => {
  it('sem notas mostra estado indisponível, não dados inventados', () => {
    render(<HistoryPanel items={[]} />);
    expect(screen.getByTestId('unavailable')).toBeInTheDocument();
    expect(screen.queryAllByTestId('history-item')).toHaveLength(0);
  });

  it('lista a mais recente primeiro', () => {
    const { rec } = build([60, 62, 64]);
    render(<HistoryPanel items={rec.items} />);
    const rows = screen.getAllByTestId('history-item');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('E4');
    expect(rows[2]).toHaveTextContent('C4');
  });
});
