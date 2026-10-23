import { expect, test } from '@playwright/test';

/**
 * Estes testes usam o dispositivo de áudio FALSO do Chromium (bipe sintético).
 * Eles verificam só a ligação da interface com a captura (permissão, worklet,
 * medidor, parar). Não validam reconhecimento de notas nem uma guitarra real.
 */

test('layout completo é exibido sem dados inventados', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Guitar Tracker' })).toBeVisible();
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
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId('note-value')).toHaveText('—');
  await expect(page.getByTestId('connection-status')).toContainText('Captura parada');
});

test('iniciar captura, medidor reage ao sinal real e parar libera o dispositivo', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-btn').click();

  await expect(page.getByTestId('capture-active')).toBeVisible();
  await expect(page.getByTestId('connection-status')).toContainText('Captura ativa');
  await expect(page.getByTestId('capture-info')).toContainText('Taxa de amostragem');

  // O dispositivo falso emite bipes curtos e irregulares. Um observador de DOM registra o
  // maior valor do medidor, para não perder o bipe entre duas consultas.
  const maxLit = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const el = document.querySelector('[data-testid="level-meter"]')!;
        let max = Number(el.getAttribute('data-lit'));
        const obs = new MutationObserver(() => {
          max = Math.max(max, Number(el.getAttribute('data-lit')));
        });
        obs.observe(el, { attributes: true, attributeFilter: ['data-lit'] });
        setTimeout(() => {
          obs.disconnect();
          resolve(max);
        }, 12_000);
      }),
  );
  expect(maxLit).toBeGreaterThan(5);

  await page.getByTestId('stop-btn').click();
  await expect(page.getByTestId('start-btn')).toBeVisible();
  await expect(page.getByTestId('connection-status')).toContainText('Captura parada');
  await expect(page.getByTestId('level-meter')).toHaveAttribute('data-lit', '0');
  await expect(page.getByTestId('capture-active')).toHaveCount(0);
});

test('permissão negada mostra mensagem clara e instruções', async ({ browser }) => {
  const context = await browser.newContext({ permissions: [] });
  const page = await context.newPage();
  // Somente no teste: força a rejeição que o navegador devolve quando o usuário nega a permissão.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await page.goto('/');
  await page.getByTestId('start-btn').click();
  const err = page.getByTestId('audio-error');
  await expect(err).toContainText('Permissão de áudio negada');
  await expect(err).toContainText('cadeado');
  await expect(page.getByTestId('start-btn')).toContainText('Tentar novamente');
  await context.close();
});

test('dispositivo desconectado durante a captura encerra com orientação de reconexão', async ({ page }) => {
  // Somente no teste: guarda as trilhas para poder disparar o evento 'ended' que o navegador
  // dispara quando o hardware some. Isso testa a reação do app, não um USB real.
  await page.addInitScript(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const stream = await original(c);
      w.__tracks.push(...stream.getAudioTracks());
      return stream;
    };
  });
  await page.goto('/');
  await page.getByTestId('start-btn').click();
  await expect(page.getByTestId('capture-active')).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks.forEach((t) => t.dispatchEvent(new Event('ended')));
  });

  const err = page.getByTestId('audio-error');
  await expect(err).toContainText('Dispositivo desconectado');
  await expect(err).toContainText('cabo USB');
  await expect(page.getByTestId('connection-status')).toContainText('Erro de áudio');
  await expect(page.getByTestId('capture-active')).toHaveCount(0);
  await expect(page.getByTestId('start-btn')).toContainText('Tentar novamente');
});

test('motor de detecção roda sobre a captura: estatísticas, canais e troca de janela ao vivo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('start-btn').click();
  await expect(page.getByTestId('capture-active')).toBeVisible();

  // O cartão de tempo real só mostra valores medidos pelo motor (taxa de quadros de análise > 0).
  const latency = page.getByTestId('card-latency');
  await expect(latency).toContainText('Janela (4096)', { timeout: 10_000 });
  await expect(latency).toContainText('/quadro');
  await expect(latency).not.toContainText('NaN');
  await expect(page.getByTestId('channel-bars')).toBeVisible();

  // Troca de janela com a captura ativa recria o motor sem derrubar a captura.
  await page.getByTestId('window-size').getByRole('button', { name: '8192' }).click();
  await expect(latency).toContainText('Janela (8192)', { timeout: 10_000 });
  await page.getByTestId('window-size').getByRole('button', { name: '2048' }).click();
  await expect(latency).toContainText('Janela (2048)', { timeout: 10_000 });
  await expect(page.getByTestId('capture-active')).toBeVisible();

  // Mudança de canal ao vivo não encerra a captura.
  await page.getByTestId('channel-mode').getByRole('button', { name: 'Entrada 1' }).click();
  await page.getByTestId('channel-mode').getByRole('button', { name: 'Entrada 2' }).click();
  await expect(page.getByTestId('capture-active')).toBeVisible();

  await page.getByTestId('stop-btn').click();
  await expect(page.getByTestId('card-latency')).toContainText('Indisponível');
  expect(errors).toEqual([]);
});

