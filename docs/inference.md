# Inferência de posição (Etapa B)

A Etapa A (detector) diz **qual nota** foi tocada. A Etapa B (`src/inference/`) estima **em qual corda e casa**.
O áudio de uma guitarra tocada por vez informa a altura, não o dedo: a mesma nota existe em várias posições.
Por isso o resultado é sempre uma **estimativa**, nunca uma confirmação física.

Os parâmetros abaixo são heurísticos. Foram ajustados observando sequências sintéticas (escalas em posição
aberta, quinta posição e 12ª casa, saltos, notas repetidas) e **não foram calibrados com guitarra real**.

## Estrutura

| Arquivo | Papel |
| --- | --- |
| `src/types/position.ts` | Tipos: `PositionInference`, `PositionCandidate`, `PositionState`, `ExternalEvidence` |
| `src/inference/config.ts` | `InferenceConfig` e valores padrão (todos documentados abaixo) |
| `src/inference/position.ts` | `rankPositions` (função pura), `PositionInferrer` (contexto sequencial), `inferenceForLiveNote` |

A inferência recebe só eventos de nota (`midi`, `onsetTime`). Não conhece DSP nem interface.

## Candidatas e pontuação

As candidatas são exatamente as posições geométricas de `getPositionsForMidi`. A pontuação de cada uma é a
média ponderada dos fatores **aplicáveis**; um fator sem informação (`score: null`) sai da média em vez de
valer zero.

| Fator | Peso | O que mede | Efeito de aumentar o peso |
| --- | --- | --- | --- |
| `handShift` (deslocamento da mão) | 0,45 | Distância da casa candidata ao centro da mão nas notas recentes, perdoada pelo tempo entre ataques. Corda solta recebe 0,6 (neutra) | Mais inércia da mão; erra mais em saltos legítimos |
| `stringCohesion` (coesão de corda) | 0,25 | `exp(-distância em cordas / 1,5)` em relação às cordas recentes | Frases tendem a ficar na mesma corda |
| `region` (região) | 0,15 | Prior fraco que favorece casas baixas: `1 - 0,5 * casa / nCasas` | Mais viés para as primeiras casas; é o único fator sem contexto |
| `external` (evidência externa) | 0,6 | Sensor, visão ou correção manual (`ExternalEvidence`) | Dá mais peso à fonte externa. Hoje nenhuma existe |

A **proximidade não é favorecida por padrão**: ela é só o fator `handShift`, e só entra com contexto.

### Contexto

- Janela das **5** últimas notas posicionadas, com decaimento **0,6** por nota mais antiga.
- Contexto vencido: sem notas por mais de **4000 ms**, o histórico é descartado (volta a "sem contexto").
- Nota anterior cuja posição foi ambígua entra no contexto com peso **0,5**, para um palpite fraco não virar certeza.
- Alcance da mão: **4 casas** + **6 casas/s** entre ataques. Saltos rápidos são penalizados; os lentos, perdoados.
- Cordas soltas não dizem onde a mão está e ficam fora do centro da mão.
## Estados

| Estado | Condição | Como a interface mostra |
| --- | --- | --- |
| `unique` | Só uma posição possível (ex.: E2 na 6ª corda solta) | Verde sólido. Confiança 1 |
| `confident` | Há contexto **e** margem (1ª - 2ª) >= 0,10 | Verde sólido, texto "estimada pelo contexto" |
| `ambiguous` | Sem contexto, ou margem < 0,10 | Verde claro tracejado, rótulo "Ambígua" |
| `unknown` | Nenhuma posição (fora do alcance) | Nada destacado |

`positionConfidence` é um **índice do algoritmo, 0 a 1, não uma probabilidade**:
`min(1, margem / 0,30)`, com teto **0,25** sem contexto, **0,5** com contexto mas margem pequena e **0,9** em
`confident`. O teto de 0,9 existe de propósito: uma heurística de contexto não deve parecer certeza.
Esse campo é **independente** de `pitchConfidence` (qualidade da altura) e a interface mostra os dois separados.

## Interface

- O braço mostra só a melhor estimativa. As demais candidatas (azul) ficam atrás do interruptor
  **"Mostrar outras posições"**, desligado por padrão.
- O painel de sugestões lista todas as candidatas com a pontuação relativa e um aviso permanente de que são
  estimativas do algoritmo, não probabilidades calibradas nem confirmação física.
