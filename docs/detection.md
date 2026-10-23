# Detecção de notas

Como o motor identifica a **altura musical** (etapa A). A inferência de corda e casa (etapa B) é
independente e só existe a partir da Fase 4.

> **Status de validação:** os números abaixo vêm de **sinais sintéticos** (`npm run bench`,
> arquivo bruto em [`benchmark-results.json`](benchmark-results.json)). Eles validam o algoritmo.
> **Não validam o reconhecimento com uma guitarra real**, que depende da checklist em
> [`manual-validation.md`](manual-validation.md) (ainda não executada).

## Pipeline

```
worklet (10 ms, mono) → PitchEngine
   → passa-altas 60 Hz + passa-baixas 2,5 kHz (se "filtro de ruído" ligado)
   → anel de amostras (tamanho = janela)
   → a cada hop (512 amostras): energia (RMS 20 ms) → portão de silêncio
   → MPM sobre a janela → { frequência, clareza }
   → NoteTracker → eventos onset / change / release
```

- **Algoritmo principal: MPM** (McLeod e Wyvill, 2005), sobre uma NSDF calculada por
  autocorrelação via FFT. **YIN** está implementado como referência de comparação
  (`src/dsp/yin.ts`) e coberto por testes, mas não é usado em produção.
- **Por que MPM:** o pico da NSDF é limitado a 1 e serve diretamente como medida de clareza;
  a regra "primeiro pico acima de `cutoff × maior pico`" trata bem harmônicos fortes sem
  descer uma oitava.
- **Etapa A e etapa B são separadas.** O motor emite `pitchConfidence` (qualidade da
  periodicidade, 0 a 1, **não é probabilidade**). A confiança da posição de corda e casa é outro
  campo, calculado só na Fase 4.

## Parâmetros

Valores padrão em `src/dsp/defaults.ts`, com efeito e custo comentados junto de cada um.

| Parâmetro | Padrão | Efeito | Custo / risco |
| --- | --- | --- | --- |
| `minFrequencyHz` | 70 Hz | Maior período pesquisado; deixa folga abaixo do E2 (82,41 Hz) | Baixar exige janela maior e aumenta o risco de oitava grave |
| `maxFrequencyHz` | 1500 Hz | Menor período pesquisado; cobre E6 (1318,5 Hz) | Subir admite picos espúrios agudos |
| Atraso máximo (derivado) | `janela / 2` | Garante ao menos 2 períodos na janela | Define o limite grave real (tabela abaixo) |
| `mpmCutoff` | 0,93 | Fração do maior pico exigida para escolher o primeiro pico | Maior: tende a oitava abaixo. Menor: tende a harmônico |
| `minClarity` | 0,80 | Rejeita estimativas pouco periódicas | Maior: perde palm mute e distorção. Menor: falsos positivos |
| `stableFrames` | 3 | Quadros consecutivos para confirmar uma nota | Soma `3 × 10,7 ms` ao atraso (a 48 kHz) |
| `octaveJumpFrames` | 12 | Quadros para aceitar salto de 12/19/24 semitons **sem** novo ataque | Corrige oitava errada no início só após cerca de 128 ms |
| `changeSemitones` | 0,75 | Distância ao centro da nota que passa a contar como mudança | Bends menores que isso não geram evento. Vibrato de ±50 cents não gera nota falsa |
| `onsetRiseDb` | 6 dB | Subida de energia sobre o mínimo recente que conta como novo ataque | Baixo: oscilação de volume vira ataque. Alto: perde ataques suaves |
| `onsetLookbackMs` | 60 ms | Janela do mínimo recente de energia | Deve ser menor que `reattackMinMs` |
| `reattackMinMs` | 80 ms | Intervalo mínimo entre ataques | Limita a cerca de 190 BPM em semicolcheias |
| `releaseMs` | 60 ms | Silêncio antes de encerrar a nota | Menor: o decaimento corta a nota |
| `unpitchedReleaseMs` | 200 ms | Sinal presente sem altura antes de encerrar | Cobre ruído, palm mute e fim de decaimento |
| `hysteresisDb` | 6 dB | Diferença entre limiar de abertura e de fechamento do portão | Evita trepidação do portão |
| `noiseMarginDb` | 10 dB | Com filtro ligado, o portão abre acima do ruído de fundo medido + margem | Em sala ruidosa, notas suaves podem ficar abaixo do limiar |
| `energyWindowMs` | 20 ms | Janela da energia (maior que um período do E2, 12,1 ms) | Maior: ataques mais lentos |
| `highpassHz` / `lowpassHz` | 60 / 2500 Hz | Remove DC e ronco / reduz chiado e harmônicos agudos | O passa-altas atenua o E2 em cerca de 1 dB |
| `hopSize` | 512 amostras | Passo entre análises (10,7 ms a 48 kHz, cerca de 94 quadros/s) | Menor: mais CPU. Maior: mais atraso |
| Sensibilidade | 70% = −49,5 dBFS | Limiar de abertura do portão: 0% = −25 dBFS, 100% = −60 dBFS | Alta demais deixa passar ruído |

