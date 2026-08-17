# Sonho Lúcido

**Motor universal de otimização combinatória persistente.**

Um sistema que não para na primeira solução boa. Ele constrói, elimina,
reorganiza, recombina e reconstrói conjuntos de combinações continuamente,
preservando sempre a melhor solução já encontrada — e continua procurando
enquanto houver tempo computacional disponível.

> *"Não devemos assumir que a primeira solução boa encontrada seja a melhor
> solução possível."*

A especificação conceitual completa está em
[`docs/conceito-original.txt`](docs/conceito-original.txt). Os parágrafos citados
ao longo do código (§7, §9.4, §36…) referem-se a ela.

---

## O problema, em uma frase

Dado um universo de `N` elementos, um pool de `p` deles, e cartelas de `k`
elementos: **qual é o menor conjunto de cartelas que satisfaz uma regra de
cobertura?**

O motor não conhece nenhuma modalidade específica de jogo, sorteio ou concurso.
Ele conhece apenas parâmetros matemáticos. Não existe — e não deve existir —
nenhum `if` de modalidade em lugar nenhum do código. Uma modalidade nova é
apenas uma escolha diferente de números.

## No celular, sem instalar nada

O motor inteiro roda **dentro do seu aparelho**, compilado para WebAssembly.
Não há servidor, não há conta, não há nada saindo do telefone.

