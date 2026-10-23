import type { AudioError, AudioErrorKind } from '../types/audio';

const DESCRIPTIONS: Record<AudioErrorKind, AudioError> = {
  unsupported: {
    kind: 'unsupported',
    title: 'Captura de áudio indisponível',
    message:
      'Este navegador ou contexto não oferece acesso ao áudio (getUserMedia / AudioWorklet).',
    instructions: [
      'Use uma versão recente do Chrome, Edge ou Firefox.',
      'Abra o aplicativo em http://localhost ou em uma página HTTPS.',
    ],
  },
  'permission-denied': {
    kind: 'permission-denied',
    title: 'Permissão de áudio negada',
    message: 'O navegador bloqueou o acesso ao dispositivo de entrada de áudio.',
    instructions: [
      'Clique no ícone de cadeado ao lado do endereço e permita o microfone para este site.',
      'Verifique também as configurações de privacidade do sistema operacional.',
      'Depois, clique em Tentar novamente.',
    ],
  },
  'no-devices': {
    kind: 'no-devices',
    title: 'Nenhum dispositivo de entrada encontrado',
    message: 'O navegador não listou nenhuma entrada de áudio.',
    instructions: [
      'Conecte a interface de áudio USB e aguarde o sistema reconhecê-la.',
      'Confirme que o cabo e a porta USB estão funcionando.',
      'A lista é atualizada sozinha quando um dispositivo for conectado.',
    ],
  },
  'device-not-found': {
    kind: 'device-not-found',
    title: 'Dispositivo selecionado não encontrado',
    message: 'A entrada escolhida não está mais disponível.',
    instructions: [
      'Reconecte a interface de áudio ou escolha outra entrada na lista.',
      'Clique em Iniciar para tentar novamente.',
    ],
  },
  'device-busy': {
    kind: 'device-busy',
    title: 'Não foi possível abrir o dispositivo',
    message: 'O dispositivo pode estar em uso por outro programa ou sofreu uma falha ao ser aberto.',
    instructions: [
      'Feche outros programas de áudio que usem a interface (DAW, gravadores, chamadas de vídeo).',
      'Se o Reaper estiver aberto com ASIO4ALL, ele pode ter reservado a interface em modo exclusivo. O navegador não usa ASIO. Feche o Reaper ou libere o driver ASIO e tente novamente.',
      'Desconecte e reconecte o cabo USB, e tente novamente.',
    ],
  },
  'device-disconnected': {
    kind: 'device-disconnected',
    title: 'Dispositivo desconectado',
    message: 'A entrada de áudio foi interrompida durante a captura. A captura foi encerrada.',
    instructions: [
      'Verifique o cabo USB e reconecte a interface de áudio.',
      'Aguarde o dispositivo reaparecer na lista e clique em Iniciar.',
    ],
  },
  'context-suspended': {
    kind: 'context-suspended',
    title: 'Processamento de áudio suspenso',
    message: 'O navegador suspendeu o processamento de áudio.',
    instructions: ['Clique em Retomar. Se persistir, pare e inicie a captura novamente.'],
  },
  'worklet-failed': {
    kind: 'worklet-failed',
    title: 'Falha ao carregar o processador de áudio',
    message: 'O módulo AudioWorklet não pôde ser carregado.',
    instructions: [
      'Recarregue a página.',
      'Se estiver usando um build local, confirme que os arquivos foram servidos por HTTP(S).',
    ],
  },
  unknown: {
    kind: 'unknown',
    title: 'Erro inesperado na captura de áudio',
    message: 'Ocorreu uma falha não prevista ao acessar o áudio.',
    instructions: ['Tente novamente. Se persistir, recarregue a página e reconecte o dispositivo.'],
  },
};

export function describeAudioError(kind: AudioErrorKind, detail?: string): AudioError {
  const base = DESCRIPTIONS[kind];
  return detail ? { ...base, message: `${base.message} (${detail})` } : { ...base };
}

/** Erro lançado pela camada de captura já classificado. */
export class AudioCaptureError extends Error {
  readonly detail: AudioError;

  constructor(kind: AudioErrorKind, technical?: string) {
    const detail = describeAudioError(kind, technical);
    super(detail.title);
    this.name = 'AudioCaptureError';
    this.detail = detail;
  }
}

function errorName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e) {
    return String((e as { name: unknown }).name);
  }
  return '';
}

function errorMessage(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = String((e as { message: unknown }).message);
    return m.length > 0 ? m : undefined;
  }
  return undefined;
}

/** Traduz exceções de getUserMedia / AudioContext em um erro apresentável. */
export function mapCaptureError(e: unknown): AudioError {
  if (e instanceof AudioCaptureError) return e.detail;

  const technical = errorMessage(e);
  switch (errorName(e)) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return describeAudioError('permission-denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return describeAudioError('device-not-found');
    case 'NotReadableError':
    case 'AbortError':
    case 'TrackStartError':
      return describeAudioError('device-busy', technical);
    default:
      return describeAudioError('unknown', technical);
  }
}