test('braço: 24 casas por padrão, seletor de casas funciona e não há destaque sem nota', async ({ page }) => {
  await page.goto('/');
  const svg = page.getByTestId('fretboard-svg');
  await expect(svg).toHaveAttribute('data-fret-count', '24');
  await expect(page.getByTestId('fret-number')).toHaveCount(24);
  await expect(page.getByTestId('fret-marker')).toHaveCount(0);
  await expect(page.getByTestId('fret-summary')).toContainText('Sem nota em andamento');

  await page.getByTestId('fret-count').selectOption('12');
  await expect(svg).toHaveAttribute('data-fret-count', '12');
  await expect(page.getByTestId('fret-number')).toHaveCount(12);
  await page.getByTestId('fret-count').selectOption('22');
  await expect(page.getByTestId('fret-number')).toHaveCount(22);
});

test('região do braço: informada pelo usuário, rotulada e sem inventar detecção', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('region-note')).toContainText('braço inteiro');
  await expect(page.getByTestId('region-band')).toHaveCount(0);
  await page.getByTestId('region-switch').click();
  await expect(page.getByTestId('region-band')).toHaveCount(1);
  await expect(page.getByTestId('region-note')).toContainText('Não é detectado pelo áudio');
  await page.getByTestId('region-max').selectOption('7');
  await page.getByTestId('region-open').uncheck();
  await expect(page.getByTestId('region-note')).toContainText('casas 1 a 7, sem cordas soltas');
  await page.getByTestId('fret-count').selectOption('12');
  await expect(page.getByTestId('region-band')).toHaveCount(1);
  await page.getByTestId('region-switch').click();
  await expect(page.getByTestId('region-band')).toHaveCount(0);
  await expect(page.getByTestId('fret-marker')).toHaveCount(0);
});

