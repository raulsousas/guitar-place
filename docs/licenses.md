# Licenças e origem dos componentes do Estúdio

Este arquivo registra a origem de tudo o que o Estúdio usa. Qualquer ativo de terceiros precisa ser listado aqui
**antes** de ser incluído.

| Item | Origem | Licença | Observação |
| --- | --- | --- | --- |
| Motor do Estúdio (`src/fx/`) | Escrito neste projeto | Do projeto | Nós nativos do Web Audio API (`BiquadFilter`, `WaveShaper`, `Convolver`, `Delay`, `Gain`, `Analyser`) |
| Curvas de saturação e limitador | Escritas neste projeto | Do projeto | Fórmulas documentadas em `src/fx/curves.ts` |
| Resposta de impulso do reverb | **Gerada em código** (`src/fx/reverb-ir.ts`) | Do projeto | Ruído sintético com semente fixa. Nenhum arquivo de áudio de terceiros, nenhuma sala real |
| Amplificador e gabinete | Escritos neste projeto | Do projeto | Aproximações matemáticas simples. **Sem modelos neurais, sem capturas, sem respostas de impulso de gabinetes reais** |
| Predefinições | Escritas neste projeto | Do projeto | Nomes neutros. Não reproduzem equipamentos |
| Ícones | Escritos neste projeto (`src/components/icons.tsx`) | Do projeto | |
| Fonte Inter | Empacotada com o aplicativo | SIL OFL 1.1 | Já usada antes do Estúdio |
| `node-web-audio-api` 2.2.0 | npm | BSD-3-Clause | **Somente `devDependency`**, usada apenas nos testes (`tests/unit/studio-engine.test.ts`). Não vai no pacote de produção |

## Marcas registradas

O aplicativo não usa nomes de amplificadores, pedais ou alto-falantes de marcas reais e **não afirma** reproduzir
nenhum equipamento. A imagem de referência da interface mostra nomes comerciais; eles foram trocados por termos
genéricos de propósito.

## Áudio do usuário

Nada é gravado, armazenado ou enviado. Não há carregamento de arquivos do usuário nesta versão.
