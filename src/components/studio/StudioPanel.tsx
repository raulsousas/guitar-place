import { useState } from 'react';
import type { ChannelMode } from '../../types/audio';
import type { StudioApi } from '../../hooks/useStudio';
import { STUDIO_PRESETS } from '../../fx/presets';
import type { AmpVoicing, CabinetKind, StudioParams } from '../../fx/types';
import { Panel } from '../Panel';
import { ShieldIcon, SlidersIcon } from '../icons';
import { AutoConfigSection } from './AutoConfigSection';
import type { DecodedAudio } from '../../audio/decode-file';
import { Knob } from './Knob';
import { NoiseMeasureControl } from './NoiseMeasureControl';
import { LatencySection, OutputSection } from './OutputSection';

type SubTab = 'effects' | 'amp' | 'cabinet' | 'mixer';
const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'effects', label: 'Efeitos' },
  { id: 'amp', label: 'Amplificador' },
  { id: 'cabinet', label: 'Gabinete' },
  { id: 'mixer', label: 'Mixer' },
];

type BlockId = 'gate' | 'drive' | 'eq' | 'amp' | 'cabinet' | 'delay' | 'reverb';
const CHAIN: { id: BlockId; label: string }[] = [
  { id: 'gate', label: 'Portão de ruído' },
  { id: 'drive', label: 'Pedal de drive' },
  { id: 'eq', label: 'Equalizador' },
  { id: 'amp', label: 'Amplificador' },
  { id: 'cabinet', label: 'Gabinete' },
  { id: 'delay', label: 'Delay' },
  { id: 'reverb', label: 'Reverb' },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const dbFmt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)} dB`;

const VOICINGS: { id: AmpVoicing; label: string; hint: string }[] = [
  { id: 'clean', label: 'Limpo', hint: 'Saturação suave, só ao tocar forte.' },
  { id: 'crunch', label: 'Crunch', hint: 'Saturação média, com harmônicos pares leves.' },
  { id: 'high', label: 'Alto ganho', hint: 'Saturação forte e comprimida.' },
];

const CABINETS: { id: CabinetKind; label: string; hint: string }[] = [
  { id: '1x12', label: 'Compacto (1x12)', hint: 'Corte em ~5,4 kHz e ressonância em ~110 Hz: som mais aberto.' },
  { id: '4x12', label: 'Grande (4x12)', hint: 'Corte em ~4,6 kHz e ressonância em ~90 Hz: som mais fechado e encorpado.' },
];

const CHANNELS: { id: ChannelMode; label: string }[] = [
  { id: 'ch1', label: 'Entrada 1' },
  { id: 'ch2', label: 'Entrada 2' },
  { id: 'sum', label: 'Soma' },
];

function BlockHeader({
  label,
  enabled,
  onToggle,
  testId,
  note,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  testId: string;
  note?: string;
}) {
  const id = `${testId}-label`;
  return (
    <div className="block-head">
      <div>
        <h4 id={id}>{label}</h4>
        {note ? <p className="note-small">{note}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={id}
        className="switch"
        onClick={onToggle}
        data-testid={`${testId}-switch`}
      />
    </div>
  );
}

export function StudioPanel({ studio, decode }: { studio: StudioApi; decode?: (file: File) => Promise<DecodedAudio> }) {
  const [tab, setTab] = useState<SubTab>('effects');
  const { params, update } = studio;

  const set = <K extends BlockId>(block: K, patch: Partial<StudioParams[K]>) =>
    update((p) => ({ ...p, [block]: { ...p[block], ...patch } }));

  return (
    <div className="studio" data-testid="studio-view">
      <div className="studio-main">
        <Panel title="Estúdio: efeitos e amplificador" icon={<SlidersIcon size={22} />} testId="studio-panel">
          <div className="studio-privacy" data-testid="studio-privacy">
            <ShieldIcon size={16} />
            <span>
              Seu som é processado no navegador, sem envio de dados. O detector de notas continua recebendo o sinal
              original, sem efeitos.
            </span>
          </div>

          <AutoConfigSection studio={studio} decode={decode} />

          <label className="field-label" htmlFor="studio-preset">
            Predefinição
          </label>
          <select
            id="studio-preset"
            className="select"
            value={studio.presetId ?? ''}
            onChange={(e) => studio.applyPreset(e.target.value)}
            data-testid="studio-preset"
          >
            {studio.presetId === null ? <option value="">Personalizada</option> : null}
            {STUDIO_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="note-small" data-testid="studio-preset-hint">
            {STUDIO_PRESETS.find((p) => p.id === studio.presetId)?.description ??
              'Ajustes manuais. As predefinições são pontos de partida subjetivos e não reproduzem equipamentos reais.'}{' '}
            Trocar a predefinição não altera o volume geral nem o canal de entrada.
          </p>

          <ol className="chain" aria-label="Cadeia de efeitos" data-testid="studio-chain">
            <li className="chain-node fixed">Entrada</li>
            {CHAIN.map((b) => (
              <li key={b.id} className={params[b.id].enabled ? 'chain-node on' : 'chain-node'}>
                <button
                  type="button"
                  aria-pressed={params[b.id].enabled}
                  onClick={() => set(b.id, { enabled: !params[b.id].enabled } as never)}
                  data-testid={`chain-${b.id}`}
                >
                  {b.label}
                </button>
              </li>
            ))}
            <li className="chain-node fixed">Saída</li>
          </ol>

          <div className="view-tabs sub" role="tablist" aria-label="Seções do estúdio">
            {SUB_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'view-tab active' : 'view-tab'}
                onClick={() => setTab(t.id)}
                data-testid={`studio-tab-${t.id}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'effects' ? (
            <div className="blocks" role="tabpanel" data-testid="studio-pane-effects">
              <section className="block">
                <BlockHeader
                  label="Portão de ruído"
                  enabled={params.gate.enabled}
                  onToggle={() => set('gate', { enabled: !params.gate.enabled })}
                  testId="gate"
                  note="Fecha o som entre as notas: tira o chiado que o drive e o ganho alto aumentam. Fica antes do drive."
                />
                <div className="knobs">
                  <Knob label="Limiar" testId="gate-threshold" value={params.gate.thresholdDb} min={-80} max={-30} step={1} format={dbFmt} onChange={(v) => set('gate', { thresholdDb: v })} />
                </div>
                <NoiseMeasureControl studio={studio} />
                <p className="note-small">
                  Limiar alto demais corta o fim das notas e notas fracas; baixo demais deixa o chiado passar. Adiciona cerca de 5 ms de atraso enquanto estiver ligado.
                </p>
              </section>

              <section className="block">
                <BlockHeader
                  label="Pedal de drive"
                  enabled={params.drive.enabled}
                  onToggle={() => set('drive', { enabled: !params.drive.enabled })}
                  testId="drive"
                  note="Saturação à frente do amplificador."
                />
                <div className="knobs">
                  <Knob label="Drive" testId="drive-drive" value={params.drive.drive} min={0} max={1} step={0.01} format={(v) => `${(30 * v).toFixed(0)} dB`} onChange={(v) => set('drive', { drive: v })} />
                  <Knob label="Tom" testId="drive-tone" value={params.drive.tone} min={0} max={1} step={0.01} format={pct} onChange={(v) => set('drive', { tone: v })} />
                  <Knob label="Volume" testId="drive-level" value={params.drive.level} min={0} max={1} step={0.01} format={(v) => dbFmt(-12 + 18 * v)} onChange={(v) => set('drive', { level: v })} />
                </div>
              </section>

              <section className="block">
                <BlockHeader
                  label="Equalizador"
                  enabled={params.eq.enabled}
                  onToggle={() => set('eq', { enabled: !params.eq.enabled })}
                  testId="eq"
                  note="Graves (100 Hz), médios (800 Hz) e agudos (3 kHz)."
                />
                <div className="knobs">
                  <Knob label="Graves" testId="eq-low" value={params.eq.lowDb} min={-12} max={12} step={1} format={dbFmt} onChange={(v) => set('eq', { lowDb: v })} />
                  <Knob label="Médios" testId="eq-mid" value={params.eq.midDb} min={-12} max={12} step={1} format={dbFmt} onChange={(v) => set('eq', { midDb: v })} />
                  <Knob label="Agudos" testId="eq-high" value={params.eq.highDb} min={-12} max={12} step={1} format={dbFmt} onChange={(v) => set('eq', { highDb: v })} />
                </div>
              </section>

              <section className="block">
                <BlockHeader
                  label="Delay"
                  enabled={params.delay.enabled}
                  onToggle={() => set('delay', { enabled: !params.delay.enabled })}
                  testId="delay"
                  note="Eco com repetições decrescentes."
                />
                <div className="knobs">
                  <Knob label="Tempo" testId="delay-time" value={params.delay.timeMs} min={40} max={1000} step={10} format={(v) => `${v.toFixed(0)} ms`} onChange={(v) => set('delay', { timeMs: v })} />
                  <Knob label="Repetições" testId="delay-feedback" value={params.delay.feedback} min={0} max={0.85} step={0.01} format={pct} onChange={(v) => set('delay', { feedback: v })} />
                  <Knob label="Mix" testId="delay-mix" value={params.delay.mix} min={0} max={1} step={0.01} format={pct} onChange={(v) => set('delay', { mix: v })} />
                </div>
              </section>

              <section className="block">
                <BlockHeader
                  label="Reverb"
                  enabled={params.reverb.enabled}
                  onToggle={() => set('reverb', { enabled: !params.reverb.enabled })}
                  testId="reverb"
                  note="Ambiente sintético gerado no próprio navegador."
                />
                <div className="knobs">
                  <Knob label="Decaimento" testId="reverb-decay" value={params.reverb.decayS} min={0.3} max={4} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => set('reverb', { decayS: v })} />
                  <Knob label="Mix" testId="reverb-mix" value={params.reverb.mix} min={0} max={1} step={0.01} format={pct} onChange={(v) => set('reverb', { mix: v })} />
                </div>
              </section>
            </div>
          ) : null}

          {tab === 'amp' ? (
            <div className="blocks" role="tabpanel" data-testid="studio-pane-amp">
              <section className="block wide">
                <BlockHeader
                  label="Amplificador"
                  enabled={params.amp.enabled}
                  onToggle={() => set('amp', { enabled: !params.amp.enabled })}
                  testId="amp"
                  note="Aproximação simples: saturação por curva matemática e três filtros de tom. Não é um modelo de equipamento real."
                />
                <div className="seg" role="group" aria-label="Voz do amplificador" data-testid="amp-voicing">
                  {VOICINGS.map((v) => (
                    <button key={v.id} type="button" aria-pressed={params.amp.voicing === v.id} onClick={() => set('amp', { voicing: v.id })} data-testid={`amp-voicing-${v.id}`}>
                      {v.label}
                    </button>
                  ))}
                </div>
                <p className="note-small">{VOICINGS.find((v) => v.id === params.amp.voicing)?.hint}</p>
                <div className="knobs">
                  <Knob label="Ganho" testId="amp-gain" value={params.amp.gain} min={0} max={1} step={0.01} format={pct} onChange={(v) => set('amp', { gain: v })} />
                  <Knob label="Graves" testId="amp-bass" value={params.amp.bass} min={0} max={1} step={0.01} format={pct} onChange={(v) => set('amp', { bass: v })} />
                  <Knob label="Médios" testId="amp-mid" value={params.amp.mid} min={0} max={1} step={0.01} format={pct} onChange={(v) => set('amp', { mid: v })} />
                  <Knob label="Agudos" testId="amp-treble" value={params.amp.treble} min={0} max={1} step={0.01} format={pct} onChange={(v) => set('amp', { treble: v })} />
                  <Knob label="Volume" testId="amp-level" value={params.amp.level} min={0} max={1} step={0.01} format={pct} onChange={(v) => set('amp', { level: v })} />
                </div>
              </section>
            </div>
          ) : null}

          {tab === 'cabinet' ? (
            <div className="blocks" role="tabpanel" data-testid="studio-pane-cabinet">
              <section className="block wide">
                <BlockHeader
                  label="Gabinete"
                  enabled={params.cabinet.enabled}
                  onToggle={() => set('cabinet', { enabled: !params.cabinet.enabled })}
                  testId="cabinet"
                  note="Filtros passa-baixas e uma ressonância de graves. Sem respostas de impulso de equipamentos reais."
                />
                <div className="seg" role="group" aria-label="Tamanho do gabinete" data-testid="cabinet-kind">
                  {CABINETS.map((c) => (
                    <button key={c.id} type="button" aria-pressed={params.cabinet.kind === c.id} onClick={() => set('cabinet', { kind: c.id })} data-testid={`cabinet-kind-${c.id}`}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <p className="note-small">{CABINETS.find((c) => c.id === params.cabinet.kind)?.hint}</p>
                <p className="note-small">
                  Gabinete ligado sem amplificador deixa o som abafado: o gabinete corta agudos que a guitarra limpa teria.
                </p>
              </section>
            </div>
          ) : null}

          {tab === 'mixer' ? (
            <div className="blocks" role="tabpanel" data-testid="studio-pane-mixer">
              <section className="block wide">
                <h4>Entrada</h4>
                <p className="note-small">Canal usado para ouvir. É independente do canal analisado pelo detector.</p>
                <div className="seg" role="group" aria-label="Canal ouvido" data-testid="studio-channel">
                  {CHANNELS.map((c) => (
                    <button key={c.id} type="button" aria-pressed={params.inputChannel === c.id} onClick={() => update((p) => ({ ...p, inputChannel: c.id }))} data-testid={`studio-channel-${c.id}`}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="knobs">
                  <Knob label="Ganho de entrada" testId="studio-trim" value={params.inputTrimDb} min={-20} max={20} step={1} format={dbFmt} onChange={(v) => update((p) => ({ ...p, inputTrimDb: v }))} />
                  <Knob label="Volume geral" testId="studio-master-knob" value={params.masterDb} min={-40} max={0} step={1} format={dbFmt} onChange={(v) => update((p) => ({ ...p, masterDb: v }))} />
                </div>
                <p className="note-small">
                  A saída passa por um limitador suave (teto de 0,98): picos muito altos são arredondados em vez de estourar, mas o
                  limitador não corrige volume excessivo nos fones.
                </p>
              </section>
            </div>
          ) : null}
        </Panel>
      </div>

      <aside className="studio-side">
        <Panel title="Saída" testId="studio-side-panel">
          <OutputSection studio={studio} />
          <LatencySection studio={studio} />
        </Panel>
      </aside>
    </div>
  );
}
