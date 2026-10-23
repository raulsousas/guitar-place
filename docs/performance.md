# Desempenho e latência

Este arquivo só recebe valores **medidos**, cada um com as condições da medição. Nenhum número
aqui é estimativa de projeto.

## Arquitetura de áudio (Fase 2)

```
AudioWorklet (thread de áudio)            thread principal
  mono = canal 1 / canal 2 / média   →   EngineHost → PitchEngine (MPM) → NoteTracker
  bloco de 10 ms, Float32Array             ↓
  TRANSFERIDO (sem cópia) + RMS/pico      eventos e estatísticas → refs → 1 setState por quadro (rAF)
```

Escolha deliberada pela opção mais simples e confiável: o worklet só combina canais e
transfere blocos; o detector roda fora da thread de áudio. O worklet nunca executa o MPM, então
uma análise lenta não pode causar falha de áudio. A decisão de mudar (Worker dedicado, depois
detector no worklet) depende das medições abaixo; **até agora elas não mostram necessidade**.

A taxa de atualização visual (rAF, até 60 quadros/s) **não é** a latência de detecção. A tela
lê o estado do motor uma vez por quadro; o motor analisa a cada 512 amostras (cerca de 94
análises/s a 48 kHz) independentemente da tela.

## Medições

### A. Algoritmo em Node (sem navegador), `npm run bench`

AMD Ryzen 5 5600X, Node 24, 20 s de áudio sintético com 20 notas, blocos de 10 ms, 48 kHz.
Detalhes e comparação por janela em [`detection.md`](detection.md).

| Janela | Análise média | p99 | Máximo | CPU / áudio |
| --- | --- | --- | --- | --- |
| 2048 | 0,27 ms | 0,43 ms | 0,68 ms | 2,6% |
| 4096 | 0,47 ms | 0,79 ms | 0,94 ms | 4,5% |
| 8192 | 1,04 ms | 1,69 ms | 3,72 ms | 9,7% |

Aqui o portão abre durante cada nota e o MPM roda, então é um caso mais pesado que o silêncio.

### B. Transferência e custo no navegador (Chromium do Playwright, dispositivo FALSO)

20 s por janela, `tests/bench/browser-diagnostics.mjs`, lido do painel "Diagnóstico do motor".
Taxa do contexto: 48000 Hz.

| Janela | Blocos/s | Transferência | Entrega do worklet | Análise média | Análise máx. | Tarefas longas (>50 ms) |
| --- | --- | --- | --- | --- | --- | --- |
| 2048 | 100 | 188 KiB/s | 2,7 ms | 0,03 ms | 0,30 ms | 0 |
| 4096 | 101 | 189 KiB/s | 2,7 ms | 0,08 ms | 1,00 ms | 0 |
| 8192 | 99 | 186 KiB/s | 2,7 ms | 0,17 ms | 1,60 ms | 0 |

**Como ler (limitações):**

- O dispositivo falso emite bipes curtos e irregulares com muito silêncio. Com o portão
  fechado o MPM não roda, então a "análise média" aqui é **menor** que a de uso real com uma
  guitarra. Use a tabela A para o custo com nota tocando.
- "Entrega do worklet" é `AudioContext.currentTime` na chegada menos o `currentTime` no fim do
  bloco; é uma aproximação da fila entre threads, com a resolução do relógio do contexto.
- A transferência é de cerca de 188 KiB/s (100 mensagens/s de 1.920 bytes). Não há
  justificativa medida para reduzir isso agora.

### C. O que ainda NÃO foi medido

- Falhas ou descontinuidades de áudio (glitches) em sessões longas.
- CPU do processo do navegador e memória ao longo de vários minutos (só um instantâneo do heap
  JS, 12 MB, ao fim de cada janela de 20 s).
- Qualquer coisa com a interface de áudio real: latência do conversor, do driver e do WASAPI
  não é exposta pelo navegador.
- Uso de CPU durante execução com guitarra real e portão aberto por longos períodos.

Esses itens ficam para a sessão com hardware ([`manual-validation.md`](manual-validation.md), caso
15) e para a Fase 6.

## Latência: o que é cada número

| Número | Significado | Onde aparece |
| --- | --- | --- |
| Janela estrutural | Tempo para encher a janela de análise (janela / taxa) | Cartão "Tempo real" |
| Latência medida da nota | Do ataque estimado ao evento (áudio) + entrega do worklet + CPU do bloco | Cartão "Tempo real", "Última nota" |
| Latência base do contexto | Atraso do `AudioContext` do navegador | Painel Áudio. **Não** é latência de detecção |
| Taxa de quadros da tela | Atualização visual, até 60 por segundo | Não é latência |
| Hardware / driver / WASAPI | Não exposto pelo navegador | Não medido |

Latência medida em sinais sintéticos, em tempo de áudio, de 28 a 65 ms conforme a altura da nota
(ver [`detection.md`](detection.md)). Com hardware ela será maior pelos itens não expostos.

## Observações da Fase 1 (dispositivo falso, Windows)

- Taxa reportada pelo contexto: 96000 Hz no dispositivo falso do Chromium nos testes E2E da
  Fase 1. Na medição B desta fase o contexto reportou 48000 Hz. O dispositivo real do usuário
  (M-Track Duo) reporta 48000 Hz.
- Latência base do `AudioContext`: 10,0 ms (Fase 1).
