# Estúdio: ouvir a guitarra com efeitos, amplificador e gabinete

**Status: prova de conceito de monitoramento + estúdio mínimo. Som, latência e qualidade NÃO foram validados
com uma guitarra e uma interface reais.** Os testes automatizados provam que o grafo de áudio se comporta como
descrito (níveis, bypass, limite de saída), não que o som é bom nem que a latência é aceitável para tocar.

Aba **Estúdio**. O Rastreador, o Afinador e o detector não foram alterados: a aba só cria um ramo paralelo.

## Resumo honesto

| Pergunta | Resposta |
| --- | --- |
| Dá para tocar com isso? | **Não sabemos.** A latência de ida e volta não foi medida. No navegador (sem ASIO) ela tende a ser perceptível. Meça com o procedimento abaixo. |
| O amplificador é um modelo de equipamento real? | **Não.** É saturação por curva matemática + três filtros de tom. Os nomes (Limpo, Crunch, Alto ganho; Compacto, Grande) são neutros de propósito. |
| Os efeitos são de qualidade profissional? | Não se afirma isso. São implementações simples com nós nativos do Web Audio; a qualidade subjetiva não foi avaliada. |
| O detector recebe o som com efeitos? | **Não.** Recebe o sinal original (seco). |
| Algo é enviado para fora? | Não. Tudo roda no navegador. |
| Existe alternativa sem atraso? | Sim: o **monitoramento direto** da interface de áudio (ver abaixo). Ele não passa pelos efeitos. |

## Arquitetura

```
captura (inalterada)
  getUserMedia (eco/ruído/AGC desligados) -> MediaStreamSource -> AudioWorklet de captura -> detector (src/dsp)
                                                   |
                                                   +--> (ramo paralelo, só leitura da fonte) StudioEngine (src/fx)
```

* `src/fx/` não importa `src/dsp/` (nem inferência/tablatura) e `src/dsp/` não importa `src/fx/`. O teste
  `tests/unit/studio-boundary.test.ts` falha se isso mudar.
* Mesmo `AudioContext` da captura (um relógio só). Trocar de contexto adicionaria um segundo relógio e mais latência.
* `useStudio` (`src/hooks/useStudio.ts`) cria um `StudioEngine` por captura e o descarta ao parar, ao perder o
  dispositivo ou ao reiniciar. `useAudioCapture` só expõe `graph` (contexto + fonte), somente leitura.

### Cadeia de sinal

```
fonte -> [canal 1 | canal 2 | soma] -> ganho de entrada -> pedal (drive) -> EQ -> amplificador -> gabinete
      -> delay -> reverb -> volume geral -> limitador suave -> medidor -> porta de saída -> destino
```

Cada bloco (pedal, EQ, amplificador, gabinete) tem entrada seca e molhada: ligar/desligar é um **crossfade de ganho**
(constante de tempo de 10 ms), não uma troca brusca. Delay e reverb são desligados levando o mix a 0.
**Limitação:** blocos desligados continuam sendo calculados (o crossfade exige isso). O custo de CPU não cai ao
desligar um bloco; ele não foi medido.

## Segurança da saída

| Requisito | Como é atendido | Testado |
| --- | --- | --- |
| Saída desligada por padrão | A porta tem ganho 0 e a fonte nem está ligada ao grafo até `setOutputEnabled(true)`. O interruptor exige clique e fica bloqueado sem captura. A cada captura nova a saída recomeça desligada. | Unitário (motor e interface) e E2E |
| Volume inicial baixo | `masterDb = -18` | Unitário |
| Aviso de fones e realimentação | Aviso permanente na seção Saída | Unitário |
| Limitador | `WaveShaper` com curva sem memória: linear até 0,6 e, acima, tanh até o teto de **0,98**. Sem sobreamostragem de propósito (ela faria o sinal ultrapassar o teto ao voltar à taxa original). Não é um compressor: não há atraso nem "pumping". | Teste renderizado: com tudo no máximo e entrada em fundo de escala, o pico fica <= 0,98 |
| Suavização de parâmetros | `setTargetAtTime`, 10 ms | Teste de continuidade ao ligar um bloco |
| Realimentação do delay limitada | Máx. 0,85: o eco sempre decai | Teste renderizado, com valor fora da faixa |
| Eco/ruído/AGC do navegador desligados | Mantido da captura | E2E (existente) |
| Medidores com indicador de saturação | Entrada >= 0,99, saída >= 0,97 | Unitário |