- Trocar o número de casas reinicia o contexto. Trocar a janela de análise recria o motor e também reinicia
  o contexto (o relógio do motor volta a zero).

## Região do braço informada pelo usuário

Limite do áudio: a 3ª corda solta (G3), a 4ª corda casa 5, a 5ª corda casa 10 e a 6ª corda casa 15 têm a MESMA
altura. Sem contexto, nenhum fator separa essas posições, e o prior de região favorece a corda solta. Isso foi
observado em uso real (G3 na 4ª corda, casa 5, apareceu como 3ª corda solta) e **não é bug do ranking**.

A resposta é uma entrada do usuário, e não um palpite: o interruptor "Informar região do braço" (desligado por
padrão) restringe as candidatas a um intervalo de casas e escolhe se as cordas soltas entram (`FretRegion`).

- Só as posições dentro da região concorrem no ranking. O contexto, a margem e os estados funcionam como antes.
- Se sobra apenas UMA posição por causa da região, o estado é `confident` (e não `unique`), com
  `positionConfidence` limitada a `maxInferredConfidence`: o resultado depende do que o usuário informou, não
  do áudio. `unique` continua significando "só existe uma posição no braço inteiro".
- Se a nota não existe na região (`outsideRegion`), usa-se o braço inteiro e a interface avisa, sem esconder a
  nota nem inventar posição.
- A região é rotulada como "Informado por você. Não é detectado pelo áudio." e aparece como faixa azul no braço.
- Mudar a região reinicia o contexto da inferência, como mudar o número de casas.
- Limitação: se o usuário toca fora da região declarada, o app erra de forma silenciosa até a região ser ajustada
  (só avisa quando a nota não existe na região). Para a correção por nota, ver a Fase 5 (`ExternalEvidence`).
## Decodificador de sequência (Fase 5a)

`src/inference/decoder.ts` (`SequenceDecoder`) substitui a decisão nota a nota na captura ao vivo. O ranking
isolado (`rankPositions`, `PositionInferrer`) continua existindo, testado e usado como referência de comparação.

**Como funciona.** Para cada nota, as candidatas são todas as posições da mesma altura. O decodificador mantém um
feixe (beam search) de caminhos "uma posição por nota" sobre as últimas `windowSize` notas e escolhe o caminho de
menor custo total. Como o caminho é global, uma nota nova pode mudar a posição de uma nota ANTERIOR (revisão).

**Custos separados** (menor = melhor; `PositionCandidate.costs`):

| Parcela | O que mede | Estado atual |
|---|---|---|
| `acoustic` | evidência do sinal (timbre) sobre a posição | sempre 0: não existe modelo acústico de posição (Fase 5c decide) |
| `evidence` | informação externa (correção manual, sensor) | 0 sem evidência; `evidenceWeight` x (1 - suporte) |
| `musical` | prior fraco de casa baixa + preferência pela região declarada | `weightRegion`, `userRegionPenalty` |
| `transition` | deslocamento da mão e troca de corda desde a nota anterior | `weightHandShift`, `weightStringCohesion`, `handFollow`, `openStringReachFactor` |

**Parâmetros** (`DecoderConfig` e `DECODER_INFERENCE_CONFIG` em `config.ts`):

| Parâmetro | Valor | Efeito |
|---|---|---|
| `beamWidth` | 24 | hipóteses mantidas; maior = mais fiel ao ótimo global, mais CPU |
| `windowSize` | 16 | notas ainda revisáveis; mais antigas são consolidadas |
| `revisionMargin` | 0,1 | histerese: cada nota anterior que mudaria custa isto; evita "pisca-pisca" |
| `userRegionPenalty` | 0,6 | custo de uma posição FORA da região declarada (preferência forte, não filtro) |
| `evidenceWeight` | 2 | peso da correção manual; domina o contexto |
| `handFollow` | 0,6 | quanto a mão estimada acompanha cada casa pressionada (média móvel) |
| `openStringReachFactor` | 2 | corda solta tolera mais distância da mão |
| `scoreTemperature` | 0,25 | escala da pontuação relativa exibida (a melhor vale 1) |
| `weightStringCohesion` | 0,15 | (era 0,25 no ranking antigo) |
| `weightRegion` | 0,4 | (era 0,15 no ranking antigo) |
| `confidentMargin` | 0,2 | (era 0,10) margem mínima para "estimada" |

