# Validação manual com guitarra real

**Status: NÃO EXECUTADA.** Até que esta ficha seja preenchida por uma pessoa com uma guitarra
conectada, o reconhecimento real **não está validado**. Testes com sinais sintéticos e com o
dispositivo falso do Chromium não substituem este procedimento.

## Preparação

0. **Windows com Reaper e ASIO4ALL:** o navegador não usa ASIO e o ASIO4ALL pode reservar a
   interface em modo exclusivo. Leia [`windows-audio-setup.md`](windows-audio-setup.md) antes de
   começar e feche o Reaper para o primeiro teste.
1. Conecte a guitarra à interface de áudio USB e ajuste o ganho para que o pico fique entre
   cerca de −18 e −6 dBFS no medidor, sem o aviso de saturação.
2. Desative o monitoramento direto que reproduza o sinal pelo mesmo caminho de entrada, e use
   fones para evitar microfonia.
3. Afine a guitarra na afinação padrão com um afinador de referência independente.
4. Abra o aplicativo, escolha a interface e clique em **Iniciar**.
5. Preencha o cabeçalho da ficha de resultados abaixo.

Com a Fase 2 já valem os casos 1 a 7 e 9 a 15 (menos o 8, da Fase 4). **Antes de tocar:** na seção
"Configurações" escolha a entrada em que a guitarra está (Entrada 1, Entrada 2 ou Soma) olhando as
barras por canal em "Nível de sinal"; o canal com a guitarra deve mostrar o nível. Repita os casos 6 a 14
para cada janela (2048, 4096, 8192) e anote em qual deles cada falha acontece.

## Casos de teste

| # | Caso | Como executar | O que verificar | Vale desde |
| --- | --- | --- | --- | --- |
| 1 | Dispositivo listado | Conectar a interface e abrir o app | Nome real aparece na lista após conceder permissão | Fase 1 |
| 2 | Medidor de nível | Tocar suave e forte | Medidor acompanha a dinâmica; sinal forte demais mostra saturação | Fase 1 |
| 3 | Parar captura | Clicar em Parar | Medidor zera, o indicador de uso do microfone do navegador some | Fase 1 |
| 4 | Desconexão | Desconectar o USB durante a captura | Mensagem "Dispositivo desconectado" com instruções; reconectar e iniciar funciona | Fase 1 |
| 5 | Permissão negada | Negar a permissão no navegador | Mensagem clara e instruções para liberar | Fase 1 |
| 6 | Seis cordas soltas | Tocar cada corda solta isolada (E2, A2, D3, G3, B3, E4), repetir para cada janela (2048, 4096, 8192) | Nota correta, desvio em cents, confiança da nota; sem erro de oitava | Fase 2 |
| 7 | Notas em várias casas | Tocar casas 1–5, 7–12 e 12–24 em várias cordas | Nota correta em todas as regiões | Fase 2 |
| 8 | Mesma altura em cordas diferentes | Tocar a mesma nota em duas ou mais cordas (ex.: E4 solta, B3 casa 5, G3 casa 9), uma de cada vez e depois em sequência | A primeira nota sem contexto aparece como "Ambígua" (tracejado). Em frase contínua, anotar se a posição estimada coincide com a que você tocou e quantas vezes erra; ligar "Mostrar outras posições" e conferir que a posição tocada está entre as candidatas. Confiança da posição separada da confiança da nota. A estimativa nunca deve ser tratada como confirmação | Fase 4 |
| 9 | Notas repetidas | Repetir a mesma nota em intervalos curtos e longos | Cada ataque conta uma vez; nota sustentada não duplica | Fase 2 e 5 |
| 10 | Vibrato | Vibrato estreito e largo | Sem notas falsas; confiança coerente | Fase 2 |
| 11 | Palm mute | Notas abafadas em cordas graves e agudas | Registrar se detecta, falha ou erra a oitava | Fase 2 |
| 12 | Distorção | Sinal limpo e depois com distorção, se disponível | Registrar erros de oitava e eventos falsos | Fase 2 |
| 13 | Dinâmica e decaimento | Toque suave e forte; deixar a nota morrer | Fim da nota detectado, sem eventos fantasmas | Fase 2 |
| 14 | Silêncio e ruído | Guitarra abafada, sem tocar, por 30 s | Nenhum evento falso | Fase 2 |
| 15 | Latência | Anotar a latência exibida no cartão "Tempo real" e a sensação ao tocar, para cada janela | A latência exibida exclui hardware e driver; a sensação subjetiva não é medição | Fase 2 |
| 16 | Canal de entrada | Ligar a guitarra à entrada 1, depois à 2, e alternar o seletor de canal | As barras por canal mostram onde há sinal; a nota só é detectada no canal certo (ou na soma) | Fase 2 |
| 17 | Braço: posições compatíveis | Tocar E2, F4 e E4 e comparar o braço com o que você sabe do instrumento; trocar o número de casas | Por padrão só a posição única fica em verde; com "Mostrar outras posições" ligado, todas as compatíveis aparecem em azul; a posição que você tocou está entre elas; nenhuma é apresentada como confirmada | Fase 3 |
| 18 | Afinador | Aba Afinador, tocar cada corda solta isolada, afinar pelo ponteiro e conferir com outro afinador; testar a 6ª corda suave e forte; anotar Hz e cents da 3ª corda (G3) solta | Nota e cents coerentes com o outro afinador; ponteiro verde dentro de +-5 cents; a leitura se mantém ~600 ms após o decaimento; registrar se a 6ª corda suave deixa de aparecer (portão ou clareza, ver linha "Portão de silêncio") | Fase 3 (extra) |