O limitador **não protege os ouvidos**: ele evita estouro digital, mas um volume alto continua sendo alto. Comece baixo.

## Parâmetros (faixa e efeito)

| Bloco | Parâmetro | Faixa | Efeito |
| --- | --- | --- | --- |
| Entrada | Canal | 1, 2 ou soma | Canal ouvido; independente do canal do detector. Soma com um só canal ativo cai 6 dB |
| Entrada | Ganho de entrada | -20 a +20 dB | Antes de todos os efeitos. Mais ganho = mais saturação nos blocos seguintes |
| Pedal | Drive | 0 a 1 (0 a 30 dB) | Ganho antes da curva de saturação (tanh, dureza 2,2, leve assimetria) |
| Pedal | Tom | 0 a 1 (1,5 a 9 kHz) | Corte do passa-baixa depois da saturação |
| Pedal | Volume | 0 a 1 (-12 a +6 dB) | Nível depois da saturação |
| EQ | Graves / Médios / Agudos | -12 a +12 dB | Prateleira em 100 Hz / pico em 800 Hz (Q 0,9) / prateleira em 3 kHz |
| Amplificador | Voz | Limpo, Crunch, Alto ganho | Muda dureza e assimetria da curva e a faixa do ganho de entrada. Troca por crossfade entre três curvas fixas (um `WaveShaper` não aceita trocar a curva depois de definida) |
| Amplificador | Ganho | 0 a 1 | Ganho de entrada da voz: Limpo 0 a 12 dB, Crunch 6 a 24 dB, Alto ganho 14 a 36 dB |
| Amplificador | Graves / Médios / Agudos | 0 a 1 (0,5 = neutro; +-12 dB) | Prateleiras em 120 Hz e 3,2 kHz, pico em 700 Hz |
| Amplificador | Volume | 0 a 1 (-30 a 0 dB; 0 = mudo) | Nível de saída do bloco |
| Gabinete | Tamanho | Compacto (1x12), Grande (4x12) | Dois passa-baixas em série (declive ~24 dB/oitava) em ~5,4 kHz ou ~4,6 kHz, ressonância de graves e leve presença. **Não usa respostas de impulso de equipamentos reais** |
| Delay | Tempo | 40 a 1000 ms | Atraso do eco |
| Delay | Repetições | 0 a 0,85 | Realimentação |
| Delay | Mix | 0 a 1 | Quanto do eco entra |
| Reverb | Decaimento | 0,3 a 4 s | Duração da cauda (tempo para cair 60 dB). Gera nova resposta ao mudar |
| Reverb | Mix | 0 a 1 | Quanto do reverb entra |
| Saída | Volume geral | -40 a 0 dB | Antes do limitador |

Os valores das predefinições (Direto, Limpo com espaço, Crunch, Solo) são pontos de partida subjetivos. Trocar a
predefinição **não** altera o volume geral, o canal nem o ganho de entrada.

### Reverb

Convolução com uma resposta de impulso **sintética** gerada no navegador (`src/fx/reverb-ir.ts`): ruído gaussiano com
semente fixa, decaimento exponencial e um passa-baixa que escurece a cauda; energia normalizada. Não há arquivo de
terceiros nem sala real.

## Latência: o que se sabe e o que não se sabe

* A seção "Latência desta saída" mostra apenas `AudioContext.baseLatency` e `outputLatency`, rotuladas como
  **estimativas do navegador**. Elas não incluem o buffer da interface nem o driver e não são a latência real.
* **Nenhum valor de latência de ida e volta foi medido.** Por isso nenhum número aparece como resultado na interface
  nem aqui.
* O navegador não usa ASIO. No Windows ele passa pelo mixer do sistema (WASAPI compartilhado), o que costuma somar
  atraso. O resultado depende do navegador, do driver e do tamanho de buffer.
* Reaper com ASIO4ALL não é comparável com o navegador.

### Monitoramento direto (alternativa sem atraso)