Os valores são pontos de partida e **ainda não foram ajustados com guitarra real**.

## Janela de análise (2048, 4096, 8192)

Valores estruturais a 48 kHz (taxa da M-Track Duo). O motor usa sempre a taxa real do
`AudioContext`; a 96 kHz (dispositivo falso do Chromium) os tempos caem pela metade e o limite
grave sobe.

| Janela | Duração | Períodos do E2 na janela | Menor frequência detectável |
| --- | --- | --- | --- |
| 2048 | 42,7 ms | 3,5 | 70 Hz (piso configurado). A 96 kHz sobe para 94 Hz e **perde o E2** |
| 4096 | 85,3 ms | 7,0 | 70 Hz |
| 8192 | 170,7 ms | 14,1 | 70 Hz |

### Exatidão medida (sinais sintéticos, 48 kHz, 49 notas E2 a E6, semitom a semitom)

Cada nota é sintetizada com 6 harmônicos e decaimento exponencial. "Correta" significa que o
primeiro evento tem a nota certa; entre parênteses, a mediana do erro absoluto em cents.

| Cenário | 2048 | 4096 | 8192 |
| --- | --- | --- | --- |
| Limpo | 49/49 (0,6) | 49/49 (1,0) | 49/49 (1,0) |
| Ruído branco, SNR 20 dB | 49/49 (0,6) | 49/49 (1,0) | 49/49 (1,0) |
| Ruído branco, SNR 10 dB | 49/49 (0,7) | 49/49 (1,1) | 49/49 (0,9) |
| Ruído branco, SNR 0 dB | 49/49 (1,6) | 49/49 (1,3) | 49/49 (1,3) |
| Fundamental fraca (2º harmônico dominante) | 49/49 (0,2) | 49/49 (0,4) | 49/49 (0,4) |
| Espectro distorcido (8 harmônicos fortes) | 49/49 (0,1) | 49/49 (0,2) | 49/49 (0,2) |

Nenhum erro de oitava, nota errada, nota perdida ou evento extra nesses cenários.

**Notas graves (E2 a D3, 8 notas):** 8/8 corretas em todos os cenários e janelas, inclusive o
E2. Mediana do erro em cents, limpo: 0,4 / 3,5 / 3,5 (2048 / 4096 / 8192); SNR 0 dB: 2,2 / 3,1 / 2,2.
O erro é maior nas notas graves com 4096 e 8192 do que com 2048; a causa não foi investigada.

**Interpretação honesta:** resultado perfeito em sinais sintéticos mostra que o algoritmo e o
rastreador estão corretos nas condições modeladas. Uma guitarra real tem inarmonicidade, ruídos
de palheta e de traste, ressonâncias, captadores com resposta própria e distorção que o gerador
não reproduz. **Espere resultados piores com guitarra real e meça** com a checklist.

### Latência medida (sinais sintéticos)

"Início real → evento" é o tempo entre o instante em que a nota começa no sinal e o instante em
que o evento `onset` é decidido, em tempo de **áudio** (não inclui hardware, driver, WASAPI nem
a transferência do worklet). Mediana de 5 repetições com deslocamentos sub-bloco.

| Nota | 2048 | 4096 | 8192 |
| --- | --- | --- | --- |
| E2 | 62,5 ms | 64,6 ms | 64,6 ms |
| A2 | 53,9 ms | 53,9 ms | 53,9 ms |
| E3 | 45,3 ms | 45,3 ms | 45,3 ms |
| E4 | 34,7 ms | 34,7 ms | 34,7 ms |
| E5 | 30,5 ms | 30,5 ms | 30,5 ms |
| E6 | 28,4 ms | 28,4 ms | 28,4 ms |

Observações importantes:

