# Sonho Lúcido

**Motor universal de otimização combinatória persistente.**

Um sistema que não para na primeira solução boa. Ele constrói, elimina,
reorganiza, recombina e reconstrói conjuntos de combinações continuamente,
preservando sempre a melhor solução já encontrada — e continua procurando
enquanto houver tempo computacional disponível.

> *"Não devemos assumir que a primeira solução boa encontrada seja a melhor
> solução possível."*

A especificação conceitual completa está em
[`docs/conceito-original.txt`](docs/conceito-original.txt).

---

## O problema, em uma frase

Dado um universo de `N` elementos, um pool de `p` deles, e cartelas de `k`
elementos: **qual é o menor conjunto de cartelas que satisfaz uma regra de
cobertura?**

O motor não conhece nenhuma modalidade específica de jogo, sorteio ou concurso.
Ele conhece apenas parâmetros matemáticos. Não existe — e não deve existir —
nenhum `if` de modalidade em lugar nenhum do código. Uma modalidade nova é
apenas uma escolha diferente de números.

## A regra de cobertura

Toda a variedade descrita no documento conceitual (cobrir pares, cobrir trincas,
cobrir subconjuntos, garantir acertos) cabe em **uma única formulação**:

> Para todo subconjunto do pool com `alvo` elementos, alguma cartela precisa ter
> pelo menos `intersecao` elementos em comum com ele.

| O que se quer                             | `alvo` | `intersecao` |
|-------------------------------------------|--------|--------------|
| cobrir todos os pares                     | 2      | 2            |
| cobrir todas as trincas                   | 3      | 3            |
| cobrir todos os subconjuntos de `t`       | t      | t            |
| garantir `t` acertos se saírem `j`        | j      | t            |

Quando `alvo == intersecao`, isso é exatamente um **covering design** `C(p,k,t)`
— um problema clássico, NP-difícil, estudado há décadas. Essa correspondência
não é acidental: é ela que permite **validar o motor contra ótimos já provados
matematicamente**, em vez de confiar que o código está certo.

## Estado atual

| Camada | Situação |
|--------|----------|
| Núcleo matemático (`motor-core`) | ✅ implementado e validado |
| Motor de busca persistente (`motor-busca`) | 🚧 em construção |
| Persistência e retomada (`motor-persistencia`) | ⬜ planejado |
| Interface de linha de comando (`motor-cli`) | ⬜ planejado |
| Interface visual | ⬜ planejado |

## Arquitetura

```
crates/
├── motor-core/          núcleo matemático — não conhece busca nem interface
│   ├── combinatoria     binomiais e ranqueamento colex de subconjuntos
│   ├── cartela          cartela como bitmask de 128 bits
│   ├── problema         configuração do usuário → problema matemático
│   ├── cobertura        índice cartela → alvos atendidos (caminho quente)
│   ├── conjunto         conjunto esparso: inserir/remover/sortear em O(1)
│   ├── solucao          solução + cobertura mantidas em sincronia incremental
│   ├── avaliacao        o que significa "melhor" (chave de custo ordenada)
│   └── limites          limites inferiores: Schönheim e contagem
```

### As três decisões que sustentam a performance

1. **Cartelas são bitmasks de 128 bits.** Interseção e contagem de elementos
   viram uma instrução de CPU cada.
2. **Alvos têm índice denso.** O ranqueamento colexicográfico dá a cada
   subconjunto um inteiro único em `0..C(p,j)`, então a cobertura é um vetor
   plano, não um mapa de conjuntos.
3. **A cobertura é incremental.** Adicionar ou remover uma cartela atualiza
   apenas os alvos daquela cartela — dezenas ou centenas de posições — em vez de
   recalcular dezenas de milhares.

### As duas defesas que sustentam a confiança

Um otimizador rápido que devolve resposta errada é pior que um lento.

1. **Oráculo independente.** `contagens_por_forca_bruta` recalcula a cobertura
   por enumeração exaustiva, sem compartilhar caminho de código com a versão
   incremental. Os testes confrontam as duas ao longo de sequências aleatórias
   de inserção e remoção.
2. **Validação contra a literatura.** Os limites inferiores reproduzem números
   de cobertura já provados — `C(v,3,2)` para `v = 3..13`, o plano projetivo
   `S(2,4,13)`, o sistema de Steiner `S(2,4,16)`. Se a matemática do projeto
   divergir da matemática publicada, os testes quebram.

## Melhor encontrado ≠ melhor possível

O sistema nunca confunde as duas coisas. Encontrar uma solução de 29 cartelas
não prova que 28 seja impossível.

- **Limite superior (UB):** a melhor solução que o motor já encontrou.
- **Limite inferior (LB):** o mínimo matematicamente possível, calculado pela
  cota de Schönheim ou por contagem.
- **Gap:** `(UB − LB) / LB`.

Quando `LB == UB`, e só então, o resultado é declarado **ótimo provado**. Em
qualquer outro caso o sistema diz apenas *"melhor solução conhecida: N cartelas"*
— porque é só isso que ele sabe.

## Desenvolvimento

```bash
cargo test              # inclui a validação contra a literatura
cargo clippy --all-targets -- -D warnings
cargo build --release
```

## Nota sobre uso em jogos de sorteio

O primeiro caso de uso pensado para o motor é a otimização de fechamentos.
Vale ser preciso sobre o que a matemática entrega e o que ela não entrega.

Um fechamento é uma **garantia condicional de cobertura**: *se* os números
sorteados estiverem dentro do pool escolhido, então alguma cartela terá pelo
menos `t` acertos. É um resultado real e verificável — e é exatamente isso que
este motor otimiza.

O que um fechamento **não** faz é alterar a probabilidade de os números
sorteados caírem no pool, nem o valor esperado de qualquer aposta. Reduzir de 100
para 29 cartelas preservando a mesma garantia economiza 71% do custo para obter
a mesma propriedade matemática — isso é otimização de custo, não previsão de
resultado. Nenhuma parte deste projeto prevê sorteios.

## Licença

MIT
