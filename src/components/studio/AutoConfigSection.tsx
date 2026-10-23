import { useId, useRef, useState } from 'react';
import { DecodeError, decodeAudioFile, MAX_ANALYZED_S, MAX_FILE_BYTES, type DecodedAudio } from '../../audio/decode-file';
import { configFromAnalysis, type AutoConfigResult } from '../../fx/auto-config';
import { analyzeMusic } from '../../fx/music-analysis';
import type { StudioApi } from '../../hooks/useStudio';
import { AlertIcon, InfoIcon } from '../icons';

type State =
  | { kind: 'idle' }
  | { kind: 'working'; name: string }
  | { kind: 'done'; name: string; durationS: number; result: AutoConfigResult }
  | { kind: 'error'; message: string };

const REASONS = {
  'too-short': 'O trecho é curto demais (mínimo de 5 s) para medir o som.',
  'mostly-silent': 'O arquivo é quase todo silêncio. Escolha um trecho com a música tocando.',
  invalid: 'O áudio decodificado é inválido.',
} as const;

function decodeMessage(e: unknown): string {
  if (e instanceof DecodeError) {
    if (e.kind === 'too-large') return `Arquivo grande demais (máximo ${MAX_FILE_BYTES / 1024 / 1024} MB). Use um trecho menor.`;
    if (e.kind === 'unsupported') return 'Este navegador não consegue decodificar áudio localmente.';
    return 'Não foi possível ler este arquivo como áudio. Use MP3, WAV, OGG, M4A ou FLAC.';
  }
  return 'Falha inesperada ao analisar o arquivo.';
}

const yield$ = () => new Promise<void>((r) => setTimeout(r, 0));

interface Props {
  studio: StudioApi;
  /** Troca da decodificação, só para testes (o jsdom não decodifica áudio). */
  decode?: (file: File) => Promise<DecodedAudio>;
}

/**
 * Ajuste automático por música: o usuário escolhe um arquivo de áudio LOCAL; o app mede o som e já aplica os
 * ajustes. O arquivo é lido e decodificado no navegador, não é enviado, gravado nem tocado.
 */
export function AutoConfigSection({ studio, decode = decodeAudioFile }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const onFile = async (file: File) => {
    setState({ kind: 'working', name: file.name });
    try {
      const audio = await decode(file);
      await yield$(); // deixa o "Analisando" aparecer antes do cálculo na thread principal
      const analysis = analyzeMusic(audio.samples, audio.sampleRate);
      if (!analysis.ok) {
        setState({ kind: 'error', message: REASONS[analysis.reason] });
        return;
      }
      const result = configFromAnalysis(analysis, studio.params);
      studio.applyAuto(result.params);
      setState({ kind: 'done', name: file.name, durationS: audio.durationS, result });
    } catch (e) {
      setState({ kind: 'error', message: decodeMessage(e) });
    }
  };

  const working = state.kind === 'working';
  return (
    <section className="auto-config" aria-labelledby={`${id}-t`} data-testid="auto-config">
      <h3 id={`${id}-t`} className="section-title">
        Ajuste automático por música
      </h3>
      <p className="note-small">
        Escolha um arquivo de áudio da música (no seu computador). O Estúdio mede o som e já se configura. O arquivo é analisado
        aqui no navegador: não é enviado, gravado nem tocado. Links do YouTube não funcionam: o navegador não acessa o áudio deles.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Arquivo de áudio da música"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onFile(f);
        }}
        data-testid="auto-file"
      />
      <button type="button" className="btn secondary" disabled={working} onClick={() => inputRef.current?.click()} data-testid="auto-pick">
        {working ? 'Analisando…' : 'Escolher arquivo e configurar'}
      </button>
      <p className="note-small">Analisa até {MAX_ANALYZED_S} s (a partir de 25% da música, se for mais longa).</p>

      {state.kind === 'error' ? (
        <p className="meter-warn" role="alert" data-testid="auto-error">
          <AlertIcon size={13} /> {state.message}
        </p>
      ) : null}

      {state.kind === 'done' ? (
        <div className="auto-result" role="status" data-testid="auto-result">
          <p>
            <b>Configurado a partir de:</b> {state.name} ({state.durationS.toFixed(0)} s analisados). Os ajustes já foram aplicados.
          </p>
          <ul>
            {state.result.notes.map((n) => (
              <li key={n.control}>
                <b>{n.control}:</b> {n.value}. <span className="why">{n.why}.</span>
              </li>
            ))}
          </ul>
          <div className="info-box" data-testid="auto-limits">
            <InfoIcon size={16} />
            <span>
              <b>Estimativa, não o timbre do disco.</b> A medida é da música inteira (guitarra, baixo, bateria e voz), as regras não foram
              calibradas com gravações reais e o resultado não foi validado com sua guitarra. Ajuste de ouvido.
              <br />
              {state.result.notEstimated.map((t) => (
                <span key={t} className="line">
                  {t}
                </span>
              ))}
            </span>
          </div>
          <button type="button" className="btn secondary" disabled={!studio.canUndoAuto} onClick={studio.undoAuto} data-testid="auto-undo">
            Desfazer ajuste automático
          </button>
        </div>
      ) : null}
    </section>
  );
}
