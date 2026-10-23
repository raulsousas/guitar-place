# Guitar Tracker

Rastreador de notas de guitarra em tempo real, executado inteiramente no navegador.

> **Estado atual: Fase 3 de 6.** Captura real, detector de notas (MPM), cartões de nota, e o braço
> virtual com o mapeamento matemático nota → corda/casa (todas as posições compatíveis, **sem
> ranking**). A inferência da posição, a tablatura e o histórico ainda **não existem** e aparecem
> como "Em desenvolvimento".
> **O reconhecimento NÃO foi validado com uma guitarra real**: os testes usam sinais sintéticos.
> Veja [`docs/manual-validation.md`](docs/manual-validation.md).

## Requisitos

- Node.js 20 ou superior e npm.
- Um navegador com `getUserMedia` e `AudioWorklet` (Chrome, Edge ou Firefox recentes).
- Servir a página por `http://localhost` ou HTTPS (exigência do navegador para acessar o áudio).

## Como executar

```bash
npm install
npm run dev          # servidor de desenvolvimento
npm run build        # typecheck + build de produção (dist/)
npm run preview      # serve o build de produção
```

Para o teste com a interface de áudio, abra a página, escolha a entrada e clique em **Iniciar**.
O navegador pedirá permissão para o áudio.

**Windows com Reaper e ASIO4ALL:** o navegador captura por WASAPI, não por ASIO, e o ASIO4ALL pode
reservar a interface em modo exclusivo. Para o primeiro teste, feche o Reaper. Detalhes e
alternativas em [`docs/windows-audio-setup.md`](docs/windows-audio-setup.md).

## Como testar

```bash
npm run typecheck    # tsc -b --noEmit
npm run lint         # eslint
npm test             # Vitest (unitários; inclui o detector nas 3 janelas)
npm run test:e2e     # Playwright (faz o build e sobe o preview sozinho)
npm run bench        # benchmark do detector com sinais sintéticos (gera docs/benchmark-results.json)
```

Na primeira vez: `npx playwright install chromium`.

Os testes E2E usam o dispositivo de áudio **falso** do Chromium
(`--use-fake-device-for-media-stream`). Eles provam que a interface está ligada à captura
(permissão, worklet, medidor, parar, erros), mas **não** provam reconhecimento de notas nem o
comportamento com uma guitarra real. Para isso, veja
[`docs/manual-validation.md`](docs/manual-validation.md).

## Privacidade

- O áudio é processado apenas no navegador. Nada é gravado, armazenado ou enviado.
- O worklet envia blocos de 10 ms (mono) à thread principal apenas para a análise em memória;
  os blocos são descartados após o processamento. Nada é gravado, armazenado ou enviado.
- A permissão do navegador é solicitada ao clicar em Iniciar. Parar encerra a captura e libera
  o dispositivo imediatamente.
- Não há serviços externos nem CDN; a fonte (Inter) é empacotada com o aplicativo.

## Estrutura

```
src/audio/       dispositivos, sessão de captura, worklet, EngineHost (latência/estatísticas), erros
src/dsp/         filtros, MPM, YIN (referência), rastreador de notas, PitchEngine
src/music/       notas, frequências, afinação, mapa nota -> corda/casa (fretmap.ts) e lógica do afinador (tuner.ts)
src/inference/   inferência de corda/casa (Etapa B): pontuação, contexto e estados (docs/inference.md)
src/fretboard/   geometria e layout (coordenadas) do braço, funções puras
src/tablature/   (Fase 5b) registro de eventos, pausas, durações aproximadas e exportação ASCII
src/fx/          (Estúdio) efeitos, amplificador, gabinete e saída de áudio; NÃO importa src/dsp (docs/studio.md)
src/components/  componentes de interface (FretboardSvg é renderização pura)
src/hooks/       ligação entre a interface e o motor de áudio
src/types/       tipos compartilhados
tests/unit/      Vitest (detector por janela, rastreador, música, mapa de casas, interface)
tests/bench/     benchmark do detector e diagnóstico no navegador
tests/e2e/       Playwright
docs/            documentação técnica (detection.md, performance.md, ...)
```

O plano completo de fases está em [`guitar-tracker-plan.md`](guitar-tracker-plan.md).

## Decisões da Fase 1

- **Processamento do navegador desligado.** `echoCancellation`, `noiseSuppression` e
  `autoGainControl` começam desligados: são filtros pensados para voz, alteram a forma de onda e
  prejudicam a estimativa de altura. O painel mostra o que o navegador reporta ter aplicado, pois
  ele pode ignorar o pedido.
- **Duas confianças separadas.** A confiança da nota (altura) e a da posição (corda e casa) são
  campos independentes na interface. Identificar a nota corretamente não significa ter
  identificado a posição física.
