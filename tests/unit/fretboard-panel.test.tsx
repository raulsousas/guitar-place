import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { FretboardPanel } from '../../src/components/FretboardPanel';
import { FretboardSvg } from '../../src/components/FretboardSvg';
import { SuggestionsPanel } from '../../src/components/Panels';
import { StatusCards } from '../../src/components/StatusCards';
import { inferSequence, inferenceForLiveNote, normalizeRegion, rankPositions } from '../../src/inference/position';
import { DEFAULT_DECODER_CONFIG } from '../../src/inference/config';
import { SequenceDecoder } from '../../src/inference/decoder';
import { STANDARD_TUNING } from '../../src/music/tuning';
import type { AudioCaptureApi } from '../../src/hooks/useAudioCapture';
import type { FretRegion, HistoryEntry, PositionInference } from '../../src/types/position';

const T = STANDARD_TUNING;

/** Wrapper de teste: mantém o número de casas como o App faz e usa a função pura de inferência. */
function Harness({ midi, inference }: { midi: number | null; inference?: PositionInference | null }) {
  const [fretCount, setFretCount] = useState(24);
  const [requested, setRegion] = useState<FretRegion | null>(null);
  const region = normalizeRegion(requested, fretCount);
  const inf = inference !== undefined ? inference : inferenceForLiveNote(midi, null, T, fretCount, region);
  return (
    <FretboardPanel
      midi={midi}
      inference={inf}
      fretCount={fretCount}
      onFretCountChange={setFretCount}
      region={region}
      onRegionChange={setRegion}
    />
  );
}

function markers() {
  return screen.queryAllByTestId('fret-marker').map((el) => ({
    variant: el.getAttribute('data-variant'),
    string: Number(el.getAttribute('data-string-index')),
    fret: Number(el.getAttribute('data-fret')),
  }));
}