**→ [Abrir o aplicativo](https://jefersondias043-code.github.io/Sonho-l-cido/)**

No iPhone, para virar um aplicativo de verdade: abra o link no Safari, toque no
botão de compartilhar e escolha **Adicionar à Tela de Início**. Depois disso ele
abre em tela cheia, com ícone próprio, e funciona **sem internet**.

Medido num navegador com perfil de iPhone: **168 mil iterações por segundo** —
cerca de metade da velocidade nativa, e o suficiente para resolver `C(16,4,2)`
até o ótimo provado em poucos segundos.

Duas coisas que valem saber antes de usar:

- **Quando a tela apaga, o iOS congela a página** e a busca para. Há um
  interruptor "manter a tela ligada" que evita isso; sem ele, a busca pausa e
  retoma quando você volta — o progresso fica salvo de qualquer forma.
- **A memória do celular é bem menor que a do computador.** A tela de
  configuração calcula o tamanho do problema antes de começar e avisa quando
  ele é pesado demais, em vez de deixar o navegador derrubar a página.

Para buscas longas, em problemas grandes, o computador continua sendo o lugar
certo — e é para isso que existe a linha de comando abaixo.

## No computador

```bash
cargo build --release
```

O binário sai em `target/release/sonho-lucido`.

### Criar um fechamento do zero

```bash
sonho-lucido criar --universo 60 --pool 16 --cartela 4 --cobrir 2 --tempo 5s
```

```
  universo 60 | pool 16 | cartela 4
  regra: cobrir todo subconjunto de 2 elementos do pool
  limite inferior: ≥ 20 cartelas (cota de Schönheim)

  solução inicial: 34 cartelas
  ★ 29 cartelas | cobertura 100,0% | iteração 72        | via remover piores
  ★ 25 cartelas | cobertura 100,0% | iteração 410       | via remover piores
  ★ 23 cartelas | cobertura 100,0% | iteração 9.651     | via remover aleatórias
  ↻ estagnação na iteração 59.651: reconstrução completa do zero
  ★ 20 cartelas | cobertura 100,0% | iteração 71.105    | via remover piores

  encerrado: optimalidade provada
  ÓTIMO PROVADO: 20 cartelas é o mínimo matematicamente possível.
```

### Otimizar um fechamento que você já tem

Universo, pool e tamanho da cartela são deduzidos do próprio arquivo:

```bash
sonho-lucido otimizar --arquivo meu-fechamento.txt --cobrir 2 --tempo 10m
```

O arquivo é uma cartela por linha. Espaço, vírgula, ponto e vírgula ou hífen
servem como separador; linhas iniciadas por `#` são comentários.

```
# meu fechamento
01 04 07 12
02 05 08 14
```

O motor **não fica preso às cartelas que você forneceu** (§32). Ele pode
remover, reorganizar e criar outras — o que importa é a regra de cobertura.

### Histórico de trabalhos

No aplicativo, toda busca é salva sozinha assim que produz a primeira solução, e
o registro vai sendo atualizado a cada melhoria. A aba **Histórico** lista os
trabalhos; **Continuar** retoma qualquer um deles com a solução já alcançada e a
contagem de iterações de onde parou — e aprimora **aquele mesmo registro**, em
vez de criar uma cópia ao lado.

Fica tudo no armazenamento do próprio aparelho. Armazenamento de navegador não é
cofre: o iOS pode limpar dados de sites pouco visitados, e apagar os dados do
navegador leva o histórico junto. Para guardar de vez, exporte as cartelas.

### Parar e continuar

`Ctrl+C` interrompe a qualquer momento. Nada se perde: cada recorde vai para o
banco no instante em que aparece.

```bash
sonho-lucido retomar --tempo 2h
```

### Consultar o que já foi encontrado

```bash
sonho-lucido listar                    # todas as buscas gravadas
sonho-lucido ranking --limite 10       # as melhores soluções de uma busca
sonho-lucido exportar --saida saida.txt
```

### A regra de cobertura

Toda a variedade descrita no documento conceitual (cobrir pares, cobrir trincas,
cobrir subconjuntos, garantir acertos) cabe em **uma única formulação**:

> Para todo subconjunto do pool com `alvo` elementos, alguma cartela precisa ter
> pelo menos `intersecao` elementos em comum com ele.

| O que se quer                        | Argumento         |
|--------------------------------------|-------------------|
| cobrir todos os pares                | `--cobrir 2`      |
| cobrir todas as trincas              | `--cobrir 3`      |
| cobrir todo subconjunto de `t`       | `--cobrir T`      |
| garantir `t` acertos se saírem `j`   | `--garantir J:T`  |

Quando alvo e interseção coincidem, o problema é exatamente um **covering
design** `C(p,k,t)` — um problema clássico, NP-difícil, estudado há décadas.
Essa correspondência não é acidental: é ela que permite **validar o motor contra
ótimos já provados matematicamente**, em vez de confiar que o código está certo.

## Aferição contra a literatura

`cargo run --release --example aferir` roda o motor contra covering designs cujo
mínimo já foi provado, com 3 segundos por caso:

| Configuração | Ótimo conhecido | Encontrado | Ótimo provado | Referência |
|--------------|-----------------|------------|---------------|------------|
| C(7,3,2)     | 7   | 7   | sim | plano de Fano |
| C(9,3,2)     | 12  | 12  | sim | sistema de Steiner S(2,3,9) |
| C(10,3,2)    | 17  | 17  | sim | cota de Schönheim exata |
| C(11,3,2)    | 19  | 19  | sim | cota de Schönheim exata |
| C(12,3,2)    | 24  | 24  | sim | cota de Schönheim exata |
| C(13,3,2)    | 26  | 26  | sim | sistema de Steiner S(2,3,13) |
| C(8,4,3)     | 14  | 14  | sim | valor clássico |
| C(13,4,2)    | 13  | 13  | sim | plano projetivo de ordem 3 |
| C(16,4,2)    | 20  | 20  | sim | sistema de Steiner S(2,4,16) |
| C(21,5,2)    | 21  | 27  | —   | plano projetivo de ordem 4 |
| C(25,5,2)    | 30  | 39  | —   | sistema de Steiner S(2,5,25) |

**9 de 11 no ótimo provado, em segundos.** Os dois últimos precisam de mais
tempo — são instâncias em que a busca local sabidamente sofre.

## Arquitetura

```
crates/
├── motor-core/          núcleo matemático — não conhece busca nem interface
│   ├── combinatoria     binomiais e ranqueamento colex de subconjuntos
│   ├── cartela          cartela como bitmask de 128 bits
│   ├── problema         configuração do usuário → problema matemático
│   ├── cobertura        índice cartela → alvos atendidos (caminho quente)
│   ├── conjunto         conjunto esparso: inserir/remover/sortear em O(1)
│   ├── solucao          solução + cobertura em sincronia incremental
│   ├── avaliacao        o que significa "melhor" (chave de custo ordenada)
│   └── limites          limites inferiores: Schönheim e contagem
│
├── motor-busca/         a busca persistente e auto-reconstrutiva
│   ├── operadores       §9    oito formas de destruir parte da solução
│   ├── construcao       §9.4  reconstrução gulosa com ruído (GRASP)
│   ├── aceitacao        §11   aceitação tardia: quando aceitar piorar
│   ├── adaptativo       §36   pesos que aprendem qual operador serve
│   ├── arquivo          §17-20 elites por qualidade e diversidade
│   ├── controle         §15-16 parar e continuar
│   └── motor            §7-8  o laço, com o recorde protegido
│
├── motor-persistencia/  banco SQLite de soluções e retomada
├── motor-cli/           a linha de comando
└── motor-web/           a ponte para o navegador, via WebAssembly

web/                     a interface do aplicativo
├── index.html           as quatro telas
├── app.js               a interface: só apresentação e ciclo de vida
├── trabalhador.js       o motor rodando num Web Worker, em lotes
├── historico.js         os trabalhos salvos no aparelho
└── sw.js                funcionamento sem internet e atualização automática
```

O mesmo motor atende os dois caminhos. A versão do celular não é uma
reimplementação simplificada: é exatamente o código validado pelos mesmos 162
testes, compilado para outro alvo.

### As três decisões que sustentam a performance

1. **Cartelas são bitmasks de 128 bits.** Interseção e contagem de elementos
   viram uma instrução de CPU cada.
2. **Alvos têm índice denso.** O ranqueamento colexicográfico dá a cada
   subconjunto um inteiro único em `0..C(p,j)`, então a cobertura é um vetor
   plano, não um mapa de conjuntos.
3. **A cobertura é incremental.** Adicionar ou remover uma cartela atualiza
   apenas os alvos daquela cartela; desfazer uma tentativa recusada mexe só na
   diferença. Recalcular do zero custaria `O(total_alvos)` por iteração e
   inviabilizaria a busca.

### A estratégia de busca: perseguir cardinalidade fixa

"Minimizar cartelas" é vago demais para guiar uma busca local. O motor fixa uma
meta — *resolver com exatamente N cartelas* — e minimiza apenas os alvos
descobertos. Ao fechar a cobertura, registra o recorde e baixa a meta para
`N − 1`.

Isso transforma um problema de otimização difuso em uma sequência de problemas
de viabilidade bem definidos, cada um com um gradiente claro para seguir. O
mesmo mecanismo atende cobertura máxima sob orçamento: a meta simplesmente para
de descer.

### As duas defesas que sustentam a confiança

Um otimizador rápido que devolve resposta errada é pior que um lento.

1. **Oráculo independente.** `contagens_por_forca_bruta` recalcula a cobertura
   por enumeração exaustiva, sem compartilhar caminho de código com a versão
   incremental. Os testes confrontam as duas ao longo de sequências aleatórias
   de inserção e remoção, e depois de cada operador.
2. **Validação contra a literatura.** Os limites inferiores reproduzem números
   de cobertura já provados. Se a matemática do projeto divergir da matemática
   publicada, os testes quebram.

## Melhor encontrado ≠ melhor possível

O sistema nunca confunde as duas coisas. Encontrar uma solução de 29 cartelas
não prova que 28 seja impossível.

- **Limite superior (UB):** a melhor solução que o motor já encontrou.
- **Limite inferior (LB):** o mínimo matematicamente possível, calculado pela
  cota de Schönheim ou por contagem.
- **Gap:** `(UB − LB) / LB`.

Quando `LB == UB`, e só então, o resultado é declarado **ótimo provado** e a
busca encerra sozinha — não há mais nada a procurar. Em qualquer outro caso o
sistema diz apenas *"melhor solução conhecida: N cartelas"*, porque é só isso
que ele sabe.

## Estado atual

| Camada | Situação |
|--------|----------|
| Núcleo matemático (`motor-core`) | ✅ implementado e validado |
| Motor de busca persistente (`motor-busca`) | ✅ implementado e aferido |
| Persistência e retomada (`motor-persistencia`) | ✅ implementado |
| Interface de linha de comando (`motor-cli`) | ✅ implementado |
| Motor no navegador (`motor-web`, WebAssembly) | ✅ implementado |
| Aplicativo para celular (instalável, offline) | ✅ implementado |
| Histórico de trabalhos, com retomada | ✅ implementado |
| Busca em paralelo (múltiplos núcleos) | ⬜ planejado |

### Limitações conhecidas

- **Garantias parciais grandes são lentas.** Quando `alvo > interseção` e o pool
  é grande, cada avaliação de cartela percorre milhares de alvos. O orçamento de
  trabalho por cartela evita o pior caso, mas a taxa de iteração cai de centenas
  de milhares para algumas centenas por segundo. Um cache de alvos por cartela
  resolveria a maior parte disso.
- **Instâncias grandes de covering design ficam acima do ótimo.** C(21,5,2) e
  C(25,5,2) param 28-30% acima em execuções de segundos.
- **Execução em um núcleo só.** O motor é sequencial. Buscar em paralelo, com
  arquivo de elites compartilhado, é o próximo ganho grande. No navegador isso
  esbarra num limite adicional: threads em WebAssembly exigem cabeçalhos HTTP
  que o GitHub Pages não permite configurar.
- **No celular, a busca para quando a tela apaga.** É o iOS suspendendo a
  página, não um defeito do motor. O interruptor de manter a tela ligada
  contorna, e o progresso é salvo de todo jeito.

## Desenvolvimento

```bash
cargo test --workspace                          # 162 testes
cargo clippy --workspace --all-targets -- -D warnings
cargo run --release --example aferir            # aferição contra a literatura

./construir-web.sh                              # monta o site em site/
./testar-construcao.sh                          # testa a construção em si
node web/testar.mjs                             # testa a interface na raiz
node web/testar.mjs /Sonho-l-cido/              # testa sob a subpasta do Pages
node web/testar-atualizacao.mjs                 # testa a atualização automática
node web/testar-historico.mjs                   # testa o histórico de trabalhos
python3 -m http.server -d site 8000             # experimenta localmente
```

O teste do navegador roda a interface num Chromium com viewport de iPhone,
executa uma busca completa e **confere a cobertura da solução exibida em
JavaScript** — sem tocar no código Rust que a produziu. Foi ele que revelou dois
defeitos que nenhum teste unitário pegaria: uma mensagem perdida entre a
interface e o worker durante o carregamento do WebAssembly, e um parâmetro
`u64` que o JavaScript recusava por esperar `BigInt`.

O argumento de subpasta importa: o GitHub Pages não serve na raiz do domínio,
e sim em `/Sonho-l-cido/`. Um caminho absoluto passaria em `localhost:8000/` e
quebraria só depois de publicado. O teste roda sob a subpasta e confere, pelo
registro do próprio servidor, que todo arquivo — inclusive o WebAssembly, que
é buscado de dentro do Web Worker — veio do lugar certo.

## Nota sobre uso em jogos de sorteio

O primeiro caso de uso pensado para o motor é a otimização de fechamentos.
Vale ser preciso sobre o que a matemática entrega e o que ela não entrega.

Um fechamento é uma **garantia condicional de cobertura**: *se* os números
sorteados estiverem dentro do pool escolhido, então alguma cartela terá pelo
menos `t` acertos. É um resultado real e verificável — e é exatamente isso que
este motor otimiza.

O que um fechamento **não** faz é alterar a probabilidade de os números
sorteados caírem no pool, nem o valor esperado de qualquer aposta. Reduzir de
100 para 29 cartelas preservando a mesma garantia economiza 71% do custo para
obter a mesma propriedade matemática — isso é otimização de custo, não previsão
de resultado. Nenhuma parte deste projeto prevê sorteios.

## Licença

MIT