- **Latência.** A "latência base do contexto" exibida é a do `AudioContext`, não a latência de
  detecção. A latência de detecção será medida na Fase 2 e documentada separadamente da taxa de
  atualização visual.

## Decisões da Fase 2

- **MPM como algoritmo principal**, com YIN de referência. Todos os parâmetros têm efeito e custo
  documentados em [`docs/detection.md`](docs/detection.md).
- **Janela configurável** (2048, 4096, 8192): precisão e latência medidas por janela, com o E2
  destacado. A troca é feita ao vivo, recriando o motor.
- **Duas medidas de tempo separadas:** janela estrutural (tempo para encher a janela) e latência
  medida da nota (ataque estimado até o evento, mais entrega do worklet e CPU). Nenhuma inclui o
  hardware, o driver ou o WASAPI, que o navegador não expõe.
- **Canal de entrada selecionável** (Entrada 1, Entrada 2 ou Soma) com barras de nível por canal,
  para interfaces estéreo como a M-Track Duo.
- **Arquitetura simples primeiro:** o worklet transfere blocos Float32 e o detector roda fora da
  thread de áudio. As medições em [`docs/performance.md`](docs/performance.md) não mostram
  necessidade de mudar.

## Decisões da Fase 3

- **Etapa B dividida em duas partes.** A Fase 3 faz só a parte matemática:
  `getPositionsForMidi` (`src/music/fretmap.ts`) devolve TODAS as posições que produzem a nota, na
  ordem das cordas, sem preferência. Classificar as candidatas é a Fase 4.
- **Cores honestas.** Verde só aparece quando a nota tem uma única posição possível no braço
  (por exemplo E2 na 6ª corda solta). As demais posições compatíveis (azul) ficam **ocultas por
  padrão** e só aparecem se o usuário ativar "Mostrar outras posições" no cabeçalho do braço. Nada é
  apresentado como "a posição tocada" antes da inferência.
- **Afinação como dado.** Braço, mapa e testes recebem a afinação como parâmetro (testado com Drop D).
  A interface ainda só oferece a afinação padrão.
- **Casas configuráveis:** 12, 21, 22 ou 24 (padrão 24). A numeração das casas 22 a 24 fica
  apertada no braço de 24 casas; é uma limitação visual conhecida.
- **Renderização pura:** `FretboardSvg` recebe afinação, número de casas e marcadores; não conhece áudio.

## Decodificador de sequência (Fase 5a)

A posição de cada nota deixou de ser decidida isoladamente. Um decodificador (beam search) avalia as últimas notas
em conjunto e pode REVISAR uma nota anterior quando as seguintes combinam melhor com outra posição; o painel do
braço avisa "Posição revisada". A região declarada passou a ser uma preferência forte, e não um filtro: se a melhor
estimativa fica fora dela, a interface avisa. Isso não resolve uma nota isolada nem a primeira após uma pausa:
continuam "ambíguas". Números medidos (sintéticos) e limites em [`docs/inference.md`](docs/inference.md).
## Tablatura e histórico (Fase 5b)

A tablatura registra cada ataque uma vez (sustentação não repete; reataques viram entradas separadas), insere pausas
e mostra durações aproximadas. Posições incertas aparecem tracejadas e com "?"; clicar numa nota abre as candidatas
e permite **corrigir** a posição, o que entra no decodificador como evidência forte. Há pausar gravação, limpar,
seletor de últimas notas e exportação ASCII (copiar / baixar .txt, tudo local). Regras, parâmetros e limites em
[`docs/tablature.md`](docs/tablature.md).

## Região do braço (informada pelo usuário)

O áudio não separa, por exemplo, a 3ª corda solta da 4ª corda casa 5 (mesma altura). Para esses casos há o
interruptor "Informar região do braço" sob o braço: você declara as casas (e se as cordas soltas entram) e só
essas posições concorrem. É uma informação sua, rotulada como tal, e não uma detecção. Detalhes e limites em
[`docs/inference.md`](docs/inference.md).

## Decisões da Fase 4

- **Duas etapas independentes.** A nota (Etapa A) vem do detector; a posição (Etapa B) vem de
  `src/inference/`, que só recebe eventos de nota. Parâmetros, pesos e estados em
  [`docs/inference.md`](docs/inference.md).
- **Estimativa, nunca confirmação.** O braço mostra a melhor estimativa: verde sólido quando a posição é
  única ou inferida com contexto e margem; verde claro **tracejado** e rótulo "Ambígua" quando não há contexto
  (primeira nota, pausa longa) ou as candidatas estão próximas. As demais posições (azul) só aparecem com o
  interruptor "Mostrar outras posições".
- **Duas confianças separadas.** "Confiança da nota" (qualidade da altura) e "Confiança da posição" (índice do
  algoritmo, com teto de 0,9; não é probabilidade) são campos independentes.
