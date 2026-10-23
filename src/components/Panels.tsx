import { midiToScientificName } from '../music/notes';
import type { PositionInference } from '../types/position';
import { Panel, Unavailable } from './Panel';
import {
  CheckIcon,
  InfoIcon,
  LightbulbIcon,
  SlidersIcon,
} from './icons';

const SUGGESTION_STATE: Record<PositionInference['state'], string> = {
  unique: 'Posição única possível',
  confident: 'Estimada pelo contexto',
  ambiguous: 'Ambígua: palpite do algoritmo',
  unknown: 'Fora do alcance do braço',
};

/**
 * Candidatas ranqueadas da nota ao vivo. As pontuações são estimativas relativas do algoritmo
 * (heurística de contexto), NÃO probabilidades calibradas nem confirmação física.
 */
export function SuggestionsPanel({ inference }: { inference: PositionInference | null }) {
  return (
    <Panel title="Sugestões de posições" icon={<SlidersIcon size={20} />} testId="suggestions-panel">
      {inference && inference.candidates.length > 0 ? (
        <>
          <p className="suggest-state" data-testid="suggestions-state" data-state={inference.state}>
            {SUGGESTION_STATE[inference.state]}
          </p>
          <ul className="list suggestions" data-testid="suggestions-list">
            {inference.candidates.map((c, i) => (
              <li
                key={`${c.position.stringIndex}-${c.position.fret}`}
                className={i === 0 ? 'suggestion first' : 'suggestion'}
                data-testid="suggestion-item"
              >
                <span>{c.position.stringNumber}ª corda</span>
                <span>{c.position.fret === 0 ? 'solta' : `${c.position.fret}ª casa`}</span>
                <span>{midiToScientificName(c.position.midi)}</span>
                <span className="score" title="Pontuação relativa do algoritmo (estimativa)">
                  <span className="score-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(c.score * 100)}%` }} />
                  </span>
                  {Math.round(c.score * 100)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Unavailable state="off" detail="Toque uma nota para ver as posições compatíveis" />
      )}
      <div className="disclaimer" data-testid="suggestions-disclaimer">
        <InfoIcon size={18} />
        <span>
          Pontuações são estimativas relativas do algoritmo (contexto das notas anteriores). Não são
          probabilidades calibradas nem confirmação física da posição pressionada.
        </span>
      </div>
    </Panel>
  );
}
const TIPS = [
  'Use uma interface de áudio para melhor precisão.',
  'Toque notas isoladas (uma por vez) para facilitar a detecção.',
  'Uma mesma nota pode ser tocada em várias posições; o áudio sozinho não confirma a casa.',
  'Vibrato, distorção e palm mute podem afetar a precisão.',
  'Mantenha o sinal limpo, sem saturar (clipping) e com pouco ruído de fundo.',
];

export function TipsPanel() {
  return (
    <Panel title="Dicas" icon={<LightbulbIcon size={20} />} testId="tips-panel">
      <ul className="list tips">
        {TIPS.map((t) => (
          <li key={t}>
            <CheckIcon size={16} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