test('afinador: aba, layout, mesmo dispositivo de captura e sem leitura inventada', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('tab-tuner').click();
  await expect(page.getByTestId('tuner-panel')).toBeVisible();
  await expect(page.getByTestId('tuner-steps').locator('article')).toHaveCount(4);
  await expect(page.getByTestId('tuner-note')).toHaveText('—');
  await expect(page.getByTestId('tuner-message')).toContainText('Inicie a captura');

  // O botão do afinador usa a mesma captura do restante do app.
  await page.getByTestId('tuner-start').click();
  await expect(page.getByTestId('tuner-stop')).toBeVisible();
  await expect(page.getByTestId('connection-status')).toContainText('Captura ativa');
  await expect(page.getByTestId('tuner-message')).not.toContainText('Inicie a captura');
  // As trocas de aba não derrubam a captura.
  await page.getByTestId('tab-tracker').click();
  await expect(page.getByTestId('capture-active')).toBeVisible();
  await page.getByTestId('tab-tuner').click();
  await page.getByTestId('tuner-stop').click();
  await expect(page.getByTestId('tuner-start')).toBeVisible();
  await expect(page.getByTestId('connection-status')).toContainText('Captura parada');
  expect(errors).toEqual([]);
});
test('posição: com o dispositivo falso a nota ao vivo recebe estimativa rotulada, nunca certeza', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  // Sem captura: nenhuma posição e o aviso permanente das sugestões.
  await expect(page.getByTestId('position-value')).toHaveText('—');
  await expect(page.getByTestId('suggestions-disclaimer')).toContainText(/não são probabilidades calibradas/i);

  // O bipe falso (~400 Hz, G4) é curto: um observador de DOM registra o que apareceu no cartão e nas
  // sugestões, sem perder a janela entre duas consultas. G4 tem várias posições, logo sem contexto é ambígua.
  const seen = page.evaluate(
    () =>
      new Promise<{ states: string[]; suggestions: number; confidenceText: string }>((resolve) => {
        const states = new Set<string>();
        let suggestions = 0;
        let confidenceText = '';
        const read = () => {
          const cur = document.querySelector('[data-testid="position-value"]');
          if (cur) states.add(cur.getAttribute('data-state') ?? '');
          suggestions = Math.max(suggestions, document.querySelectorAll('[data-testid="suggestion-item"]').length);
          const conf = document.querySelector('[data-testid="position-confidence"]');
          if (conf?.textContent?.includes('índice do algoritmo')) confidenceText = conf.textContent;
        };
        const obs = new MutationObserver(read);
        obs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        setTimeout(() => {
          obs.disconnect();
          resolve({ states: [...states], suggestions, confidenceText });
        }, 25_000);
      }),
  );
  await page.getByTestId('start-btn').click();
  const result = await seen;
  expect(result.states).toContain('ambiguous');
  expect(result.states.every((s) => ['none', 'ambiguous', 'confident', 'unique'].includes(s))).toBe(true);
  expect(result.suggestions).toBeGreaterThan(1);
  expect(result.confidenceText).toContain('índice do algoritmo');  // Alternativas azuis continuam ocultas até o usuário ligar o interruptor.
  await expect(page.locator('[data-testid="fret-marker"][data-variant="alternative"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('tablatura e histórico: notas reais do dispositivo falso são registradas, pausa e limpar funcionam', async ({ page }) => {
  test.setTimeout(75_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('tablature-svg')).toHaveAttribute('data-notes', '0');
  await expect(page.getByTestId('tab-empty')).toContainText('Inicie a captura');
  await expect(page.getByTestId('tab-pause')).toContainText('Pausar gravação');

  // O bipe é curto: um observador de DOM registra o maior número de notas visto na tablatura e no histórico.
  const seen = page.evaluate(
    () =>
      new Promise<{ notes: number; history: number; uncertain: number; manual: number }>((resolve) => {
        let notes = 0;
        let history = 0;
        let uncertain = 0;
        const read = () => {
          const svg = document.querySelector('[data-testid="tablature-svg"]');
          notes = Math.max(notes, Number(svg?.getAttribute('data-notes') ?? 0));
          history = Math.max(history, document.querySelectorAll('[data-testid="history-item"]').length);
          uncertain = Math.max(uncertain, document.querySelectorAll('[data-testid="tab-note"][data-uncertain="true"]').length);
        };
        const obs = new MutationObserver(read);
        obs.observe(document.body, { subtree: true, childList: true, attributes: true });
        setTimeout(() => {
          obs.disconnect();
          resolve({ notes, history, uncertain, manual: 0 });
        }, 30_000);
      }),
  );
  await page.getByTestId('start-btn').click();
  const result = await seen;
  expect(result.notes).toBeGreaterThan(0);
  expect(result.history).toBeGreaterThan(0);
  // G4 sem contexto tem várias posições: nunca aparece como estabelecida na primeira nota.
  expect(result.uncertain).toBeGreaterThan(0);

  // Pausar muda o rótulo; a captura continua ativa.
  await page.getByTestId('tab-pause').click();
  await expect(page.getByTestId('tab-pause')).toContainText('Retomar gravação');
  await expect(page.getByTestId('capture-active')).toBeVisible();

  // Se há uma nota registrada, abre a correção e escolhe outra posição.
  const first = page.getByTestId('tab-note').first();
  if ((await first.count()) > 0) {
    await first.click();
    await expect(page.getByTestId('tab-detail')).toContainText('não confirma a casa');
    const choices = page.getByTestId('tab-choice');
    if ((await choices.count()) > 1) {
      await choices.nth(1).click();
      await expect(page.getByTestId('tab-note').first()).toHaveAttribute('data-manual', 'true');
    }
  }

  await page.getByTestId('tab-clear').click();
  await expect(page.getByTestId('tablature-svg')).toHaveAttribute('data-notes', '0');
  await expect(page.getByTestId('history-item')).toHaveCount(0);
  await page.getByTestId('stop-btn').click();
  expect(errors).toEqual([]);
});
test('Estúdio: saída começa desligada, liga por ação explícita, mede o sinal real e volta a desligar ao parar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('tab-studio').click();
  // Sem captura: bloqueada.
  await expect(page.getByTestId('studio-output-switch')).toBeDisabled();
  await expect(page.getByTestId('studio-feedback-warning')).toBeVisible();

  await page.getByTestId('tab-tracker').click();
  await page.getByTestId('start-btn').click();
  await expect(page.getByTestId('capture-active')).toBeVisible();
  await page.getByTestId('tab-studio').click();

  // Com captura: liberada, mas ainda DESLIGADA (nada de som sem ação do usuário).
  const sw = page.getByTestId('studio-output-switch');
  await expect(sw).toBeEnabled();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('studio-output-state')).toContainText('Saída desligada');

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('studio-output-state')).toContainText('Saída LIGADA');
  await page.getByTestId('chain-reverb').click();

  // Medidores reais: o dispositivo falso emite bipes; o observador não perde o pico entre consultas.
  const maxIn = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const root = document.querySelector('[data-testid="studio-view"]')!;
        let max = 0;
        const read = () => {
          const el = root.querySelector('[data-testid="studio-meter-in"]');
          if (el) max = Math.max(max, Number(el.getAttribute('data-level')));
        };
        const obs = new MutationObserver(read);
        obs.observe(root, { attributes: true, subtree: true, attributeFilter: ['data-level'] });
        setTimeout(() => {
          obs.disconnect();
          resolve(max);
        }, 12_000);
      }),
  );
  expect(maxIn).toBeGreaterThan(0.3);

  // Parar a captura derruba o motor: a saída volta a ficar bloqueada e desligada.
  await page.getByTestId('tab-tracker').click();
  await page.getByTestId('stop-btn').click();
  await page.getByTestId('tab-studio').click();
  await expect(sw).toBeDisabled();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('studio-meters-off')).toBeVisible();

  // Nova captura: a saída recomeça desligada.
  await page.getByTestId('tab-tracker').click();
  await page.getByTestId('start-btn').click();
  await expect(page.getByTestId('capture-active')).toBeVisible();
  await page.getByTestId('tab-studio').click();
  await expect(sw).toBeEnabled();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(errors).toEqual([]);
});
function makeWav(seconds: number, sampleRate = 22050): Buffer {
  const n = seconds * sampleRate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-3 * (t % 1));
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * 196 * h * t) / h;
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s * env * 0.4)) * 32767), 44 + i * 2);
  }
  return buf;
}

