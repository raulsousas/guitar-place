import { midiToFrequency, midiToScientificName } from '../music/notes';
import { STANDARD_TUNING } from '../music/tuning';
import { Panel } from './Panel';
import { ChevronDownIcon, TuningIcon } from './icons';

const ORDINAL_SUFFIX: Record<number, string> = {
  1: '1ª (mais fina)',
  6: '6ª (mais grossa)',
};

/** Referência da afinação (dados reais calculados a partir das notas MIDI). */
export function TuningPanel() {
  const tuning = STANDARD_TUNING;
  return (
    <Panel title="Afinação" icon={<TuningIcon size={22} />} testId="tuning-panel">
      <div style={{ position: 'relative' }}>
        <select className="select" aria-label="Afinação" value={tuning.id} disabled onChange={() => undefined}>
          <option value={tuning.id}>{tuning.name}</option>
        </select>
        <ChevronDownIcon size={16} style={{ position: 'absolute', right: 10, top: 12, pointerEvents: 'none' }} />
      </div>
      <p className="note-small">Afinações alternativas: em desenvolvimento.</p>
      <table className="tuning-table" data-testid="tuning-table">
        <tbody>
          {tuning.strings.map((s) => (
            <tr key={s.stringNumber}>
              <td>{ORDINAL_SUFFIX[s.stringNumber] ?? `${s.stringNumber}ª`}</td>
              <td>{midiToScientificName(s.midi)}</td>
              <td>{midiToFrequency(s.midi).toFixed(2).replace('.', ',')} Hz</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
