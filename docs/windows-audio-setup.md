# Áudio no Windows: navegador, Reaper e ASIO4ALL

**Status: hipóteses ainda não testadas no equipamento do usuário.** O que está abaixo descreve o
comportamento geral esperado. Cada ponto deve ser confirmado na prática e o resultado registrado
na seção "Resultados observados".

## O ponto central

O Guitar Tracker roda no navegador. No Windows, o navegador captura áudio pelo sistema
(WASAPI), **não por ASIO**. O ASIO4ALL é um driver ASIO: ele serve para programas como o Reaper,
e costuma abrir a interface em modo exclusivo. Consequências esperadas:

1. Com o Reaper aberto e usando ASIO4ALL, a interface pode não ficar disponível para o navegador.
   Nesse caso o app mostra o erro "Não foi possível abrir o dispositivo".
2. A latência medida pelo app será a do caminho navegador/WASAPI, não a do ASIO. Não compare com
   a latência que o Reaper reporta.
3. O ASIO4ALL pode aparecer ou não como entrada no navegador, dependendo da instalação.

## Caminhos para testar

### A. Navegador direto na interface (recomendado para começar)

1. Feche o Reaper (isso libera o ASIO4ALL).
2. Abra o Guitar Tracker, clique em Iniciar e escolha a entrada da própria interface na lista.
3. Verifique se o medidor reage à guitarra.

Se a interface não aparecer no navegador, ela pode depender do driver do fabricante para expor
uma entrada ao Windows. Verifique em Configurações de som do Windows se a entrada existe.

### B. Reaper e navegador ao mesmo tempo (a testar)

Exige que o sinal chegue ao navegador por outra entrada, por exemplo um cabo de áudio virtual
(como VB-Cable) que o Reaper alimente e o navegador leia. Isso adiciona latência e um ponto de
falha, e o Reaper só usa um driver de áudio por vez. **Não sei se funciona com ASIO4ALL no seu
caso**; precisa ser testado. Não recomendo começar por aqui.

### C. Interface com driver que permite uso compartilhado

Algumas interfaces permitem ASIO e WASAPI ao mesmo tempo, conforme o driver do fabricante. Isso
depende do modelo. Informe o modelo para podermos registrar.

## Equipamento do usuário: M-Audio M-Track Duo

Dado informado pelo usuário: interface M-Audio M-Track Duo, usada com Reaper e ASIO4ALL.
Todos os itens abaixo são **hipóteses a confirmar**, não fatos verificados:

- **Driver.** Não confirmei se o Windows expõe esta interface ao navegador pelo driver genérico
  ou só pelo driver da M-Audio. Verifique em Configurações de som do Windows (Entrada) se ela
  aparece. Se aparecer, o navegador deve listá-la.
- **Duas entradas.** A interface tem dois canais. O app hoje pede um canal ao navegador
  (`channelCount: ideal 1`). Dependendo do navegador, isso pode entregar só a entrada 1 ou uma
  mistura das duas. **Se a guitarra estiver na entrada 2, o medidor pode ficar baixo ou parado
  mesmo com sinal.** Anote em qual entrada a guitarra está ligada.
- **Guitarra.** Use a entrada configurada para instrumento (Hi-Z) e confira no manual da
  interface qual chave ou entrada isso exige. Sem Hi-Z o sinal fica fraco e com timbre errado.
- **ASIO4ALL.** Com o Reaper aberto, o ASIO4ALL pode ocupar a interface. Teste primeiro com o
  Reaper fechado.

Se o teste mostrar que o canal errado está sendo lido, a correção prevista é pedir os dois canais
e permitir escolher a entrada (1, 2 ou soma), com medidor por canal. Isso entra antes do detector
de notas da Fase 2, pois o detector precisa receber o canal certo.

## O que anotar em cada teste

- Modelo da interface e driver instalado (do fabricante ou ASIO4ALL).
- Navegador e versão.
- Caminho usado (A, B ou C).
- A interface apareceu na lista do app? O nome estava correto?
- O medidor reagiu à guitarra? Houve erro ao iniciar?
- Taxa de amostragem e latência base mostradas no painel de Áudio.

## Resultados observados

### Teste 1 (relato do usuário, Fase 1)

- Equipamento: M-Audio M-Track Duo.
- Resultado relatado: ao ligar a guitarra e tocar, o medidor de nível se move. O usuário
  acredita que o app está recebendo o sinal da guitarra.
- **Não registrado neste teste:** navegador e versão, se o Reaper estava fechado, driver em uso,
  nome exato do dispositivo na lista, em qual entrada (1 ou 2) a guitarra estava ligada, taxa de
  amostragem exibida, e se houve aviso de saturação.
- Conclusão limitada: o caminho de captura funciona com esta interface. Isso **não** valida
  detecção de notas (ainda não existe) nem descarta o risco de canal descrito acima, pois o
  medidor só mostra que há sinal, não de qual entrada ele vem.

### Teste 1, complemento (capturas de tela do usuário)

- Nome do dispositivo na lista, **truncado pela caixa de seleção**: "Line 1/2 (M-Audio M-Track
  Solo and …". O nome completo não ficou visível. O formato "Line 1/2" indica que o Windows expõe
  as entradas 1 e 2 como um par.
- Taxa de amostragem exibida: 48000 Hz.
- Medidor durante o toque: leitura de −32 dBFS (RMS), com marcador de pico retido acima da barra.
- Ainda não confirmado: se o navegador entrega a entrada 1, a entrada 2 ou uma mistura das duas
  (o pedido atual é `channelCount: ideal 1`), e em qual entrada a guitarra estava ligada.