test('Estúdio: ajuste automático por arquivo local aplica, informa os limites, não liga a saída e desfaz', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('tab-studio').click();
  await expect(page.getByTestId('auto-limits')).toHaveCount(0);

  await page.getByTestId('auto-file').setInputFiles({ name: 'teste.wav', mimeType: 'audio/wav', buffer: makeWav(10) });
  await expect(page.getByTestId('auto-result')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('auto-result')).toContainText('teste.wav');
  await expect(page.getByTestId('auto-limits')).toContainText('Estimativa, não o timbre do disco');

  // Nunca liga a saída por conta própria.
  await expect(page.getByTestId('studio-output-switch')).toHaveAttribute('aria-checked', 'false');

  await expect(page.getByTestId('auto-undo')).toBeEnabled();
  await page.getByTestId('auto-undo').click();
  await expect(page.getByTestId('auto-undo')).toBeDisabled();

  // Arquivo que não é áudio: mensagem clara, sem quebrar.
  await page.getByTestId('auto-file').setInputFiles({ name: 'x.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('nao e audio') });
  await expect(page.getByTestId('auto-error')).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});
test('Estúdio: portão de ruído liga, mostra o estado real e a medida de ruído responde com resultado ou mensagem clara', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('tab-studio').click();
  await expect(page.getByTestId('gate-switch')).toHaveAttribute('aria-checked', 'false');
  // Sem a saída ligada a medida é recusada com instrução, sem alterar nada.
  await page.getByTestId('noise-measure-btn').click();
  await expect(page.getByTestId('noise-measure-error')).toContainText('Ligue a saída');

  await page.getByTestId('tab-tracker').click();
  await page.getByTestId('start-btn').click();
  await expect(page.getByTestId('capture-active')).toBeVisible();
  await page.getByTestId('tab-studio').click();
  await page.getByTestId('studio-output-switch').click();
  await page.getByTestId('gate-switch').click();
  await expect(page.getByTestId('gate-switch')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('studio-gate-state')).toBeVisible();

  // O dispositivo falso emite bipes: a medida deve terminar com limiar ou com recusa explicada (nunca ficar pendurada).
  await page.getByTestId('noise-measure-btn').click();
  await expect(page.getByTestId('noise-measure-btn')).toBeEnabled({ timeout: 8_000 });
  const result = await page.getByTestId('noise-measure-result').count();
  const error = await page.getByTestId('noise-measure-error').count();
  expect(result + error).toBe(1);
  expect(errors).toEqual([]);
});
test('Estúdio: medidor de loopback recusa com a saída ligada e, sem cabo, termina com mensagem clara e sem número', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('tab-studio').click();
  await expect(page.getByTestId('loopback-btn')).toBeDisabled();

  await page.getByTestId('tab-tracker').click();
  await page.getByTestId('start-btn').click();
  await expect(page.getByTestId('capture-active')).toBeVisible();
  await page.getByTestId('tab-studio').click();

  // Saída ligada: recusa (evita realimentação).
  await page.getByTestId('studio-output-switch').click();
  await page.getByTestId('loopback-btn').click();
  await expect(page.getByTestId('loopback-error')).toContainText('Desligue a saída');

  // Saída desligada e SEM cabo: o dispositivo falso não recebe os cliques, então nada pode ser medido como latência real.
  await page.getByTestId('studio-output-switch').click();
  await page.getByTestId('loopback-btn').click();
  await expect(page.getByTestId('loopback-btn')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId('loopback-result')).toHaveCount(0);
  await expect(page.getByTestId('loopback-error')).toBeVisible();
  expect(errors).toEqual([]);
});