- A latência cresce para notas graves (mais tempo até o MPM confirmar `stableFrames` quadros) e
  **não depende da janela neste teste**. Hipótese (não verificada): o fundo sintético é silêncio digital, então uma janela
  parcialmente preenchida ainda correlaciona bem. **Com ruído real antes da nota, uma janela
  maior pode precisar de mais tempo para ficar dominada pela nota.** Isso não foi medido.
- A janela estrutural (42,7 / 85,3 / 170,7 ms) é o tempo para enchê-la e **não é** a latência
  medida. O cartão "Tempo real" mostra os dois valores separados.
- A latência real do app soma ainda a entrega do worklet à thread principal, o processamento do
  bloco, o buffer do navegador/WASAPI e o conversor da interface. Estes últimos o navegador não
  expõe. A latência total percebida só pode ser medida de ponta a ponta com hardware.

### Notas rápidas (8 notas alternadas E3, A3, C4, com pausa de 30 ms)

Notas detectadas na ordem correta, de 8 esperadas, sem eventos extras:

| Duração de cada nota | 2048 | 4096 | 8192 |
| --- | --- | --- | --- |
| 80 ms | 8 | 8 | **1** |
| 120 ms | 8 | 8 | 8 |
| 160 ms | 8 | 8 | 8 |
| 250 ms | 8 | 8 | 8 |

Limitação conhecida: com 8192, depois de um novo ataque o rastreador espera metade da janela
(85 ms) para a janela ficar majoritariamente nova, e uma nota de 80 ms termina antes disso.
Para passagens rápidas, use 2048 ou 4096.

## Custo de CPU (Node, AMD Ryzen 5 5600X, 20 s de áudio, blocos de 10 ms)

| Janela | Tempo médio por análise | p99 | Máximo | Tempo de CPU / tempo de áudio |
| --- | --- | --- | --- | --- |
| 2048 | 0,27 ms | 0,43 ms | 0,68 ms | 2,6% |
| 4096 | 0,47 ms | 0,79 ms | 0,94 ms | 4,5% |
| 8192 | 1,04 ms | 1,69 ms | 3,72 ms | 9,7% |

Medido em Node, sem renderização. O custo no navegador deve ser medido com o painel de
diagnóstico do app (ver [`performance.md`](performance.md)).

## Tratamento dos problemas pedidos

| Problema | Tratamento | Cobertura de teste |
| --- | --- | --- |
| Harmônicos dominantes | Regra do primeiro pico acima de `cutoff × máximo` | Fundamental fraca e espectro distorcido, 3 janelas |
| Erro de oitava | `octaveJumpFrames`; ataque novo reinicia a decisão | Faixa E2 a E6 semitom a semitom, 3 janelas; `NoteTracker` |
| Notas graves | Piso 70 Hz, limite dependente da janela, passa-altas leve | Cordas soltas e E2 a D3 |
| Distorção | Passa-baixas 2,5 kHz, clareza mínima | Espectro com 8 harmônicos fortes (sintético) |
| Palm mute | Sem altura (clareza baixa) por 200 ms encerra a nota; não inventa nota | Teste do rastreador. **Comportamento real não observado** |
| Vibrato | Centro de altura suavizado e tolerância de 0,75 semitom | Vibrato de ±40 cents, 3 janelas |
| Ruído de fundo | Portão com histerese e piso de ruído adaptativo | Silêncio, ruído a −70 dBFS, ruído branco forte, DC |
| Notas curtas | `stableFrames` e liberação rápida | Tabela de notas rápidas acima |
| Variações de volume | Limiar de ataque relativo (dB), não absoluto | Notas com 30 dB de diferença |
| Ataques consecutivos da mesma nota | Subida de energia ≥ 6 dB reinicia a nota | 4 ataques seguidos da mesma nota |

## Limitações conhecidas

- Sem validação com guitarra real. Ajustes de `minClarity`, `onsetRiseDb` e `noiseMarginDb`
  provavelmente serão necessários.
- Monofônico: acordes não são interpretados e podem gerar eventos espúrios.
- Bends menores que `changeSemitones` (0,75 semitom) não geram nota nova.
- Passagens muito rápidas (menos de 80 ms por nota) podem perder notas; com 8192 o limite sobe.
- O sinal chega por WASAPI, não ASIO; a latência de hardware é desconhecida.
- Afinação de referência fixa em A4 = 440 Hz (parametrizável no motor, sem interface ainda).

## Como reproduzir

```bash
npm test         # testes do detector por janela, rastreador, MPM/YIN, host
npm run bench    # gera docs/benchmark-results.json (cerca de 1 minuto)
```
