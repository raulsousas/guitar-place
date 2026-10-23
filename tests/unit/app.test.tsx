import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../src/App';

// jsdom não implementa getUserMedia/AudioWorklet: o app deve declarar isso, não simular áudio.
describe('App sem suporte a captura', () => {
  it('mostra o layout completo e a mensagem de captura indisponível', () => {
    render(<App />);
    expect(screen.getByText('Guitar Tracker')).toBeInTheDocument();
    expect(screen.getByText('Rastreador de notas da guitarra em tempo real')).toBeInTheDocument();
    for (const id of [
      'audio-panel',
      'tuning-panel',
      'card-note',
      'card-position',
      'card-confidence',
      'card-latency',
      'fretboard-panel',
      'tablature-panel',
      'history-panel',
      'suggestions-panel',
      'tips-panel',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId('audio-error')).toHaveTextContent('Captura de áudio indisponível');
    expect(screen.getByTestId('start-btn')).toBeDisabled();
  });

  it('não exibe nota, histórico ou posição inventados', () => {
    render(<App />);
    expect(screen.getByTestId('note-value')).toHaveTextContent('—');
    expect(screen.getAllByTestId('unavailable').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId('tablature-svg')).toBeInTheDocument();
    expect(screen.queryByText(/F4|Fá \(/)).not.toBeInTheDocument();
  });

  it('as duas confianças são campos separados', () => {
    render(<App />);
    expect(screen.getByTestId('card-confidence')).toHaveTextContent(/Não vale para a posição/i);
    expect(screen.getByTestId('card-position')).toHaveTextContent(/Confiança da posição/i);
  });

  it('controles do detector estão presentes e sem a marcação de fase futura', () => {
    render(<App />);
    expect(screen.getByTestId('channel-mode')).toBeInTheDocument();
    expect(screen.getByTestId('window-size')).toHaveTextContent('2048');
    expect(screen.getByTestId('window-size')).toHaveTextContent('8192');
    expect(screen.getByTestId('detector-filter-switch')).toBeInTheDocument();
    expect(screen.getByTestId('audio-panel')).not.toHaveTextContent(/Fase 2/);
    expect(screen.getByTestId('card-latency')).toHaveTextContent(/Indisponível/);
  });

  it('a tabela de afinação exibe valores reais', () => {
    render(<App />);
    const table = screen.getByTestId('tuning-table');
    expect(table).toHaveTextContent('E2');
    expect(table).toHaveTextContent('82,41 Hz');
    expect(table).toHaveTextContent('329,63 Hz');
    vi.restoreAllMocks();
  });
});