## Ficha de resultados

Preencha uma cópia por sessão.

- Data:
- Navegador e versão:
- Sistema operacional:
- Guitarra e captadores:
- Interface de áudio (modelo) e taxa de amostragem exibida:
- Janela de análise / sensibilidade usadas:

| # | Resultado (aprovado / falhou / parcial) | Observações |
| --- | --- | --- |
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |
| 11 | | |
| 12 | | |
| 13 | | |
| 14 | | |
| 15 | | |
| 16 | | |
| 17 | | |
| 18 | | |

## Registro de sessões executadas

Parcial, apenas casos 1 e 2 da Fase 1, por relato do usuário (M-Audio M-Track Duo; medidor
acompanha a guitarra). Ficha completa não preenchida; detalhes em
[`windows-audio-setup.md`](windows-audio-setup.md). Nenhum caso de detecção foi executado COM ficha (ver relato informal abaixo).

Relato informal do usuário após a Fase 2 (sem ficha): "as notas estão sendo identificadas perfeitamente".
Não há registro por caso, por janela, nem de latência, palm mute, distorção ou vibrato; por isso os casos
6 a 16 continuam **sem ficha preenchida**.

### Caso 20 - Tablatura, histórico e correção manual

1. Inicie a captura e toque uma sequência curta de notas, deixando uma nota soar por 2 s e repetindo uma nota três vezes. Esperado: uma entrada por ataque (sem repetição durante a sustentação); a repetição gera três entradas.
2. Pare por cerca de 2 s e toque outra nota. Esperado: uma pausa entre as duas.
3. Verifique as posições marcadas com "?" (tracejadas): elas são palpites. Compare cada uma com o que você de fato tocou e anote os acertos e erros.
4. Clique numa nota errada, escolha a posição correta e toque mais duas ou três notas vizinhas. Anote se as vizinhas passaram a ser posicionadas corretamente.
5. Use "Pausar gravação", toque algumas notas, retome e limpe. Copie/baixe a tablatura e confira o texto.
6. Anote o que o app mostrou. Esta tabela não está preenchida: não há resultado real registrado.

### Caso 19 - Região do braço informada (G3 na 4ª corda, casa 5)

1. Sem a região: toque G3 na 4ª corda, casa 5, de forma isolada. Esperado: "Ambígua", tracejado, normalmente na 3ª corda solta (mesma altura; limite do áudio, não erro).
2. Ligue "Informar região do braço", casas 1 a 7, desmarque "Incluir cordas soltas". Toque a mesma nota. Esperado: 4ª corda, casa 5, rotulada como dependente da região que você informou.
3. Toque uma nota fora da região (por exemplo, a casa 15). Esperado: aviso de que a nota não existe na região e uso do braço inteiro.
4. Anote o que o app mostrou. Esta tabela não está preenchida: não há resultado real registrado.

### Caso 21 - Estúdio: ouvir a guitarra e medir a latência

1. Use fones de ouvido (nunca caixas) e deixe o volume geral baixo. Inicie a captura. Abra a aba Estúdio: a saída deve estar desligada. Clique em "Tocar tom de teste" e confira o volume. Esperado: tom curto e baixo.
2. Ligue a saída com a predefinição "Direto". Toque. Esperado: você ouve a guitarra. Anote se o atraso é perceptível ao tocar (sim/não e como descreveria).
3. Troque entre as predefinições e ligue/desligue blocos tocando. Esperado: sem estalos fortes. Anote qualquer clique, chiado ou estouro.
4. Com tudo no máximo e a guitarra forte, o limitador deve evitar estouro digital. Anote se o indicador de saída acendeu.
5. Troque o dispositivo de saída (se o navegador listar). Desconecte o fone com a saída ligada. Esperado: mensagem de erro útil, sem travar; a captura continua.
6. Pare a captura e inicie de novo. Esperado: a saída recomeça desligada.
7. Compare com o monitoramento direto da interface (desligando um dos dois para não ouvir duas vezes).
8. Meça a latência de ida e volta por loopback (procedimento em docs/studio.md) por navegador, taxa e buffer. Esta tabela não está preenchida: não há resultado real registrado.

### Caso 22 - Estúdio: ajuste automático por música

1. Abra a aba Estúdio e escolha um arquivo de uma música que você conhece bem (guitarra limpa, depois uma com distorção forte). Esperado: os controles mudam sozinhos, a lista mostra cada ajuste com o motivo, e a saída continua desligada.
2. Ligue a saída com fones e toque. Anote se o timbre se aproxima do disco, o que está muito diferente e o que você precisou corrigir de ouvido. Esta é uma heurística não calibrada: espere diferenças.
3. Compare uma faixa limpa com uma distorcida. Esperado: a distorcida resulta em mais ganho e gabinete 4x12.
4. Clique em "Desfazer ajuste automático". Esperado: os valores voltam ao que estavam.
5. Teste um arquivo curto (menos de 5 s), um quase mudo e um que não é áudio. Esperado: mensagem clara, sem travar.
6. Esta tabela não está preenchida: não há resultado real registrado.