**Regras de estado.** `unique` só quando existe uma única posição no braço. `confident` exige contexto OU apoio do
usuário (região que separa a candidata, ou correção manual) E margem >= `confidentMargin`. A primeira nota, ou a
primeira após pausa maior que `contextTimeoutMs`, é `ambiguous` com confiança <= 0,25: o decodificador não a trata
como resolvida. A pausa consolida o trecho anterior (suas notas deixam de ser revisáveis).

**Região.** Passou de filtro rígido para preferência: nada é removido da lista; as posições fora da região recebem
`userRegionPenalty`. Se a melhor ainda fica fora, `primaryOutsideRegion` é verdadeiro e a interface avisa. Se a nota
não existe na região, `outsideRegion` é verdadeiro.

**Interface.** Quando uma nota anterior muda de posição, o painel do braço mostra "Posição revisada: ... passou de X
para Y" enquanto a nota que provocou a revisão está ao vivo. `PositionInference` guarda `revisedFrom`,
`revisionCount` e `provisional`.

### Resultados medidos (sintéticos, NÃO são guitarra real)

Digitações escritas à mão com posição verdadeira conhecida (`tests/helpers/fingerings.ts`). Conjunto de AJUSTE
(3 digitações, 28 notas, usado para escolher parâmetros) e de VALIDAÇÃO (5 digitações, 37 notas, só avaliado
depois do ajuste de pesos; `confidentMargin` foi escolhido olhando os dois, então a validação é otimista).

| | ranking antigo | decodificador (final) | decodificador (ao vivo) |
|---|---|---|---|
| Ajuste, acerto exato | 17/28 | 19/28 | 19/28 |
| Validação, acerto exato | 14/37 | 16/37 (43%) | 16/37 |
| Ajuste, "estimada" ao vivo | 16 (10 certas) | 11 (9 certas) | idem |
| Validação, "estimada" ao vivo | 23 (12 certas) | 17 (11 certas) com margem 0,1; 11 (11 certas) com 0,2 | |

Leitura honesta: o ganho de acerto exato é pequeno (+2 notas nos dois conjuntos). O ganho principal é de
CALIBRAÇÃO: com `confidentMargin` 0,2, as notas marcadas "estimada" acertaram 100% nesses dados (contra 65-82% com
0,1), ao custo de marcar menos notas como estimadas. A precisão exata geral é modesta (43% na validação) porque o
áudio sozinho não separa posições de mesma altura. Revisões são raras: 6 de 441 sequências aleatórias tiveram uma.

### Latência (Node, máquina de desenvolvimento)

`SequenceDecoder.observe`, 3000 notas: mediana ~0,06 ms, p95 ~0,16 ms, p99 ~0,27 ms, máximo ~4,7 ms (coleta de
lixo). Isto é só o custo do decodificador; a latência de detecção de áudio é medida à parte (`docs/performance.md`).
O teste automático exige mediana < 1 ms e p95 < 5 ms. Não foi medido no navegador do usuário.

### O que depende de validação

- Todos os pesos acima são heurísticos, ajustados com digitações sintéticas escritas por mim. Não foram
  calibrados com guitarra real.
- Se `confidentMargin` 0,2 é o valor certo na prática (menos "estimadas", mais confiáveis) só a guitarra real diz.
- O custo acústico é 0: nada do timbre é usado. A decisão de usar timbre depende do experimento da Fase 5c.
- A revisão só é observada em sequências raras; em uso real pode ser mais ou menos frequente.
- Limite que nenhum decodificador remove: uma nota isolada, ou a primeira após pausa, continua ambígua.
## Decisões e limitações

- **Sem reavaliação do passado.** Uma nota posterior não corrige a posição escolhida para a anterior. Seria
  possível (Viterbi sobre a frase), mas aumenta a complexidade e a latência percebida; fica para quando houver
  dados reais que justifiquem. Na Fase 5 a correção manual cobre esse caso.
- **Primeira nota e notas após pausa** são sempre `ambiguous`: sem contexto não há base para escolher.
- **A heurística pode errar**, em especial em saltos legítimos grandes, em arpejos em cordas alternadas e em
  cordas soltas no meio de uma frase na região aguda.
- O tempo entre notas usa o ataque estimado pelo detector (precisão de aproximadamente um passo de análise).
- **Não validado com guitarra real.** Ver o caso 8 em `docs/manual-validation.md`.
- Futuro: sensores ou visão computacional entram por `ExternalEvidence` sem mudar o resto.