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

> **Há um segundo aplicativo neste repositório**, em
> [`/fechamentos/`](https://jefersondias043-code.github.io/Sonho-l-cido/fechamentos/).
> O motor acima resolve qualquer configuração, sob demanda, dentro do aparelho.
> O aplicativo de **fechamentos da Lotofácil** faz o oposto: as 330 respostas
> possíveis já estão resolvidas, conferidas e publicadas como arquivos
> estáticos, e o cliente só baixa a que precisa — 1.494 linhas, 24 KiB
> comprimidos, zero dependências. Ele vive em `app/`, `catalogo/`, `motor/` e
> `servidor/`, e está descrito em [`docs/fechamentos.md`](docs/fechamentos.md).

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

É **um aplicativo**, e abrir a página já é estar nele. Tudo roda **dentro do
seu aparelho**, compilado para WebAssembly. Não há servidor, não há conta, não
há nada saindo do telefone.

Eram três — Lotinha, Construtor e Construtor Exato —, cada um com a sua tela, o
seu histórico e a sua conferência. Eram três porque a tela **era** a modalidade:
o universo de 25 e o sorteio de 15 estavam fixos no código da Lotinha, então
"não é loteria" precisava de uma segunda tela e "saem outros tantos" de uma
terceira. Abertos os dois números, as três viraram casos de uma só, e a
diferença entre elas passou a ser o que sempre foi: qual motor responde melhor
àquele pedido.

| a pergunta | quem responde |
|---|---|
| quais jogos preciso fazer para não perder? | o banco embutido, na hora |
| e se o pedido não estiver no banco? | a construção algébrica, em milissegundos |
| qual é o mínimo, e como sei que é o mínimo? | o motor exato: piso provado, escalada e verificação |
| dá para fazer menor do que isso? | a busca estocástica, enquanto você deixar |

O aplicativo escolhe sozinho entre os três primeiros, nessa ordem, e nunca
esconde qual respondeu. Os dois últimos também podem ser pedidos à mão sobre um
fechamento que já está na tela: ter um fechamento e ter a prova de que ele é o
menor são coisas diferentes.

Os cinco números que descrevem um fechamento — pool, tamanho do jogo, quantos
números são sorteados, quantos deles a cartela precisa conter, e quantas
cartelas premiadas — estão todos na tela, com a grade onde você marca as dezenas
que vai jogar. Universo e sorteio ficam em **Avançado**, já preenchidos com a
modalidade: quem só quer jogar não esbarra neles. Separar o sorteio da garantia
é o que permite pedir "saem 15, quero garantir 13", que os três números de um
covering design não conseguem descrever.

Com mais de uma cartela premiada a tabela publicada some da tela, e isso é de
propósito: ela descreve cobertura **simples**, e um covering design não entrega
duas cartelas premiadas por sorteio. Mostrá-la ali convidaria a comparar o seu
resultado com um número que resolve outro problema.

### A escalada de cobertura

O motor exato não monta uma solução grande para depois encolher. A lógica é
a inversa:

> **O número de cartelas é limitado pelo mínimo matemático. A variável que
> evolui é a cobertura.**

Ele começa com uma cartela e mede quanto ela cobre; acrescenta a segunda e mede
de novo; e sobe assim até o teto — que é o piso provado, e **nunca é
ultrapassado**. Em nove números com jogos de 3 garantindo 2:

```
1 → 8,3% · 2 → 16,7% · 3 → 25,0% · 4 → 33,3% · 5 → 41,7% · 6 → 50,0%
· 7 → 58,3% · 8 → 66,7% · 9 → 75,0% · 10 → 80,6% · 11 → 88,9% · 12 → 94,4%
```

A subida sozinha para em 94,4% com as doze cartelas. Chegando ao teto sem
fechar, ele **não acrescenta a décima terceira**: mantém o número e passa a
reorganizar o conjunto — troca uma por outra, derruba várias e repõe várias,
reestrutura inteiro. Foi a reorganização que levou aquelas mesmas doze de 94,4%
a 100%, e é por isso que doze é o mínimo, provado.

### Quando o piso não basta: a construção avançada

O piso é uma cota **inferior**. Ele diz que nada menor existe — não que aquele
tamanho seja suficiente. Para muitas configurações ele é inatingível:

| pool, jogo | piso | melhor fechamento conhecido |
|---|---|---|
| 18, 17 | 16 | **16** — o piso é atingível |
| 19, 17 | 51 | **51** |
| 20, 18 | 40 | **40** |
| 20, 17 | 160 | **240** |
| 22, 17 | 1.537 | **3.454** |

Onde ele é atingível, a escalada fecha nele e o mínimo está provado. Onde não é,
nenhuma disposição daquele tamanho cobre tudo — e a versão anterior ficava
reorganizando o impossível para sempre, sem nunca cumprir a garantia.

Quando a reorganização atravessa cinco mil rodadas sem uma única melhoria, a
tela **oferece** a construção avançada — e espera. A paciência não é arbitrária:
medindo os casos em que o piso **é** alcançável, a reorganização fecha cedo —
273 rodadas em 19 números com jogos de 17, 793 em 20 com jogos de 18, zero em 18
com jogos de 17, que fecha ainda na subida. Onde não é, ela atravessa milhões sem
melhorar uma vez.

São três estágios, e **cada transição é sua**:

1. **Escalada** — sobe até o piso e reorganiza. Fechando aqui, o mínimo está
   provado e não há mais nada a fazer.
2. **Construção avançada** — o teto sai e a subida recomeça até a garantia ser
   cumprida. Ligada por você: passar do piso troca um mínimo provado por uma
   solução que apenas funciona.
3. **Otimização** — tenta cobrir tudo com uma cartela a menos, e outra, enquanto
   você deixar. O fechamento que já cumpre a garantia fica guardado o tempo
   todo: apertar só pode melhorar o número, nunca estragar o que você já tem.

Medido pela tela, em 20 números com jogos de 17: a escalada para em 160 cartelas
com 86,4%; a construção avançada fecha em 100% com **342**; a otimização leva
esse número a **317 em trinta segundos**, e continua caindo enquanto rodar. O
melhor fechamento conhecido para essa configuração tem 240.

O preço de passar do piso é deixar de ser o mínimo, e é exatamente isso que a
tela passa a dizer, trocando *"Mínimo exato"* por *"Solução encontrada: 317 ·
Mínimo comprovado: ≥ 160"*.

### Como se mede se o motor melhorou

Rodar uma configuração grande para descobrir se uma mudança ajudou custa minutos
e devolve um número só. O custo desestimula medir, e sem medida a única forma de
saber é a impressão de quem olhou.

`crates/motor-exato/tests/qualidade.rs` faz o contrário: doze configurações
**pequenas** cuja resposta é conhecida — os melhores fechamentos publicados, os
mesmos que a Lotinha distribui —, medidas em meia dúzia de segundos. A saída é a
razão entre o que o motor entrega e a referência, e é ela que se projeta para as
escalas que ninguém tem tempo de rodar:

| regime | configurações | razão |
|---|---|---|
| folga de 1 e 2 entre pool e jogo | 18/17, 20/18, 21/19, 22/20 … | **1,00×** — o motor acerta o melhor conhecido |
| folga de 3 | 20/17, 21/18, 22/19, 23/20 | **1,30× a 1,67×** |

A família varre o eixo de que a dificuldade depende, e é isso que autoriza a
projeção. Três mudanças já passaram por ela e duas foram reprovadas:

- **varrer o que sobrou** depois de fechar — cartelas que a ordem de chegada
  deixou e que já não fazem falta: **fica**;
- **movimento fino** na otimização, trocando uma dezena em vez de cartelas
  inteiras: **fica**, e entrega a mesma qualidade com um décimo do trabalho;
- **guloso mais largo**, escolhendo entre as candidatas de vinte e quatro alvos:
  **sai** — a razão média não se moveu e pool 20 com jogos de 18, que saía exato
  em 40 cartelas, passou a sair com 46;
- **recozimento simulado** com temperatura auto-calibrada: **sai** — piorou em
  toda a família. O motivo é o custo do movimento: em pool 23 com jogos de 20
  cada cartela cobre 15.504 alvos, uma troca custa trinta e um mil varreduras, e
  o orçamento inteiro dá seis mil movimentos. Recozimento com seis mil
  movimentos é um passeio aleatório sem tempo de voltar.

A folga que resta no regime duro é conhecida e tem endereço: os valores
publicados para essas configurações vêm de construções **simétricas** — buscar
órbitas de um grupo em vez de cartelas soltas —, e é por aí que se fecha.

**→ [Abrir o aplicativo](https://jefersondias043-code.github.io/Sonho-l-cido/)**

No iPhone, para virar um aplicativo de verdade: abra o link no Safari, toque no
botão de compartilhar e escolha **Adicionar à Tela de Início**. Depois disso ele
abre em tela cheia, com ícone próprio, e funciona **sem internet**.

Medido num navegador com perfil de iPhone: **168 mil iterações por segundo** —
cerca de metade da velocidade nativa.

Três coisas que valem saber antes de usar:

- **Quando a tela apaga, o iOS congela a página** e a busca para. Há um
  interruptor "manter a tela ligada" que evita isso; sem ele, a busca pausa e
  retoma quando você volta — o progresso fica salvo de qualquer forma.
- **O motor não para sozinho.** Nem quando já encontrou o menor fechamento que
  existe. Quem encerra é você, em Pausar ou Encerrar. A tela diz qual dos dois
  casos é o seu: quando o mínimo é comprovado, ela avisa que não há o que achar;
  quando é problema em aberto, avisa o piso e o quanto o motor já cortou.
- **O modo automático deixa o aparelho trabalhar por horas.** Quinze minutos de
  motor, dez de descanso, repetindo até você encerrar. O descanso é uma pausa de
  verdade — medido, o consumo da linha principal cai 95% e o motor não faz uma
  iteração sequer —, e o estado inteiro da otimização continua na memória, de
  modo que voltar não custa progresso nenhum.

A tela de **Configurações**, no rodapé de qualquer uma das quatro páginas, reúne
o que dá para saber sobre a instalação: qual carimbo de versão está rodando neste
aparelho, quanto ele ocupa, quantos fechamentos estão guardados, e um botão
**Buscar atualizações** que vai ao servidor e compara os dois carimbos. Quando
não dá para perguntar — sem internet, servidor fora —, ela diz isso, e não que
está tudo em dia: a diferença entre "conferi" e "não consegui conferir" é a razão
de o botão existir.

Para buscas longas, o computador continua sendo o lugar certo — e é para isso
que existe a linha de comando abaixo.

## No computador

```bash
cargo build --release
```

O binário sai em `target/release/sonho-lucido`.

### Criar um fechamento do zero

```bash
sonho-lucido criar --universo 60 --pool 16 --cartela 4 --cobrir 2 --tempo 5s
```

`--garantir ALVO:INTERSECAO` troca a cobertura completa por uma garantia parcial,
e `--premiadas R` exige que `R` cartelas atendam cada resultado em vez de uma.

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

Isto é da linha de comando. No aplicativo o ponto de partida é sempre o
fechamento pronto da Lotinha, e não há o que colar.

### O ponto de partida é escolhido, não obedecido

Quatro candidatos concorrem a cada partida, e todos custam milissegundos: o
fechamento pronto do aplicativo, o fechamento trazido pelo usuário, a construção
algébrica (quando existe) e o guloso com ruído. Todos são podados antes de serem
julgados, e vence o de menor custo pela mesma régua que a busca usa.

Semear de novo não descarta a semente anterior: a solução já escolhida entra
como mais um candidato. É o que permite oferecer duas fontes em sequência sem
que a segunda apague a primeira.

Comparar não é preciosismo. A primeira versão obedecia — importar instalava o
fechamento direto, sem podar e sem comparar — e isso produzia dois defeitos
medidos em `C(21,5,2)`:

- Um fechamento com as 21 cartelas ótimas mais 5 duplicatas entrava como 26. A
  poda tira as 5 de graça, e sem ela o motor nem percebia que já estava com o
  ótimo na mão: `optimalidade_provada` dava falso.
- Pior: nessa configuração a construção algébrica dá as 21 ótimas em
  milissegundos, e semear pulava `garantir_inicio`. **Trazer uma solução deixava
  o resultado pior do que não trazer nada.**

A tela mostra o que aconteceu — "partiu do seu fechamento", "das 26 que você
trouxe, 5 eram dispensáveis e saíram de graça", ou "partiu de PG(2,4), melhor
que as 40 que você trouxe". Aproveitar o trabalho já feito é o objetivo; jogar
fora um trabalho melhor que já estava disponível seria o contrário dele.

### A ferramenta Lotinha

O aplicativo inteiro. Escolhem-se de **17 a 25 dezenas** entre 25, o resultado
da Lotofácil é a referência, e ganha-se quando as 15 sorteadas caem **todas**
dentro do conjunto escolhido.

As bancas param em 23, e faz sentido para elas: acima disso o multiplicador cai
tanto que a aposta perde a graça. A ferramenta vai até 25 porque a matemática
vai — escolher as 25 é escolher o universo inteiro, e aí o sorteio cai dentro do
pool com **certeza**. O fechamento deixa de ser aposta condicional e vira
garantia.

São três eixos, e não um:

| eixo | o que muda |
|---|---|
| **quantas dezenas** (17 a 25) | a chance de o sorteio cair no seu conjunto |
| **tamanho do jogo** (17 ao pool) | quanto paga, e quantos jogos fecham |
| **quantos acertos garantir** (15 a 11) | 15 é o que a Lotinha paga; menos é Lotofácil |
| **quantas cartelas premiadas** (1 ao teto) | quantas das suas cartelas precisam ganhar |

#### A conta que quase todo mundo erra

Para fechar um pool de `P` dezenas com jogos de `k`, a intuição manda dividir os
sorteios pelo que cada jogo cobre. Isso **subestima por duas a três vezes** —
quem orça assim compra metade dos jogos e fica com um fechamento furado.

A conta certa vem de uma troca de ponto de vista: um jogo de `k` dentro de um
pool de `P` é o **complemento** de `a = P − k` dezenas, e um sorteio de 15 é o
complemento de `b = P − 15`. Então *o jogo contém o sorteio* ⟺ *as `a` que faltam
ao jogo estão entre as `b` que faltam ao sorteio*. O problema deixa de ser
"cobrir" e vira "caber": um **sistema de Turán**.

| pool | jogo | dividir sugere | verdade |
|---|---|---|---|
| 18 | 17 | 6 | **16** |
| 20 | 18 | 19 | **40** |
| 22 | 20 | 11 | **30** |

Conferido por força bruta num caso pequeno (pool 8, jogos de 7, sorteios de 5): a
verdade é 6, a divisão diz 3.

#### O que é sabido e o que está em aberto

Das 66 combinações de dezenas e tamanho de jogo, **38 têm mínimo comprovado** e
**28 são problema em aberto na matemática**. As comprovadas se repartem em quatro
famílias:

| família | quantas | por quê |
|---|---:|---|
| jogo = pool (`a = 0`) | 11 | aposta única, não há o que fechar |
| falta uma dezena (`a = 1`) | 10 | são sempre `15 + r` jogos, qualquer que seja o pool |
| faltam duas (`a = 2`) | 9 | teorema de Turán |
| jogo = 15 | 8 | cada cartela contém **um** sorteio, o igual a ela: são `C(P,15)` |

Nas 28 em aberto é que o motor persistente trabalha de verdade. O banco embutido traz o
melhor fechamento encontrado até agora, com o piso conhecido ao lado, e o usuário
pode deixar o motor procurando um menor.

#### Garantir mais de uma cartela premiada

Exigir que **duas ou três** cartelas ganhem, e não apenas uma. Custa mais — e às
vezes muito menos do que parece:

| cartelas premiadas | jogos, em 18 dezenas com jogos de 17 |
|---|---|
| 1 | **16** |
| 2 | **17** |
| 3 | **18** |

A segunda cartela premiada custa **um** jogo, não dezesseis. A fórmula fechada é
`15 + r` sempre que o jogo tem uma dezena a menos que o pool, e os três valores
são mínimos comprovados.

Há um teto: só `C(P−15, P−k)` jogos distintos podem conter um mesmo sorteio.
Naquele caso são 3, porque cada jogo é o pool menos uma dezena e o sorteio deixa
3 de fora — pedir a quarta obrigaria a comprar jogo repetido, e a tela avisa
antes de deixar.

No núcleo isso é a regra de cobertura contando até `r` em vez de até 1. O piso
não pode simplesmente multiplicar por `r`: Schönheim e a tabela publicada falam
de cobertura simples e não têm generalização automática. Mas continuam valendo
**inteiras**, porque toda solução que atende cada alvo `r` vezes o atende ao
menos uma. O piso final é o mais forte entre esse argumento e a cota de contagem,
essa sim multiplicada.

#### Garantir menos de 15 acertos

O motor sempre soube resolver garantia parcial; a tela passou a deixar pedir, de
15 a 11. E o painel financeiro precisou ficar honesto sobre uma coisa: **fechar
para menos de 15 não garante prêmio nenhum na Lotinha**, que paga o jogo com as
15 e só ele. A escolha faz sentido para a Lotofácil, que premia a partir de 11, e
a tela diz exatamente isso em vez de calcular um prêmio garantido inexistente.

### Checar um fechamento

Aba própria, e também um botão em cada fechamento carregado, em cada resultado
de busca e em cada trabalho do histórico. Escolhe-se o fechamento, informa-se o
resultado — digitado ou sorteado — e a ferramenta conta quantas cartelas fizeram
11, 12, 13, 14 e 15 acertos.

**Ela nunca regenera as cartelas.** Confere exatamente as que foram produzidas,
inclusive as que ficaram gravadas no histórico meses atrás. Regerar daria outro
fechamento do mesmo tamanho, igualmente válido e diferente, e a conferência
deixaria de descrever o que a pessoa tem na mão.

A separação que a tela faz questão de manter: **só 15 acertos é prêmio** nesta
modalidade. As faixas de 11 a 14 aparecem porque medem o quanto o fechamento
chegou perto — são cobertura, não premiação, e a tela diz isso com todas as
letras.

Também simula muitos sorteios de uma vez — 10, 100, 1.000 ou 10.000 — e resume
em quantos deles apareceu ao menos uma cartela de cada faixa, com média, mínimo
e máximo. Medido num fechamento de 24 dezenas com jogos de 17, que tem 26.837
cartelas: a conferência de um resultado leva 0,4 s, e mil sorteios levam 1,1 s
num worker separado, com a tela respondendo o tempo inteiro. A partir de dois
milhões de comparações o trabalho vai para o worker; abaixo disso não vale a
viagem.

Um número que a simulação confirma e que serve de aferição: nesse fechamento,
387 de 1.000 sorteios tiveram alguma cartela com 15 acertos. O esperado é
`C(24,15)/C(25,15) = 40%`, porque é a chance de as 15 sorteadas caírem todas
dentro das 24 escolhidas.

E o que a ferramenta repete sempre que mostra uma simulação: **simulação não é
previsão**. Um fechamento garante cobertura, não sorte, e frequência observada
não muda a chance do próximo sorteio.

#### Três opiniões independentes sobre a cobertura

Um fechamento que afirme cobrir e não cubra é o pior defeito que esta ferramenta
poderia ter. Contra isso há três verificações que não compartilham código:

1. o gerador confere cada solução antes de gravá-la no banco;
2. o aplicativo reconfere na tela, sem consultar o motor que a produziu;
3. `web/testar-lotinha.mjs` confere de novo, com um algoritmo ingênuo escrito de
   propósito para não repetir a ideia dos outros dois.

A conferência do aplicativo não pergunta "alguém cobre?" — ela conta quantos
jogos atendem cada sorteio e compara com a exigência pedida. Um fechamento que
prometesse duas cartelas premiadas e entregasse uma passaria batido pela pergunta
antiga. No pool de 25 são 3.268.760 sorteios conferidos um a um.

#### Três caminhos, do mais barato ao mais caro

O aplicativo não manda o motor buscar o que já se sabe. Para cada pedido ele
tenta, nesta ordem:

1. **O banco embutido** — o melhor fechamento já encontrado, pronto de fábrica.
2. **A fórmula** — a construção por grupos, que sai em milissegundos.
3. **O motor** — busca de verdade, quando os dois primeiros não alcançam.

A diferença é grande. Em 25 dezenas com jogos de 22, o motor gastava seis
segundos e 39 MB para chegar a 139 jogos; a fórmula dá **78** em menos de um
milissegundo. Em 38 das 66 combinações a construção **é** o mínimo comprovado —
não há o que melhorar.

Por isso, nos pools de 24 e 25 ele deixou de partir sozinho: o fechamento aparece
pronto e um botão oferece a busca por um menor, para quem quiser gastar a bateria
nisso.

#### O banco guarda o que falta, não o que está

Cada linha do banco lista as posições **ausentes** do jogo. Um jogo de 17 dezenas
num pool de 23 é o complemento de 6 — guardar 6 números em vez de 17 corta o
arquivo em 65%, e o banco inteiro em 69%.

É a mesma troca de ponto de vista que dá os valores exatos da modalidade, agora
aplicada ao armazenamento. E o ganho não é o arquivo: é o que ele permite. No
mesmo espaço cabem **44 das 66 combinações** prontas de fábrica, contra as 28 de
antes. Quanto mais vem pronto, menos o celular precisa calcular.

A que fica de fora é `(25,17)`, com 81.556 jogos — quase 2 MiB, para descrever
uma compra de oitenta e um mil reais. Ali a fórmula e o motor continuam
disponíveis sob demanda.

O banco cobre o caso padrão: garantir as 15 numa cartela. Nas demais exigências a
fórmula ainda atende boa parte, e o motor cobre o resto — a tela diz em qual dos
casos você está em vez de fingir que sempre tem resposta pronta.

#### O motor financeiro, separado do combinatório

As cotações não estão no código: variam por banca, não são auditadas, e quem as
conhece é o usuário. O painel mostra os dois ramos **sempre juntos** — o que
ganha e o que perde — porque o ramo vencedor de um fechamento é sedutor (16 jogos
de 17 dezenas custam R$16 e pagam milhares) e mostrá-lo sozinho seria enganoso: o
outro ramo acontece em mais de 99% das vezes.

E o painel diz o que a matemática obriga: como a aposta é binária, o retorno
esperado é fixo por jogo e apenas soma. **Nenhum arranjo de fechamento o altera.**
Fechar muda quando se ganha, nunca quanto em média.

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

## A referência mundial embutida

O motor não trabalha sozinho. Embutidas no aplicativo estão as **8.759
configurações catalogadas** da [La Jolla Covering
Repository](https://github.com/dmgordo/LJCR) — para cada `C(v,k,t)`, o melhor
resultado que a humanidade já produziu e o melhor limite inferior já provado.
São 134 KiB de texto, funcionam sem internet, e servem a duas coisas.

**Situar o resultado.** A tela mostra "27 cartelas · melhor do mundo: 21 ·
faltam 6". Um número sozinho não diz nada: 27 cartelas é excelente numa
configuração e medíocre em outra.

**Saber quando parar.** Em 4.317 das 8.759 configurações (49%) o limite já
provado na literatura é maior que a cota de Schönheim — e em nenhuma ele é
menor. Não é detalhe acadêmico: em `C(13,5,2)` Schönheim diz 8, mas já está
provado que o mínimo é 10. Sem o limite publicado, o motor encontra as 10
cartelas ótimas em segundos, **não reconhece que terminou**, e segue procurando
para sempre uma solução de 9 que não existe.

`melhor_conhecido` é um teto (alguém já construiu); `limite_publicado` é um piso
(está provado que nada menor existe). Só o segundo pode sustentar uma declaração
de optimalidade — trocá-los faria o aplicativo cravar "ótimo provado" em cima de
um recorde que ainda pode cair.

### O aplicativo que recusa essa referência

O **motor exato** não usa nada disso, e a recusa é o ponto dele. A tabela
da La Jolla é trabalho de outras pessoas; um aplicativo que a exibe como
resposta está mostrando o que sabem, não o que ele sabe. Ali, todo número é
calculado no aparelho — e onde o cálculo não alcança, os dois números aparecem
separados:

```
Solução encontrada: 10 · Mínimo comprovado: ≥ 8
```

Em `C(13,5,2)` ele encontra as 10 cartelas ótimas sozinho e prova apenas `≥ 8`.
A diferença de 2 é honestidade: a literatura chegou ao 10 com trabalho
computacional pesado, e emprestá-lo seria passar por nosso o que é de outros.

O que ele **consegue** provar por conta própria, com uma varredura completa e
poda por cotas, dominância e simetria:

| caso | cota fechada | o que ele prova | como |
|---|---|---|---|
| `C(9,4,2)` | 7 (Schönheim) | **= 8** | varredura completa |
| `C(10,4,2)` | 8 (contagem) | **= 9** | varredura completa, 24 milhões de nós |
| `C(11,5,3)` | 18 (Schönheim) | **≥ 20** | `C(10,4,2) = 9`, elevado |

Fora do covering design puro — sorteio diferente da garantia, ou mais de uma
cartela premiada — **só a cota de contagem vale**, e o aplicativo diz isso na
tela. Schönheim e a elevação do subproblema falam de cobertura simples com
`j = t`; esticá-las até ali inventaria um piso, que é o pior erro possível numa
ferramenta que existe para dizer o que está provado.

A última linha é a que interessa. A recorrência de Schönheim eleva **qualquer
piso válido** de `C(v−1,k−1,t−1)` até `C(v,k,t)`; alimentada com a própria cota
ela se reproduz, mas alimentada com o mínimo exato do subproblema — varrido ali
mesmo — ela sobe dois degraus de uma vez. É a porta pela qual a exaustão de um
caso pequeno vira matemática de um caso grande, sem tabela nenhuma no meio.

Duas recorrências plausíveis foram escritas e apagadas ao construí-lo: a de de
Caen, como eu a redigi, dava 9 para o plano de Fano, que tem 7 blocos; e uma
elevação por remoção de ponto dava 44 para um problema com solução de 30. Uma
cota inferior errada é pior que nenhuma — ela faz o programa dizer "mínimo
provado" sobre o que não é mínimo. Por isso os testes daquele crate não
consultam tabela: constroem, mandam o verificador conferir alvo por alvo, e
cobram que nenhuma cota passe por cima da coleção que existe.

### E para garantias parciais, que é o uso mais comum

Um fechamento de loteria quase nunca é uma cobertura completa: o usual é
*"garantir 4 acertos se saírem 6"*, com `alvo = 6` e `intersecao = 4`. A tabela
não cataloga esses — e a primeira versão do aplicativo respondia "sem referência
publicada" para eles. Tecnicamente correto, e praticamente inútil.

Mas a tabela **tem** o que dizer, por um argumento curto: se toda `t`-upla do
pool está contida em alguma cartela, então qualquer sorteio de `j ≥ t` números
contém uma `t`-upla que alguma cartela cobre inteira — e portanto acerta ao menos
`t`. Logo o melhor conhecido para `C(pool, cartela, t)` é um **teto válido** para
a garantia parcial.

Em `pool 20, cartela 6, garantir 4` o teto é 382 cartelas e o motor entrega 114.
Um teto folgado, mas um número real e publicado, muito melhor que nada.

O que esse teto **não** é: limite inferior. O limite publicado de
`C(pool, cartela, t)` vale para a cobertura completa, não para a garantia parcial
— que se resolve com muito menos. Por isso `limites.rs` só aceita a tabela quando
`alvo == intersecao`; confundir os dois faria o motor declarar impossível o que
ele mesmo acabou de encontrar. O argumento do teto é conferido por enumeração nos
testes, não por raciocínio escrito.

## Construções algébricas: a etapa rápida

Alguns formatos têm solução ótima por fórmula, sem busca nenhuma. O plano
projetivo `PG(2,q)` resolve `C(q²+q+1, q+1, 2)`; o plano afim `AG(2,q)` resolve
`C(q², q, 2)`. Ambos em milissegundos, e ambos provadamente ótimos.

Isso importa porque eram exatamente os casos em que a busca falhava. `C(21,5,2)`
é `PG(2,4)` e `C(25,5,2)` é `AG(2,5)`: objetos de estrutura rígida, cuja solução
ótima não tem vizinhança — qualquer troca de um elemento a destrói. Busca local
não chega lá por acidente, por mais horas que rode.

Quando o pool não bate exatamente com um plano, a construção é **truncada** para
o tamanho pedido, e as retas encurtadas são recompletadas. Guloso e construção
competem a cada partida, e vence quem produzir menos cartelas — de modo que
acrescentar as construções nunca piora nenhum caso.

## Aferição contra a literatura

`cargo run --release --example aferir` roda o motor contra a tabela mundial. Os
números de comparação não estão escritos no teste: vêm da própria tabela.

| Configuração | Melhor do mundo | Encontrado | Ótimo provado | Iterações | Partida |
|--------------|-----------------|------------|---------------|-----------|---------|
| C(7,3,2)     | 7   | 7   | sim | 0      | plano projetivo PG(2,2) |
| C(9,3,2)     | 12  | 12  | sim | 0      | plano afim AG(2,3) |
| C(10,3,2)    | 17  | 17  | sim | 626    | construção gulosa |
| C(11,3,2)    | 19  | 19  | sim | 1.200  | construção gulosa |
| C(12,3,2)    | 24  | 24  | sim | 1.616  | construção gulosa |
| C(13,3,2)    | 26  | 26  | sim | 54.942 | construção gulosa |
| C(8,4,3)     | 14  | 14  | sim | 683    | construção gulosa |
| C(13,4,2)    | 13  | 13  | sim | 0      | plano projetivo PG(2,3) |
| C(16,4,2)    | 20  | 20  | sim | 0      | plano afim AG(2,4) |
| C(21,5,2)    | 21  | 21  | sim | 0      | plano projetivo PG(2,4) |
| C(25,5,2)    | 30  | 30  | sim | 0      | plano afim AG(2,5) |

**11 de 11 no melhor conhecido do mundo.** Cinco deles sem uma única iteração de
busca. Antes das construções algébricas eram 9 de 11, com `C(21,5,2)` parando em
27 cartelas e `C(25,5,2)` em 39.

### E onde o motor ainda fica atrás

Casos escolhidos a dedo favorecem quem os escolheu. Por isso a aferição também
varre a faixa inteira sem perguntar nada — 223 configurações, 1 segundo cada:

| Distância do melhor do mundo | antes da descida | com a descida |
|------------------------------|------------------|---------------|
| empatou ou superou           | 93 (41,7%)       | **130 (58,3%)** |
| até 5% acima                 | 16 (7,2%)        | 16 (7,2%)     |
| de 5% a 20% acima            | 45 (20,2%)       | 42 (18,8%)    |
| mais de 20% acima            | 69 (30,9%)       | **35 (15,7%)** |

As duas colunas são o mesmo segundo por caso. O que mudou entre elas foi a
descida por troca de ponto, a construção de Turán e o ranqueamento colex fundido
na intercalação: os empates com o melhor do mundo saíram de 41,7% para 58,3%, e
os casos a mais de 20% de distância caíram pela metade.

Uma medida que **não** entrou: pôr o guloso global também como candidato a
partida dentro do motor. Parecia óbvio — é onde não há construção fechada que o
motor mais fica atrás — e a aferição desmentiu. Ela troca cinco empates por três
casos ruins a menos, e cobra cinco segundos por caso; `C(30,7,3)` piora de 236
para 288 cartelas. O guloso global fica só no gerador, onde há tempo para ele
rodar até o fim e onde a comparação escolhe entre as três construções.

O que ele **não** move são os casos difíceis. `C(26,6,3)` sai de 246 para 233
cartelas contra as 130 do mundo: continua 79% acima. As piores estão todas em
`t = 3` com pool grande, que é justamente onde não existe construção fechada
neste projeto. Ali a distância é de algoritmo, não de relógio — dar mais tempo
não resolve, e é o próximo lugar onde vale trabalhar.

### Três tentações medidas e descartadas

A meta desce de uma cartela por vez. É a parte do motor que mais parece
desperdício — se o fechamento tem 3.495 cartelas e o piso provado é 1.537, por
que perseguir 3.494? Três respostas para isso foram escritas e medidas, e as três
perderam.

A razão de todas falharem é a mesma, e é estrutural: **a meta é um teto, não um
alvo.** A reconstrução para de acrescentar cartelas ao chegar nela, e a solução
atual é cortada até ela. Baixar a meta aperta a busca; não a solta.

| tentação | o que se mediu |
|---|---|
| meta no limite inferior | **zero recordes** em `(21,17)`, `(22,17)`, `(23,18)` e `(25,20)`. Na aferição contra a tabela mundial, os empates caíram de 41,7% para 48,4% de distância e `C(26,6,3)` saiu de 246 para 288 cartelas |
| passo dobrando por limiar fixo | perde 3×1 em `(22,17)` e 4×0 em `(23,18)`, e perde o melhor-de-seis nos dois |
| passo auto-calibrado pela média | idêntico ao unitário em `(21,17)`; perde 5×1 em `(22,17)` |

O padrão do passo grande é sempre o mesmo: um salto que fecha, e depois a busca
trava numa meta que não alcança. Em `(22,17)` ela para em exatamente 3.489 nas
seis sementes, enquanto o passo de uma faz 39 quedas de uma cartela e chega a
3.483.

Vale separar duas coisas que se confundem ao ver a meta andar de um em um: o
**teto** desce de uma cartela por vez, mas o **recorde** cai do tamanho que a
poda conseguir. Uma iteração que fecha a cobertura e descobre cinco cartelas
supérfluas registra as cinco de uma vez — há um teste que exige exatamente isso.
O motor nunca esteve proibido de cortar em bloco.

As políticas ficam em `PassoDaMeta`, para quem quiser medir de novo sem mexer no
motor. O padrão é `Unitario`, e um teste impede que outra volte a sê-lo sem nova
medição.

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
│   ├── limites          limites inferiores: Schönheim, contagem e publicado
│   ├── referencia       melhor conhecido no mundo (La Jolla, 8.759 casos)
│   ├── planos           construções algébricas: PG(2,q) e AG(2,q)
│   └── texto            interpretador de fechamentos, um só para CLI e web
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
├── motor-web/           a ponte para o navegador, via WebAssembly
│
├── motor-exato/         o motor exato — sem dependência dos outros
│   ├── problema         o modelo formal, e o verificador
│   ├── limites          só cotas com demonstração escrita: contagem, Schönheim
│   ├── escalada         a cobertura sobe; o número de cartelas para no piso
│   ├── construtor       usado só nos subproblemas de que o piso precisa
│   ├── prova            ramifica-e-poda: existe alguma coisa menor?
│   └── veredito         onde construção e prova se encontram — ou não
│
└── motor-exato-web/     a ponte do motor exato, num módulo separado

web/                     a interface da plataforma
├── index.html           a ferramenta, e app.js / trabalhador.js / historico.js
├── motor-exato.js    o motor exato dentro dela, e motor-exato-trabalhador.js
├── aritmetica.js    a aritmética da conferência e do dinheiro, sem DOM
├── exato-checador.js    o trabalhador das simulações longas
├── historico-exato.js   os fechamentos guardados, com o estado do motor junto
├── sessao-exato.js      o arquivo de fechamento: exportar e importar
├── veredito.js    a regra do que pode ser afirmado, sem DOM e sem wasm
├── lotinha.js           a modalidade: banco, construção algébrica e mínimos
├── checagem.js          a conferência de um resultado, e checador.js
├── comum.js             a aritmética que todos usam, num lugar só
├── armazem.js           o armazenamento partilhado, com aparo educado
├── configuracoes.html   atualização, espaço e volta aos padrões de fábrica
└── sw.js                funcionamento sem internet e atualização automática
```

O mesmo motor atende os dois caminhos. A versão do celular não é uma
reimplementação simplificada: é exatamente o código validado pelos mesmos 185
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
`N − 1`. Por que `N − 1` e não um salto até o piso, quando o piso é conhecido e
está muito abaixo: veja as três tentações medidas mais acima.

Isso transforma um problema de otimização difuso em uma sequência de problemas
de viabilidade bem definidos, cada um com um gradiente claro para seguir. O
mesmo mecanismo atende cobertura máxima sob orçamento: a meta simplesmente para
de descer.

#### O passo grande e o passo pequeno

Por muito tempo o laço só sabia dar passos grandes: destruía cartelas inteiras e
montava cartelas inteiras. Montar uma cartela custa avaliar `C(k,t)` alvos **por
candidato testado**, então quando a solução já está na meta e faltam poucos
alvos, o passo é grande demais — a reconstrução descobre outros alvos enquanto
cobre os que faltavam, e a iteração termina revertendo. Medido a partir do banco
publicado: sessenta segundos em 24 dezenas com jogos de 17 tiravam **quinze**
cartelas de trinta e duas mil.

O passo pequeno é trocar **uma dezena de uma cartela** — o método de Nurmela e
Östergård para covering designs. Mantém a cardinalidade, mexe em pouca coisa, e
é guiado por um alvo ainda descoberto. Entra exatamente onde o laço antigo
desistia, e o orçamento de trocas acompanha o tamanho do buraco.

#### Guloso global: comparar todas as cartelas, não uma amostra

A construção padrão monta cada cartela dezena a dezena e, em cada posição,
avalia uma **amostra** dos candidatos. É gulosa dentro da cartela e cega fora
dela. O guloso global compara todas as `C(p,k)` cartelas a cada passo, e é
viável porque a nota de um candidato só pode cair conforme a solução cresce —
o que permite uma fila de prioridade preguiçosa.

Ele não ganha sempre, e por isso entra como **mais um candidato a ponto de
partida**, não no lugar de ninguém: ganha onde faltam muitas dezenas ao jogo,
onde a construção fechada é grosseira e a solução tem milhares de cartelas; e
perde onde a fórmula já é quase ótima. Quem decide é a comparação — a coluna
`origem` do gerador diz de qual das três o número saiu.

`cargo run --release --example bancada -- 90 23,19 24,18` roda as estratégias
lado a lado, a partir do mesmo fechamento e pelo mesmo tempo. É de lá que saem
os números acima; sem isso, "o motor melhorou" seria opinião.

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

Quando `LB == UB`, e só então, o resultado é declarado **ótimo provado**. Em
qualquer outro caso o sistema diz apenas *"melhor solução conhecida: N
cartelas"*, porque é só isso que ele sabe.

Provar a optimalidade muda o que a tela **diz**, não se o motor continua. No
celular ele nunca encerra por conta própria: quem para é o usuário, em Pausar
ou Encerrar. A decisão de desligar depende de saber se ainda há o que achar, e
essa informação está na tela — mas a decisão é de quem paga a bateria. Na linha
de comando o padrão é o oposto, porque ali o processo precisa terminar para
devolver o terminal; `--sem-parar-no-otimo` inverte.

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
- **Coberturas de trincas em pool grande ficam bem acima do melhor conhecido.**
  C(26,6,3) fica 89% acima com um segundo de busca, e ainda 79% acima com dez —
  dar mais tempo quase não move. É onde não há construção algébrica que sirva de
  atalho, e é a limitação mais séria que o motor tem hoje.
- **Execução em um núcleo só.** O motor é sequencial. Buscar em paralelo, com
  arquivo de elites compartilhado, é o próximo ganho grande. No navegador isso
  esbarra num limite adicional: threads em WebAssembly exigem cabeçalhos HTTP
  que o GitHub Pages não permite configurar.
- **No celular, a busca para quando a tela apaga.** É o iOS suspendendo a
  página, não um defeito do motor. O interruptor de manter a tela ligada
  contorna, e o progresso é salvo de todo jeito.

## Desenvolvimento

```bash
cargo test --workspace                          # 199 testes
cargo clippy --workspace --all-targets -- -D warnings
cargo run --release --example aferir            # aferição contra a tabela mundial

./ferramentas/atualizar-referencia.py           # rebaixa a tabela da La Jolla

./construir-web.sh                              # monta o site em site/
./testar-construcao.sh                          # testa a construção em si
node web/testar.mjs                             # testa a interface na raiz
node web/testar.mjs /Sonho-l-cido/              # testa sob a subpasta do Pages
node web/testar-atualizacao.mjs                 # testa a atualização automática
node web/testar-historico.mjs                   # testa o histórico de trabalhos
node web/testar-lotinha.mjs                     # testa a ferramenta
node web/testar-checagem.mjs                    # testa a conferência de acertos
node web/testar-construtor.mjs                  # testa o Construtor
node web/testar-exato.mjs                       # testa o motor exato na ferramenta
node web/testar-aritmetica.mjs              # a aritmética do dinheiro, sem navegador
node web/testar-historico-exato.mjs             # o histórico e o arquivo, sem navegador
node web/testar-veredito.mjs              # o que ele tem direito de afirmar
cargo run --release --example gerar-lotinha     # regera o banco de fechamentos

python3 -m http.server -d site 8000             # experimenta localmente
```

O teste do navegador roda a interface num Chromium com viewport de iPhone,
carrega dois fechamentos e **confere a cobertura do que está na tela em
JavaScript** — sem tocar no código Rust que a produziu, e depois de o motor ter
tido a chance de reorganizar o resultado. Foi ele que revelou defeitos que
nenhum teste unitário pegaria: uma mensagem perdida entre a interface e o worker
durante o carregamento do WebAssembly, um parâmetro `u64` que o JavaScript
recusava por esperar `BigInt`, e um `display: inline-block` que fazia o selo
"★ ótimo provado" ficar visível em toda busca, inclusive nas que não tinham
provado nada.

Os dois fechamentos são escolhidos pelo que provam. **18 dezenas com jogos de
17** tem mínimo comprovado — 16 jogos, e não há menor: é onde se verifica que o
motor **não para** ao alcançá-lo. **20 dezenas com jogos de 17** tem mínimo
desconhecido e roda indefinidamente: é onde o relógio, a pausa e o encerramento
são exercitados.

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
