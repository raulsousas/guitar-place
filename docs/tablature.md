# Tablatura e histórico (Fase 5b)

A tablatura registra as notas que o detector entregou, na ordem temporal, com a corda e a casa **estimadas** pelo
decodificador de sequência ([`inference.md`](inference.md)). A posição continua sendo uma estimativa: o áudio
monofônico não confirma a casa pressionada. Nada aqui foi validado com guitarra real (ver caso 20 em
[`manual-validation.md`](manual-validation.md)).

## Arquitetura

| Módulo | Papel |
| --- | --- |
| `src/tablature/recorder.ts` | `TabRecorder`: recebe eventos de nota e inferências, mantém a lista imutável de itens. Não conhece áudio nem React. |
| `src/tablature/quantize.ts` | Faixas grossas de duração. |
| `src/tablature/layout.ts` | Geometria das colunas, rótulos de tempo, "últimas N notas". |
| `src/tablature/ascii.ts` | Exportação em texto. |
| `src/types/tablature.ts` | `TabNote`, `TabRest`, `TabItem`. |
| `src/components/TablaturePanel.tsx`, `HistoryPanel.tsx` | Interface. O histórico lê os mesmos itens da tablatura. |

`useAudioCapture` liga o motor ao gravador: cada `onset`/`change` vai ao decodificador e ao gravador; cada `release`
define a duração; depois de cada nota as inferências atuais do decodificador são reaplicadas às entradas, de modo que
**revisões do decodificador atualizam notas já gravadas** (marcador amarelo "revisada").

## Regras de registro

- **Sustentação:** uma nota é gravada uma vez, no ataque ou na mudança de altura. Enquanto sustenta não há novos
  eventos, então não há entradas repetidas. Um evento repetido do mesmo ataque (mesma altura e instante) é ignorado.
- **Reataque da mesma nota:** o detector emite `release` (reattack) e um novo `onset`; vira outra entrada.
- **Pausas:** inseridas quando o intervalo entre o fim de uma nota e o ataque seguinte é >= `restMinS`. Não há pausa
  antes da primeira nota, depois da última, após retomar uma gravação pausada, após limpar nem após reiniciar o motor.
- **Linha do tempo contínua:** o relógio do motor recomeça em 0 a cada captura ou troca de janela; o gravador soma um
  deslocamento para a linha do tempo da tablatura continuar crescendo.
- **Pausar a gravação** não para a detecção (o braço e o afinador continuam); só deixa de registrar. Ao retomar, o
  contexto do decodificador é interrompido: notas anteriores à pausa não influenciam as seguintes.
- **Limpar** apaga tablatura e histórico e reinicia o contexto do decodificador. A região e o número de casas não mudam.

## Parâmetros

| Parâmetro | Padrão | Efeito |
| --- | --- | --- |
| `maxItems` | 400 | Limite de itens em memória (cerca de 7 min a 1 nota/s). Maior: mais memória e mais SVG; menor: perde o início. |
| `restMinS` | 0,6 s | Menor: pausas espúrias na articulação normal; maior: pausas curtas desaparecem. |
| Faixas de duração | 0,15 / 0,30 / 0,60 / 1,20 s | Só espaçamento e legenda. **Não é figura rítmica**: sem andamento nem compasso. |
| Exibição | 8 / 16 / 32 / todas | Apenas visual; o histórico completo é mantido. |

Esses valores foram escolhidos por legibilidade, não medidos com guitarra real.

## Incerteza e correção manual

- Uma nota é **estabelecida** só se o estado do decodificador é `unique` ou `confident`. `ambiguous`, ou nota sem
  posição no braço, aparece **tracejada** e com "?" no número da casa, e é exportada com "?".
- Clicar numa nota (ou Enter/Espaço, com foco) abre as candidatas, com as pontuações relativas do algoritmo (não são
  probabilidades). Escolher uma marca a nota como **corrigida por você** (azul).
- A correção é guardada como `manual` e **nunca é sobrescrita** por inferências posteriores. "Voltar à estimativa" a remove.
- A correção também entra no decodificador como evidência externa forte (`ExternalEvidence`, `support` 1), e as notas
  vizinhas ainda revisáveis podem mudar por causa dela. **Limite:** só vale para notas dentro da janela de revisão (as
  últimas 16). Para uma nota mais antiga a correção vale apenas para aquela entrada, e a interface avisa.
- Aproximação: ao receber evidência, a janela é recomputada do zero, sem a posição da mão anterior à janela.

## Exportação ASCII

Seis linhas, colunas de 4 caracteres, uma nota por coluna, `?` nas posições incertas, pausa como colunas vazias
(1 a 5 conforme a faixa), sistemas de 16 colunas. A duração das notas não é codificada. Notas fora do braço são
omitidas e contadas no cabeçalho. "Copiar" usa a área de transferência e "Baixar .txt" gera um arquivo local; nada é enviado.

## Testes

`tests/unit/tablature.test.ts` (34) cobre dedup, reataque, ordem, durações, pausas, incerteza, correção manual,
pausar/limpar, relógio reiniciado, limite de memória, layout, ASCII e um encadeamento sintético detector -> gravador.
`tests/unit/tablature-panel.test.tsx` (10) cobre a interface e o E2E usa o dispositivo falso do Chromium.
Esses testes usam sinais sintéticos e eventos fornecidos; **não** substituem testes com guitarra real.

## Não implementado / limites

- Sem andamento, compasso ou duração rítmica; sem importação; sem edição de notas além da posição.
- A tablatura não separa trechos por pausa em linhas diferentes: rola na horizontal.
- Notas muito antigas (fora da janela de 16) não mudam mais por correções posteriores.