describe('FretboardSvg (renderização pura)', () => {
  it.each([12, 22, 24])('%i casas: numera todas as casas e desenha 6 cordas', (n) => {
    const { container } = render(<FretboardSvg tuning={T} fretCount={n} markers={[]} ariaLabel="x" />);
    expect(screen.getAllByTestId('fret-number')).toHaveLength(n);
    expect(screen.getAllByTestId('fret-number').at(-1)).toHaveTextContent(String(n));
    expect(container.querySelectorAll('line')).toHaveLength(6 + n);
    for (const label of ['e', 'B', 'G', 'D', 'A', 'E']) {
      expect(within(screen.getByTestId('fretboard-svg')).getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('marcações de referência: 10 em 24 casas (12 e 24 duplas), 5 em 12 casas', () => {
    const a = render(<FretboardSvg tuning={T} fretCount={24} markers={[]} ariaLabel="x" />);
    expect(a.getAllByTestId('inlay')).toHaveLength(10);
    a.unmount();
    const b = render(<FretboardSvg tuning={T} fretCount={12} markers={[]} ariaLabel="x" />);
    expect(b.getAllByTestId('inlay')).toHaveLength(5);
  });

  it('desenha só os marcadores recebidos, com as três variantes', () => {
    render(
      <FretboardSvg
        tuning={T}
        fretCount={24}
        markers={[
          { stringIndex: 0, fret: 1, variant: 'tentative' },
          { stringIndex: 1, fret: 6, variant: 'alternative' },
          { stringIndex: 5, fret: 0, variant: 'current' },
        ]}
        ariaLabel="x"
      />,
    );
    expect(markers().map((m) => m.variant).sort()).toEqual(['alternative', 'current', 'tentative']);
  });
});

describe('FretboardPanel ligado à inferência', () => {
  it('sem nota: nenhum destaque e texto explícito', () => {
    render(<Harness midi={null} />);
    expect(markers()).toEqual([]);
    expect(screen.getByTestId('fret-summary')).toHaveTextContent('Sem nota em andamento');
  });

  it('E2 (40): posição única, verde sólido, 6ª corda solta', () => {
    render(<Harness midi={40} />);
    expect(markers()).toEqual([{ variant: 'current', string: 5, fret: 0 }]);
    expect(screen.getByTestId('fret-summary')).toHaveTextContent('única posição possível, 6ª corda solta');
  });

  it('F4 sem contexto: melhor estimativa tracejada (ambígua), alternativas ocultas por padrão', () => {
    render(<Harness midi={65} />);
    expect(screen.getByTestId('show-others-switch')).toHaveAttribute('aria-checked', 'false');
    const m = markers();
    expect(m).toHaveLength(1);
    expect(m[0]!.variant).toBe('tentative');
    expect(screen.getByTestId('fret-summary')).toHaveTextContent('posição ambígua');
    expect(screen.getByTestId('fret-summary')).toHaveTextContent('4 alternativas');
  });

  it('com o interruptor ligado, as demais candidatas aparecem em azul e a principal continua tracejada', () => {
    render(<Harness midi={65} />);
    fireEvent.click(screen.getByTestId('show-others-switch'));
    expect(markers()).toHaveLength(5);
    expect(markers().filter((x) => x.variant === 'alternative')).toHaveLength(4);
    expect(markers().filter((x) => x.variant === 'tentative')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('show-others-switch'));
    expect(markers()).toHaveLength(1);
  });

  it('com contexto confiável, a posição inferida fica em verde sólido e o texto lembra que é estimativa', () => {
    const history: HistoryEntry[] = [
      { midi: 62, onsetTime: 0, stringIndex: 1, fret: 3, weight: 1 },
      { midi: 60, onsetTime: -0.5, stringIndex: 1, fret: 1, weight: 1 },
    ];
    const inf = rankPositions({ obs: { midi: 64, onsetTime: 0.5 }, tuning: T, fretCount: 24, history });
    expect(inf.state).toBe('confident');
    render(<Harness midi={64} inference={inf} />);
    expect(markers().map((x) => x.variant)).toEqual(['current']);
    expect(screen.getByTestId('fret-summary')).toHaveTextContent('o áudio não confirma a casa pressionada');
  });

  it('o seletor de casas muda o braço e as candidatas (E4: 6 com 24 casas, 3 com 12)', () => {
    render(<Harness midi={64} />);
    fireEvent.click(screen.getByTestId('show-others-switch'));
    expect(markers()).toHaveLength(6);
    fireEvent.change(screen.getByTestId('fret-count'), { target: { value: '12' } });
    expect(screen.getByTestId('fretboard-svg')).toHaveAttribute('data-fret-count', '12');
    expect(markers()).toHaveLength(3);
  });

  it('nota fora do alcance: sem marcadores e aviso', () => {
    render(<Harness midi={90} />);
    expect(markers()).toEqual([]);
    expect(screen.getByTestId('fret-summary')).toHaveTextContent('fora do alcance');
  });

  it('o rótulo acessível descreve a quantidade de casas', () => {
    render(<Harness midi={null} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('24 casas'));
  });
});

describe('inferenceForLiveNote', () => {
  it('reaproveita a inferência sequencial quando é a mesma nota e o mesmo número de casas', () => {
    const last = rankPositions({ obs: { midi: 65, onsetTime: 1 }, tuning: T, fretCount: 24, history: [] });
    expect(inferenceForLiveNote(65, last, T, 24)).toBe(last);
  });

  it('descarta a inferência de outro número de casas ou de outra nota (recalcula sem contexto)', () => {
    const last = rankPositions({ obs: { midi: 65, onsetTime: 1 }, tuning: T, fretCount: 24, history: [] });
    expect(inferenceForLiveNote(65, last, T, 12)).not.toBe(last);
    expect(inferenceForLiveNote(65, last, T, 12)!.fretCount).toBe(12);
    expect(inferenceForLiveNote(67, last, T, 24)!.midi).toBe(67);
    expect(inferenceForLiveNote(null, last, T, 24)).toBeNull();
  });
});

describe('Cartão de posição e painel de sugestões', () => {
  const audio = (over: Partial<AudioCaptureApi> = {}) =>
    ({
      status: 'active',
      live: {
        note: { midi: 65, frequency: 349.2, cents: 0, pitchConfidence: 0.93, onsetTime: 0, pitched: true },
        gateOpen: true,
      },
      stats: null,
      lastNote: null,
      ...over,
    }) as AudioCaptureApi;

  it('cartão: posição ambígua é rotulada como tal e a confiança da posição é separada da da nota', () => {
    const inf = inferenceForLiveNote(65, null, T, 24);
    render(<StatusCards audio={audio()} inference={inf} />);
    expect(screen.getByTestId('position-value')).toHaveAttribute('data-state', 'ambiguous');
    expect(screen.getByTestId('position-qualifier')).toHaveTextContent('Ambígua');
    expect(screen.getByTestId('position-confidence')).toHaveTextContent('Confiança da posição');
    expect(screen.getByTestId('confidence-value')).toHaveTextContent('93%');
  });

  it('cartão: sem nota não mostra posição', () => {
    const noNote = audio({ live: { note: null, gateOpen: false } as AudioCaptureApi['live'] });
    render(<StatusCards audio={noNote} inference={null} />);
    expect(screen.getByTestId('position-value')).toHaveTextContent('—');
    expect(screen.getByTestId('position-confidence')).toHaveTextContent('indisponível');
  });

  it('sugestões: lista ranqueada, aviso permanente de estimativa e primeiro item destacado', () => {
    const inf = inferenceForLiveNote(65, null, T, 24);
    render(<SuggestionsPanel inference={inf} />);
    const items = screen.getAllByTestId('suggestion-item');
    expect(items).toHaveLength(5);
    expect(items[0]!).toHaveClass('first');
    expect(screen.getByTestId('suggestions-disclaimer')).toHaveTextContent(/estimativas relativas do algoritmo/);
    expect(screen.getByTestId('suggestions-disclaimer')).toHaveTextContent(/não são probabilidades calibradas/i);
    expect(screen.getByTestId('suggestions-state')).toHaveTextContent('Ambígua');
  });

  it('sugestões: sem nota mostra indisponível, mantendo o aviso', () => {
    render(<SuggestionsPanel inference={null} />);
    expect(screen.getByTestId('unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('suggestions-disclaimer')).toBeInTheDocument();
  });
});

describe('região do braço informada pelo usuário', () => {
  const G3 = 55; // 3ª corda solta = 4ª corda casa 5 = 5ª corda casa 10 = 6ª corda casa 15
  const R = (minFret: number, maxFret: number, includeOpen: boolean): FretRegion => ({ minFret, maxFret, includeOpen });

  it('sem região, G3 tem 4 posições e o palpite é a corda solta (comportamento anterior)', () => {
    const inf = rankPositions({ obs: { midi: G3, onsetTime: 0 }, tuning: T, fretCount: 24, history: [] });
    expect(inf.candidates).toHaveLength(4);
    expect(inf.primary?.position).toMatchObject({ stringNumber: 3, fret: 0 });
    expect(inf.region).toBeNull();
    expect(inf.restrictedByRegion).toBe(false);
  });

  it('região 1-7 sem cordas soltas: G3 só cabe na 4ª corda, casa 5', () => {
    const inf = rankPositions({ obs: { midi: G3, onsetTime: 0 }, tuning: T, fretCount: 24, history: [], region: R(1, 7, false) });
    expect(inf.candidates).toHaveLength(1);
    expect(inf.primary?.position).toMatchObject({ stringNumber: 4, fret: 5 });
    expect(inf.restrictedByRegion).toBe(true);
  });

  it('uma só posição por causa da região NÃO é "unique": depende do que o usuário informou', () => {
    const inf = rankPositions({ obs: { midi: G3, onsetTime: 0 }, tuning: T, fretCount: 24, history: [], region: R(1, 7, false) });
    expect(inf.state).toBe('confident');
    expect(inf.positionConfidence).toBeLessThanOrEqual(0.9);
  });

  it('com cordas soltas incluídas, a solta continua concorrendo', () => {
    const inf = rankPositions({ obs: { midi: G3, onsetTime: 0 }, tuning: T, fretCount: 24, history: [], region: R(1, 7, true) });
    expect(inf.candidates.map((c) => `${c.position.stringNumber}:${c.position.fret}`).sort()).toEqual(['3:0', '4:5']);
    expect(inf.state).toBe('ambiguous');
  });

  it('nota que não existe na região usa o braço inteiro e sinaliza outsideRegion', () => {
    const inf = rankPositions({ obs: { midi: G3, onsetTime: 0 }, tuning: T, fretCount: 24, history: [], region: R(18, 22, false) });
    expect(inf.outsideRegion).toBe(true);
    expect(inf.candidates.length).toBeGreaterThan(1);
  });

  it('PositionInferrer e inferSequence respeitam a região em toda a sequência', () => {
    const seq = [50, 55, 57].map((midi, i) => ({ midi, onsetTime: i * 0.8 }));
    const out = inferSequence(seq, T, 24, undefined, R(1, 7, false));
    for (const r of out) expect(r.primary?.position.fret).toBeGreaterThan(0);
    expect(out[1]!.primary?.position).toMatchObject({ stringNumber: 4, fret: 5 });
  });

  it('inferenceForLiveNote recalcula quando a região muda', () => {
    const base = rankPositions({ obs: { midi: G3, onsetTime: 0 }, tuning: T, fretCount: 24, history: [] });
    expect(inferenceForLiveNote(G3, base, T, 24, null)).toBe(base);
    const restricted = inferenceForLiveNote(G3, base, T, 24, R(1, 7, false));
    expect(restricted).not.toBe(base);
    expect(restricted!.primary?.position).toMatchObject({ stringNumber: 4, fret: 5 });
  });

  it('normalizeRegion limita a região ao número de casas', () => {
    expect(normalizeRegion(null, 24)).toBeNull();
    expect(normalizeRegion(R(3, 30, true), 12)).toEqual(R(3, 12, true));
    expect(normalizeRegion(R(20, 22, false), 12)).toEqual(R(12, 12, false));
  });

  it('interface: ligar a região mostra G3 na 4ª corda e rotula como informado pelo usuário', () => {
    render(<Harness midi={G3} />);
    expect(screen.getByTestId('region-note')).toHaveTextContent(/braço inteiro/i);
    fireEvent.click(screen.getByTestId('region-switch'));
    fireEvent.click(screen.getByTestId('region-open'));
    expect(screen.getByTestId('region-band')).toBeInTheDocument();
    expect(markers()).toEqual([{ variant: 'current', string: 3, fret: 5 }]);
    expect(screen.getByTestId('region-note')).toHaveTextContent(/informado por você/i);
    expect(screen.getByTestId('fret-summary')).toHaveTextContent(/região que você declarou/i);
    fireEvent.click(screen.getByTestId('region-switch'));
    expect(screen.queryByTestId('region-band')).toBeNull();
  });
});

describe('Fase 5a: revisão e região como preferência na interface', () => {
  const SEQ = [62, 65, 63, 64, 67];

  function lastUpdate() {
    const d = new SequenceDecoder(T, 24);
    const ups = SEQ.map((m, i) => d.observe({ midi: m, onsetTime: i * 0.55 }));
    const withRev = ups.findIndex((u) => u.revisions.length > 0);
    return { ups, withRev, revisions: ups.flatMap((u) => u.revisions) };
  }

  it('mostra o aviso de posição revisada enquanto a nota que provocou a revisão está ao vivo', () => {
    const { ups, withRev, revisions } = lastUpdate();
    expect(withRev).toBeGreaterThan(0);
    const live = ups[withRev]!.latest;
    render(
      <FretboardPanel midi={live.midi} inference={live} fretCount={24} onFretCountChange={() => {}} region={null} onRegionChange={() => {}} revisions={revisions} />,
    );
    const note = screen.getByTestId('revision-note');
    expect(note).toHaveTextContent(/Posição revisada/);
    expect(note).toHaveTextContent(/estimativa/i);
  });

  it('o aviso some quando chega outra nota e não aparece sem revisão', () => {
    const { ups, withRev, revisions } = lastUpdate();
    const next = ups[Math.min(withRev + 1, ups.length - 1)]!.latest;
    const { rerender } = render(
      <FretboardPanel midi={next.midi} inference={next} fretCount={24} onFretCountChange={() => {}} region={null} onRegionChange={() => {}} revisions={revisions} />,
    );
    if (next.noteId !== revisions.at(-1)!.triggeredBy) expect(screen.queryByTestId('revision-note')).toBeNull();
    rerender(
      <FretboardPanel midi={next.midi} inference={next} fretCount={24} onFretCountChange={() => {}} region={null} onRegionChange={() => {}} revisions={[]} />,
    );
    expect(screen.queryByTestId('revision-note')).toBeNull();
  });

  it('avisa quando a melhor estimativa fica FORA da região declarada (região é preferência, não filtro)', () => {
    const region = { minFret: 1, maxFret: 7, includeOpen: false };
    const cfg = { ...DEFAULT_DECODER_CONFIG, userRegionPenalty: 0 };
    const inf = new SequenceDecoder(T, 24, region, cfg).observe({ midi: 55, onsetTime: 0 }).latest;
    expect(inf.primaryOutsideRegion).toBe(true);
    render(
      <FretboardPanel midi={55} inference={inf} fretCount={24} onFretCountChange={() => {}} region={region} onRegionChange={() => {}} />,
    );
    expect(screen.getByTestId('fret-summary')).toHaveTextContent(/FORA da região/);
  });
});