Muitas interfaces de áudio (inclusive a M-Audio M-Track Duo) têm um controle de **monitoramento direto** (Direct
Monitor / mistura entrada-saída). O som da guitarra vai ao fone dentro da própria interface, com atraso zero. Ele
**não** passa por este aplicativo: não recebe os efeitos. Para tocar com o rastreador de notas, ele costuma ser a
melhor opção; o Estúdio serve para ouvir efeitos aceitando o atraso.

Se usar os dois ao mesmo tempo, você ouvirá a guitarra duas vezes (direta e atrasada). Desligue um deles.

### Como medir a latência de ida e volta (procedimento manual)

Ainda **não executado**. Anote os resultados na ficha de `docs/manual-validation.md` (caso 21).

1. Ligue uma saída da interface a uma entrada dela com um cabo (loopback). Use volume baixo; fones desconectados.
2. Inicie a captura, escolha o canal onde entra o cabo, abra o Estúdio e ligue a saída com o **tom de teste** (ou use um
   gerador externo que toque um estalo/clique).
3. Grave a entrada e a saída juntas num programa que veja as duas (por exemplo, um gravador na própria interface) ou
   use um osciloscópio de áudio. Meça o tempo entre o início do estalo na saída e o aparecimento na entrada.
4. Repita por navegador, taxa de amostragem e tamanho de buffer da interface, e várias vezes (anote mínimo, mediana e
   máximo).
5. Para medir só o caminho guitarra -> fone, repita com a guitarra no lugar do cabo e compare com o monitoramento direto.

## Ajuste automático por música

Na aba Estúdio, o usuário escolhe um arquivo de áudio **local** (MP3, WAV, OGG, M4A ou FLAC). O app mede o som do trecho
e **já aplica** os ajustes no amplificador, gabinete, drive e reverb. Há um botão "Desfazer ajuste automático" que
restaura os parâmetros anteriores.

### O que é e o que não é

* É uma **heurística escolhida à mão**. Os limiares **não foram calibrados com gravações reais** e o resultado **não foi
  validado com guitarra real**. Os testes só verificam a **direção** das respostas com sinais sintéticos (mais harmônicos
  agudos -> mais ganho; sinal mais brilhante -> mais agudos; queda lenta -> mais reverb).
* A medida é da **mistura inteira** (guitarra, baixo, bateria, voz). Não separa a guitarra. Não identifica a música, o
  equipamento nem o guitarrista. O resultado **não é o timbre do disco**; é um ponto de partida para ajustar de ouvido.
* O arquivo é decodificado e analisado no navegador. Não é enviado, gravado nem tocado.

### Por que não há link do YouTube

O navegador não tem acesso ao áudio de um vídeo do YouTube (ele é protegido e não há API para isso), e baixar o áudio
exigiria um servidor e violaria os termos do serviço. Um link isolado dá apenas o título e o canal, o que não informa
o timbre. Por isso a entrada é um arquivo que o usuário já possui.

### Limites de entrada

| Limite | Valor | Motivo |
|---|---|---|
| Tamanho do arquivo | 60 MB | decodificar vira PCM de 32 bits e usa muito mais memória |
| Trecho analisado | 120 s, a partir de 25% da duração se for mais longo | tempo e memória; evita a introdução |
| Duração mínima | 5 s | poucas notas para medir |
| Fração mínima ativa | 10% dos quadros acima de -50 dBFS | arquivo quase todo silêncio é recusado |

### Medidas (`src/fx/music-analysis.ts`, `ANALYSIS_PARAMS`)

| Medida | Como é calculada | Uso |
|---|---|---|
| `highMidDb` | 10 log10(energia 2-5 kHz / energia 250-2000 Hz), FFT de 2048 | proxy de saturação (mais harmônicos agudos) |
| `lowMidDb` | 10 log10(energia 80-250 Hz / energia 250-2000 Hz) | controle de graves |
| `centroidHz` | centróide espectral entre 80 Hz e 8 kHz | brilho -> agudos e tom do drive |
| `tFall10S` | mediana do tempo para o envelope cair 10 dB após um pico (até 1,5 s); nulo com menos de 8 picos | reverb; inconclusivo -> reverb desligado |
| `loudnessSpreadDb` | p95 - p50 do envelope nos quadros ativos | informativa, não usada nas regras |

Quadros mais de 30 dB abaixo do p95 ficam fora da medida do espectro (evita pausas e finais).
A queda de volume **não distingue reverb de sustentação natural** da guitarra; a interface diz isso.