- **Pontuações no painel de sugestões** são estimativas relativas, com aviso permanente.
- **Sem reavaliação do passado** e **sem calibração com guitarra real**: ver as limitações em `docs/inference.md`.

## Afinador (recurso extra)

Aba "Afinador", ao lado de "Rastreador". Usa **a mesma captura e o mesmo detector** (nada de segundo
microfone nem de segundo motor); a barra lateral de áudio continua valendo para as duas abas.
A lógica fica em `src/music/tuner.ts` (funções puras, testadas sem interface) e a tela em
`src/components/TunerPanel.tsx`.

| Parâmetro | Valor | Efeito |
| --- | --- | --- |
| Afinada | dentro de +-5 cents | Abaixo disso o desvio é difícil de ouvir; o ponteiro e a nota ficam verdes |
| Suavização | mediana de 5 leituras | Reduz saltos; custa cerca de 2 leituras de atraso visual |
| Retenção | 600 ms | Mantém a última leitura enquanto a corda decai, para dar tempo de ler |
| Clareza mínima | 0,80 | Leituras menos periódicas não entram no afinador |
| Reinício por salto | 0,6 semitom | Mudança grande de altura descarta a mediana anterior (troca de corda) |
| Dica de corda | até 150 cents | Sugere a corda solta mais próxima **só pela altura** |

Limites:

- O afinador **herda o portão de silêncio e a clareza do detector**. Uma corda muito fraca (por
  exemplo a 6ª tocada suavemente) pode não aparecer nele, como não aparece no rastreador. O painel de
  áudio mostra a linha "Portão de silêncio" para diagnosticar isso.
- A dica "corda mais próxima" não identifica a corda tocada: o áudio só informa a altura.
- A janela de análise influencia a estabilidade e a latência da leitura (ver `docs/detection.md`).
- Não foi validado com guitarra real; ver caso 18 em `docs/manual-validation.md`.

## Estúdio (ouvir a guitarra com efeitos)

Aba **Estúdio**: pedal de drive, equalizador, amplificador, gabinete, delay e reverb, mixer e saída de áudio
com escolha do dispositivo. É uma prova de conceito de monitoramento com um estúdio mínimo; o Rastreador e o
detector **não foram alterados** (o detector recebe sempre o sinal original, sem efeitos).

- **A saída começa desligada** e só liga por clique, com a captura ativa. Volume inicial -18 dB, limitador
  (teto 0,98) e aviso de fones/realimentação.
- **Latência não medida.** O navegador não usa ASIO; o atraso pode ser perceptível. A interface só mostra o que o
  navegador reporta, rotulado como estimativa. Para tocar sem atraso, use o monitoramento direto da interface de
  áudio (ele não passa pelos efeitos). Procedimento de medição em `docs/studio.md`.
- Amplificador e gabinete são **aproximações simples** (saturação matemática e filtros), sem nomes nem modelos de
  equipamentos reais. Licenças e origem em `docs/licenses.md`.
- **Som, latência e qualidade não foram validados com guitarra real** (caso 21 em `docs/manual-validation.md`).
- **Latência de ida e volta:** medidor por loopback (cabo da saída da interface para uma entrada) na aba Estúdio. A análise foi validada com
  atrasos sintéticos conhecidos; **nenhuma medição real do seu equipamento foi registrada ainda** (caso 24). Ver `docs/studio.md`.
- **Chiado com drive/ganho alto:** portão de ruído (com botão "Medir ruído de fundo") e filtros contra chiado agudo e "lixa". Medido só com
  sinais sintéticos: fecha o ruído entre notas, mas corta o fim das notas mais cedo e soma 5 ms de atraso enquanto ligado. Não validado com guitarra
  real (caso 23). Detalhes e parâmetros em `docs/studio.md`.
- **Ajuste automático por música:** escolha um arquivo de áudio local e o Estúdio se configura (amp, gabinete, drive, reverb).
  É uma heurística não calibrada, mede a mistura inteira (não só a guitarra) e não funciona com links do YouTube.
  Nunca altera saída, volume geral, canal nem ganho de entrada, e tem botão de desfazer. Ver `docs/studio.md` e caso 22.

## O que ainda não funciona

| Item | Fase |
| --- | --- |
| Validação do reconhecimento com guitarra real (checklist ainda não executada) | manual |
| Validação da inferência de posição com guitarra real (heurística calibrada só com sinais sintéticos) | manual |
| Tablatura em notação rítmica (andamento/compasso) e importação | não planejado |
| Coleta de timbre e calibração por corda | 5c / 6 |
| Estúdio: validação de som e medição de latência com guitarra real; reordenar blocos; salvar predefinições; IRs do usuário; mais pedais | manual / futuro |
| Painel de configurações e afinações alternativas | 6 |