### Regras (`src/fx/auto-config.ts`, `ANALYSIS_MAP`)

| Constante | Valor | Efeito |
|---|---|---|
| `gainFromDb` / `gainToDb` | -24 / -8 dB | `highMidDb` neste intervalo vira o índice de ganho 0..1 |
| `cleanBelow` / `crunchBelow` | 0,33 / 0,66 | índice abaixo de 0,33: voz Limpo + gabinete 1x12; abaixo de 0,66: Crunch + 4x12; senão Alto ganho + 4x12 |
| `driveAbove` | 0,85 | o pedal de drive só liga acima disto, como reforço leve |
| `brightFromHz` / `brightToHz` | 1200 / 3500 Hz | centróide vira brilho 0..1; controla agudos do amp e o tom do drive |
| `bassFromDb` / `bassToDb` | -10 / 5 dB | `lowMidDb` vira o controle de graves (0,35 a 0,65) |
| `fallDrySec` / `fallWetSec` | 0,15 / 1,0 s | queda abaixo de 0,15 s: sem reverb; 1,0 s ou mais: mix máximo |
| `reverbMaxMix` | 0,3 | teto do mix do reverb; abaixo de 0,05 o reverb fica desligado |

O ganho do amplificador é 0,25 + 0,6 x índice. Todos os valores são ajustáveis de ouvido depois.

### O que NÃO é alterado nem estimado

* **Nunca alterados:** saída ligada/desligada, volume geral, canal de entrada, ganho de entrada. A saída continua desligada.
* **Não estimados:** delay e equalizador (ficam desligados), pois não há medida confiável a partir da mistura.
* Os controles de mixer dependem da sua guitarra e da sua interface.

### Testes

`tests/unit/auto-config.test.tsx` (FFT, entradas inválidas, direção das medidas com sinais sintéticos, regras e interface
com decodificação simulada) e o caso E2E "ajuste automático" em `tests/e2e/capture.spec.ts` (envia um WAV gerado, confere
resultado, limites, saída desligada, desfazer e erro para arquivo que não é áudio).
## O que não está implementado

* Reordenar blocos, salvar/carregar predefinições, cadeia personalizada, carregar IRs do usuário.
* Pedais além de drive, EQ, delay e reverb (sem compressor, noise gate, chorus, fuzz, wah etc.).
* Detector recebendo o sinal com efeitos (por decisão, recebe o seco).
* Medição automática de latência, medição de CPU/queda de áudio, lista de navegadores suportados.
* Escolha de saída em navegadores sem `AudioContext.setSinkId`: a interface mostra "Indisponível neste navegador".
* Sobreamostragem configurável, AudioWorklet de efeitos (tudo usa nós nativos; nenhum WebAssembly).

## Testes

* `tests/unit/studio-engine.test.ts`: renderiza o motor de verdade (offline) com `node-web-audio-api` e confere
  níveis, bypass, limite, efeitos e canais. **Não** substitui ouvir.
* `tests/unit/studio-panel.test.tsx`: interface (saída desligada, avisos, controles, sem marcas).
* `tests/unit/studio-boundary.test.ts`: fronteira entre `src/fx` e `src/dsp`.
* `tests/e2e/capture.spec.ts` (caso do Estúdio): captura com o dispositivo falso do Chromium, saída desligada ->
  ligada por clique, medidor com sinal real, e saída bloqueada de novo após parar.

### Dependência de teste e problema encontrado

`node-web-audio-api` (BSD-3, apenas `devDependency`, nunca vai ao pacote do aplicativo) fornece um `AudioContext`
offline no Node. Ela é um binding nativo com **dois problemas conhecidos** que afetaram os testes:

1. `getChannelData()` devolve uma **visão da memória nativa** do buffer. Depois que o buffer é coletado pelo coletor
   de lixo, ler a visão devolve lixo ou derruba o processo (código de saída 3221225477 no Windows). Os testes copiam
   o resultado com `Float32Array.from(...)` na hora.
2. Uma `curve` de `WaveShaper` só pode ser atribuída uma vez (como na especificação).

Com a cópia imediata, 10 execuções seguidas do arquivo e 4 execuções da suíte inteira passaram sem falhas.
É uma limitação do binding de teste, não do aplicativo, que roda no motor de áudio do navegador.
