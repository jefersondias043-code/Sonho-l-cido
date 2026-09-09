# O aplicativo de fechamentos da Lotofácil

Um segundo aplicativo, ao lado do motor. Ele responde a **duas** perguntas, e a
segunda existe porque a primeira, sozinha, deixava gente de fora:

> *"Como gasto melhor este dinheiro na Lotofácil?"*
>
> *"Quero este fechamento aqui — me dá os bilhetes."*

Na primeira, a pessoa diz quanto quer gastar e quais dezenas quer jogar; o
aplicativo escolhe o fechamento. Na segunda, ela escolhe o fechamento e o
aplicativo diz quanto custa. Em qualquer das duas, o que volta são os bilhetes
prontos e, numa frase, o que exatamente está garantido.

As duas usam o mesmo catálogo, a mesma tela e o mesmo caminho de resposta — o que
muda é só quem decide. Nada foi tirado da primeira para a segunda existir.

E depois de gerar vem uma terceira coisa, que não é perguntar nem responder: é
**olhar o que se comprou**. Cartelas, conferência contra o concurso, simulação
de mil sorteios e a conta do dinheiro moram numa área própria, descrita em
[Gerar e analisar são dois assuntos](#gerar-e-analisar-são-dois-assuntos).

## O que o dinheiro compra

Não é figura de retórica: é o catálogo respondendo. A pessoa diz quanto tem, e o
aplicativo escolhe o maior pool que cabe no bolso e, dentro dele, a maior
garantia paga — nesta ordem, porque garantia alta num pool pequeno é uma promessa
que quase nunca se cobra.

<!-- a tabela do dinheiro: gerada por ferramentas/numeros-do-catalogo.py -->
| orçamento | dezenas | garantia | fechamento | custo | |
|---:|---:|---|---|---:|---|
| R$ 5,00 | 19 | — | 1 bilhete de 15 dezenas | R$ 3,50 | não é fechamento |
| R$ 25,00 | 22 | **11 acertos** | 6 jogos de 15 dezenas | R$ 21,00 | piso 3 |
| R$ 100,00 | 24 | **11 acertos** | 24 jogos de 15 dezenas | R$ 84,00 | piso 7 |
| R$ 400,00 | 25 | **11 acertos** | 50 jogos de 15 dezenas | R$ 175,00 | piso 10 |
| R$ 1.500,00 | 25 | **12 acertos** | 325 jogos de 15 dezenas | R$ 1.137,50 | piso 55 |
| R$ 15.000,00 | 25 | **13 acertos** | 3525 jogos de 15 dezenas | R$ 12.337,50 | piso 671 |
<!-- fim de a tabela do dinheiro -->

A primeira linha é a mais importante do produto: com cinco reais não há
fechamento, e a tabela diz isso em vez de ficar calada. A dos quatrocentos é o
produto inteiro num lugar só — as vinte e cinco dezenas inteiras, onze acertos
garantidos, e troco. Ninguém compõe isso de cabeça.

A última coluna diz o que se pode afirmar de cada linha: **mínimo provado**
quando nenhum fechamento faz aquilo com menos bilhetes, e o piso conhecido
quando não.

Nenhum número acima está escrito à mão — nem no texto ao redor, de propósito: um
preço citado em prosa é o que envelhece primeiro.

O troco aparece dizendo o que é: *"sobram tanto, que não compram garantia
maior"*. Não é figura de linguagem nem consolo — é o degrau seguinte custando
mais do que se tem, e o aplicativo não empurra bilhete a mais para gastar o
resto. Comprar mais bilhetes com o troco aumenta a chance de prêmio e **não**
aumenta a garantia, que é a única coisa que este aplicativo sabe prometer.

A tabela sai de `ferramentas/numeros-do-catalogo.py --gravar`, que a reescreve
aqui a partir de `catalogo/indice.json`. Cada passada do motor pode mudá-la, e um
preço velho num documento é uma promessa que o aplicativo não cumpre mais.

## Um bilhete não é fechamento

Com dinheiro para um bilhete só, a tela chegava a dizer **"11 acertos
garantidos"**. Era verdade e era engano: um bilhete não tem com quem se
completar, e a garantia ali é tautologia — ele acerta o que acertar. Pior, num
pool de 19 dezenas esse bilhete leva 15, e as outras quatro que a pessoa marcou
nunca são jogadas; a tela não dizia isso.

Agora a manchete é o que ela comprou:

> **1**
> bilhete de 15 dezenas
> R$ 3,50
>
> *Um bilhete não é fechamento: não há vários jogos se completando para cobrir o
> que falta a cada um, então não há garantia a comprar — só a sorte de sempre. E
> das suas 19 dezenas, só 15 entram nele.*

E a linha do degrau deixa de partir de uma garantia que a tela não anunciou:
*"por mais R$ 10,50 você compra 4 bilhetes que se completam e garantem 12
acertos"*.

Um caso do mesmo tipo: marcar exatamente as quinze dezenas favoritas é o que
muita gente faz de primeira, e ali não há fechamento nenhum — com 15 dezenas o
bilhete **é** o pool, e não há degrau acima. A tela dizia *"não há garantia
maior para comprar com 15 dezenas"*, que é verdade e é uma saída sem porta.
Agora diz o que fazer: *"com 15 dezenas não há fechamento a comprar: marque mais
dezenas"*.

Que só o fechamento de um bilhete deixe dezenas de fora não é observação: é
cobrado em `conferir-tudo`, entrada por entrada. Se um fechamento de vários
jogos passasse a ignorar uma dezena, o aplicativo pediria para marcar 25 e
jogaria 24 sem dizer nada — o tipo de silêncio que só aparece quando alguém
confere o bilhete impresso.

## A garantia pedida virou pergunta com resposta

`garantiaMinima` atravessava o aplicativo inteiro — o esquema do servidor, o
leitor por expressão regular, a validação do cliente — e chegava num filtro que
não filtrava nada: ele escolhia entre "a maior garantia que cabe" e "a maior
garantia que cabe". Quem escrevia *"quero garantir 14"* tinha o 14 lido,
validado e descartado em silêncio.

Agora ele responde à pergunta que foi feita:

> *Garantir 14 acertos com 20 dezenas custa R$ 1.540,00 — faltam R$ 1.240,00.*

É a outra metade do produto. O aplicativo já dizia o que o dinheiro compra;
passou a dizer também quanto custa o que a pessoa quer.

## O catálogo encolheu, e isso é dinheiro de volta

Dezessete fechamentos publicados receberam tempo de motor — noventa segundos por
caso na primeira passada, quarenta minutos por caso nas últimas —, sempre
partindo do que já estava publicado. **Os dezessete encolheram.**

| caso | antes | agora | quanto sai da conta de quem compra |
|---|---:|---:|---:|
| 23 dezenas, cartela de 15, garantindo 13 | 872 | **694** | −R$ 623,00 (20,4%) |
| 23 dezenas, cartela de 16, garantindo 12 | 33 | **27** | −R$ 336,00 (18,2%) |
| 23 dezenas, cartela de 16, garantindo 13 | 218 | **180** | −R$ 2.128,00 (17,4%) |
| 22 dezenas, cartela de 15, garantindo 14 | 5.016 | **4.184** | −R$ 2.912,00 (16,6%) |
| 24 dezenas, cartela de 15, garantindo 13 | 1.902 | **1.631** | −R$ 948,50 (14,2%) |
| 25 dezenas, cartela de 17, garantindo 13 | 320 | **278** | −R$ 19.992,00 (13,1%) |
| 25 dezenas, cartela de 16, garantindo 13 | 1.070 | **938** | −R$ 7.392,00 (12,3%) |
| 25 dezenas, cartela de 16, garantindo 12 | 130 | **114** | −R$ 896,00 (12,3%) |
| 22 dezenas, cartela de 16, garantindo 13 | 89 | **79** | −R$ 560,00 (11,2%) |
| 21 dezenas, cartela de 16, garantindo 14 | 303 | **272** | −R$ 1.736,00 (10,2%) |
| 21 dezenas, cartela de 15, garantindo 14 | 1.578 | **1.431** | −R$ 514,50 (9,3%) |
| 24 dezenas, cartela de 16, garantindo 12 | 63 | **58** | −R$ 280,00 (7,9%) |
| 24 dezenas, cartela de 15, garantindo 12 | 173 | **167** | −R$ 21,00 (3,5%) |
| 23 dezenas, cartela de 15, garantindo 12 | 82 | **80** | −R$ 7,00 (2,4%) |
| 20 dezenas, cartela de 16, garantindo 14 | 92 | **90** | −R$ 112,00 (2,2%) |
| 25 dezenas, cartela de 15, garantindo 13 | 3.634 | **3.608** | −R$ 91,00 (0,7%) |
| 25 dezenas, cartela de 15, garantindo 12 | 331 | **330** | −R$ 3,50 (0,3%) |

Somando o que cada um deixou de custar, são **R$ 38.552,50** que saem da conta de
quem compra esses dezessete fechamentos.

O de R$ 15.000 é o que a escada oferece a quem tem esse dinheiro, e agora custa
**R$ 12.628,00** em vez de R$ 12.719,00. O de R$ 1.500 caiu de R$ 1.158,50 para
**R$ 1.155,00**.

Cinco rodadas, e nenhuma voltou de mãos vazias — inclusive as que reincidiram
sobre casos já melhorados: 25-17-13 caiu de 320 para 285 numa passada e de 285
para 278 na seguinte; 24-15-13 fez 1.902 → 1.657 → 1.631. A leitura que interessa
não é "o catálogo melhorou": é que **ele não está convergido**, e que cada
passada com mais máquina ainda acha. Nenhum caso escolhido pela lista de
prioridade ficou onde estava. Quem mantiver isto sabe onde gastar horas — e sabe
que ainda há o que achar.

Nada disso entra sem a varredura: `conferir-tudo`, que não compartilha uma linha
com o gerador, refez os **249.307.987** sorteios das 330 entradas contra o
catálogo novo. Um fechamento menor que não cobre tudo não é recorde, é defeito.

Vale registrar o que a mesma quantidade de motor **não** achou. Os quatro casos
cujo piso cabe abaixo do teto de publicação — 25-16-14, 23-17-15, 23-15-14 e
25-18-15 — receberam vinte e cinco minutos cada e nenhum desceu das oito mil
cartelas.

E aqui o gerador estava escondendo o número que decide se vale insistir. A linha
dizia só *"acima do teto"*, sem dizer **quanto** acima: faltou pouco ou muito?
Agora ela mostra o que o motor alcançou, entre parênteses, e a resposta muda o
plano:

| caso | piso | onde o motor chega | teto |
|---|---:|---:|---:|
| 23-17-15 | 3.996 | **10.051** | 8.000 |
| 25-18-15 | 5.121 | **14.875** | 8.000 |
| 25-16-14 | 3.014 | **15.495** | 8.000 |

O de 23 dezenas está 26% **acima** do teto — perto o bastante para valer horas.
Os outros dois, não. Sem o número, os três pareciam iguais.

### O teto conta cartelas, e não dinheiro

Perseguir 23-17-15 tem um porém que a mesma medição revela. O teto de 8.000
nasceu como fronteira econômica: oito mil cartelas de 15 dezenas custam mais de
vinte mil reais. Mas ele conta **cartelas**, e oito mil cartelas de 17 dezenas
custam **R$ 3,8 milhões**; de 20 dezenas, R$ 434 milhões. No catálogo publicado
há vinte fechamentos acima de R$ 1 milhão, e o mais caro custa
**R$ 59.907.456,00** — todos dentro do teto.

Fica assim de propósito: o modo manual mostra o preço ao lado, e ver "R$ 59
milhões" ensina por que ninguém fecha com cartela de 20. Trocar o teto por um em
reais é decisão de produto, não conserto. O que não podia continuar é o
comentário da constante dizendo o que ela não faz — e esse foi reescrito.

## Quanto isso devolve, em média

Ao lado de *"em média os dois pagam o mesmo"* — que era uma frase que se lê como
consolo — agora vem o número:

> *…que aqui é **R$ 44,91** por concurso nas faixas de 11, 12 e 13 acertos —
> mais o que sair de 14 e 15, que é rateado e ninguém sabe de antemão.*

Contra R$ 175,00 gastos. É exato e é hipergeométrico, não simulado: sai das
distribuições de `acaso.json` por diferença, e a suíte refaz a mesma média
direto da definição, sem tocar no arquivo, para as duas baterem ao centavo. Um
bilhete simples devolve **25,7%** do que custa nas faixas fixas — e é o mesmo
para qualquer arranjo dos mesmos bilhetes, que é justamente o que faz dele a
prova de que o fechamento compra certeza, e não lucro.

### Todo número da tela, refeito de fora

Depois do conserto, os números que a tela mostra para quatro fechamentos foram
recolhidos do navegador e recalculados em Python, do zero — hipergeométrica,
binomiais e tabela de preços, sem tocar em nenhum arquivo do catálogo:

| fechamento | custo | média por concurso, na tela | recalculada | retorno |
|---|---:|---:|---:|---:|
| 22 dezenas, cartela de 15, garante 11 | R$ 21,00 | R$ 5,39 | R$ 5,39 | 25,67% |
| 25 dezenas, cartela de 16, garante 11 | R$ 1.568,00 | R$ 402,44 | R$ 402,44 | 25,67% |
| 25 dezenas, cartela de 17, garante 12 | R$ 22.848,00 | R$ 5.864,10 | R$ 5.864,10 | 25,67% |
| 25 dezenas, cartela de 15, garante 13 | R$ 12.628,00 | R$ 3.241,06 | R$ 3.241,06 | 25,67% |

Batem ao centavo, e a coluna da direita é a demonstração em quatro linhas:
**25,67% em cartela de 15, de 16 e de 17**. A taxa não depende do tamanho da
cartela nem do fechamento — depende só do preço da aposta simples e da tabela de
prêmios.

E, no mesmo movimento, os **330 pisos** do índice foram refeitos pela cota de
contagem e as **255 probabilidades** de `acaso.json` pela hipergeométrica, também
em Python, também sem tocar nos arquivos: nenhum diverge.

### Um bilhete de mais de 15 dezenas são várias apostas

Esse número estava certo para bilhete de 15 dezenas e **errado para todos os
outros** — e errado para menos, que é o pior lado para errar.

A lotérica cobra R$ 56,00 por um bilhete de 16 dezenas, e R$ 3,50 pelo de 15.
Dezesseis vezes mais, e não por acaso: um bilhete de 16 **é** as `C(16,15) = 16`
apostas de 15 dezenas que cabem dentro dele. A tabela de preços do aplicativo já
dizia isso em voz alta — 17 dezenas custam `C(17,15) = 136` apostas, 20 dezenas
custam `C(20,15) = 15.504` — e o aplicativo cobrava por todas elas e **pagava
por uma**.

Um bilhete de 16 com 14 acertos não leva uma catorze. Das dezesseis apostas
dentro dele, duas descartam uma das dezenas erradas e ficam com os 14 acertos;
as outras catorze descartam uma certa e ficam com 13. São **duas catorzes e
catorze trezes**. Em geral, com `j` dezenas do sorteio dentro de um bilhete de
`k`, o número de apostas com exatamente `i` acertos é `C(j,i) · C(k−j, 15−i)` —
escolher `i` das certas e o resto das erradas.

O tamanho do erro, medido: o aplicativo mostrava, da expectativa verdadeira,

| tamanho do bilhete | o que mostrava |
|---|---:|
| 16 dezenas | 14,3% |
| 17 dezenas | 3,3% |
| 18 dezenas | 0,97% |
| 19 dezenas | 0,32% |
| 20 dezenas | 0,11% |

Na tela: um fechamento de 28 cartelas de 16 dezenas, conferido contra um
sorteio, dizia que voltaram **R$ 42,00** onde voltam **R$ 280,00**. E a frase
mais visível do aplicativo — *"esses 11 acertos pagam X por cartela premiada"* —
dizia R$ 7,00 onde a cartela de 16 dezenas paga **R$ 35,00**: cinco das
dezesseis apostas ficam com as onze certas, `C(11,11) · C(5,4) = 5`.

Onde o número contradiz a tabela, a tela explica: a faixa de 11 acertos vale
R$ 7,00 na tabela de preços, e a resposta diz que a cartela de 16 paga R$ 35,00
— então a resposta diz também *"(são 5 apostas de 15 dentro dela)"*. E o título
da tabela deixou de ser "quanto paga cada faixa" para ser **"quanto paga cada
faixa, por aposta de 15"**, que é o que aqueles valores sempre foram.

O conserto está num lugar só, `premioDoBilhete`, e para `k = 15` a soma tem um
termo e devolve exatamente o que devolvia — o caso comum não se mexeu. Dele
saem a conferência contra o sorteio, a simulação, a carteira, as duas colunas da
comparação com o chute e a expectativa.

E o conserto **melhora a frase que o aplicativo existe para dizer**. Por
linearidade, a expectativa de um bilhete de `k` dezenas é `C(k,15)` vezes a de
uma aposta simples; o preço também é `C(k,15)` vezes. A taxa de retorno é a
mesma **em todo tamanho de bilhete e em todo fechamento**: 25,7% nas faixas
fixas, sempre. "O fechamento compra certeza, não lucro" deixa de ser uma
observação sobre arranjos dos mesmos bilhetes e passa a valer para qualquer
escolha que se faça na tela. A suíte cobra isso como identidade, para os cinco
tamanhos, com tolerância de 10⁻⁹.

Nada disso muda uma recomendação: preço é preço e garantia é garantia, e a
escada continua escolhendo o mesmo. O que muda é o dinheiro que o aplicativo
mostra — que agora é o que a lotérica deposita.

E o tamanho do estrago, medido no catálogo: dos **237** fechamentos que a tela
pode oferecer, **191 usam cartela maior que 15 dezenas** — 81%. Quarenta e um
deles custam menos de mil reais. Não era um canto exótico do aplicativo: era
quatro em cada cinco fechamentos que o modo manual alcança.

No modo automático o alcance era outro, e vale dizer por quê: em nenhum par
(pool, garantia) uma cartela maior sai **mais barata** que uma de 15 — quando
ela vence, é porque não existe fechamento de 15 dezenas publicado ali. A escada
só chega a uma cartela grande com orçamento acima de R$ 145.600. Quem foi
enganado pelo número foi quem montou à mão.

## A decisão que define o produto: o cliente não resolve nada

O espaço de respostas é **finito e pequeno**. Pool de 15 a 25 dezenas, bilhete
de 15 até o tamanho do pool, garantia de 11 a 15 acertos: **330 combinações no
total**. Isso não é espaço para explorar em tempo de execução no aparelho de
ninguém. É catálogo para publicar.

Daí tudo o mais decorre:

| Camada | O que é | Onde vive |
|---|---|---|
| Cliente | PWA sem framework, sem etapa de compilação, zero dependências | `app/` |
| Catálogo | Um JSON por fechamento, estático, imutável | `catalogo/` |
| Resolvedor | Rust; roda em CI e na máquina de quem mantém, **nunca** no cliente | `motor/gerar-catalogo` |
| Conferidor | Rust sem dependência nenhuma, independente do resolvedor | `motor/conferir-tudo` |
| Servidor | Três funções opcionais; o aplicativo funciona inteiro sem elas | `servidor/` |

Sem WebAssembly no cliente, sem *web workers*, sem banco de sessões, sem retomada
de trabalho interrompido. Nada disso tem razão de existir quando não há nada a
esperar. O cliente inteiro dá **2.747 linhas** somando JavaScript, HTML e CSS —
teto de 2.800 cobrado pela construção —, e o peso inicial (casca, índice, preços
e distribuições) dá **48 KiB comprimidos**.

O teto foi 1.500 enquanto havia uma porta de entrada só, 1.700 quando a segunda
chegou, 2.250 com a área de análise, 2.400 com a comparação contra o chute,
2.500 quando o que entra de fora — endereço, armazenamento do aparelho,
resultado guardado — passou a ser conferido antes de virar tela, 2.600 quando o
prêmio passou a decompor cada cartela nas apostas simples que ela é, 2.700
quando a carteira deixou de ser só uma lista — o fechamento guardado volta para a
tela com um toque, e a tela diz de onde ele veio —, e 2.800 quando o "montar do
meu jeito" passou a respeitar o pedido ao pé da letra. Nenhuma
dessas subidas veio de o cliente passar a resolver mais. **Resolver** é procurar quais
cartelas usar, e isso segue inteiro no motor em Rust, fora do aparelho.
**Simular** é contar acertos de cartelas que já existem: um `and` e um popcount
por cartela, mil sorteios contra 3.608 cartelas em 85 ms. São coisas de ordens diferentes, e só a primeira é a que o
catálogo existe para evitar.

E o que esse teto de fato protege — que o cliente não resolva nada — quem cobra
não é ele: é `app/testar-conferir.mjs`, varrendo os fechamentos publicados
sorteio a sorteio contra o que o catálogo promete. O número na construção é o
lembrete de que crescer tem preço.

## A matemática, em quatro linhas

Com `a = v − k` (o que falta ao bilhete) e `b = v − 15` (o que falta ao sorteio),
vale a identidade exata

```
|B ∩ S| = 15 − a + |B' ∩ S'|   ⟹   |B ∩ S| ≥ t  ⟺  |B' ∩ S'| ≥ t' ,  t' = t + a − 15
```

e `t'` organiza as 330:

<!-- a tabela das famílias: gerada por ferramentas/numeros-do-catalogo.py -->
| situação | quantos casos | quem resolve |
|---|---:|---|
| `t' ≤ 0` | 145 | aritmética: um bilhete qualquer já garante, e é mínimo provado |
| `t' = a` e `k = 15` | 10 | fórmula: são todos os `C(v,15)` bilhetes, mínimo provado |
| `t' = a` | 45 | sistema de Turán por construção fechada, depois o motor |
| `0 < t' < a` | 130 | o motor, partindo do melhor que houver |
<!-- fim de a tabela das famílias -->

## A escada decide sozinha

Para um número de dezenas, a **escada** é a lista de degraus que alguém
compraria: por garantia, o mais barato; e fora quem custa o mesmo ou mais e
garante menos. Ela é construída em ordem de preço, e só entra quem garante mais
que todos os anteriores — então **preço e garantia sobem juntos, sempre**. Não é
propriedade do catálogo: é da função, e vale para qualquer catálogo futuro.

Daí sai o módulo inteiro sem mais nenhuma busca:

| pergunta | resposta |
|---|---|
| o que este dinheiro compra | o último degrau que cabe |
| e se eu tivesse mais | o degrau seguinte |
| quanto custa garantir 14 | o primeiro degrau que alcança 14 |
| é um fechamento ou um bilhete | o degrau escolhido tem um jogo, ou mais |

Antes eram três caminhos separados chegando aos mesmos números — e um deles, o
da garantia pedida, chegava a lugar nenhum. A régua marcava os degraus por um
caminho e a frase abaixo dela falava do "próximo" por outro; nada garantia que
fossem o mesmo degrau.

## E quem já sabe o que quer não passa pela escada

A escada responde *"o que este dinheiro compra"*, e por isso ela **esconde de
propósito**: um fechamento que custa mais e garante o mesmo nunca é degrau, e não
aparece. Para quem parte do dinheiro isso é exatamente certo. Para quem parte de
outro lugar, é uma porta fechada.

Existe esse outro lugar. Quem já joga em grupo tem regra própria — *"a gente
sempre preenche vinte cartelas"*, *"nossos volantes são de 18 dezenas"* — e essa
regra não é sobre dinheiro. Um fechamento de 18 dezenas por cartela pode custar
mais que um de 15 com a mesma garantia; a escada some com ele, e a pessoa que
queria justamente aquele fica sem entender por que ele não está lá.

Então **montar do meu jeito** mostra a lista inteira, não a escada: para o pool
escolhido, todos os fechamentos catalogados em cartelas que a lotérica aceita —
de 15 a 20 dezenas —, do mais barato ao mais caro, cada linha assim:

```
garante 12 acertos · R$ 287,00 · 82 cartelas de 15 dezenas
```

Garantia e preço primeiro porque num telefone a lista fechada mostra só o começo
do texto, e o começo tem de ser o que faz escolher entre uma linha e outra.

São quatro coisas que se pede, exatamente as quatro que definem um fechamento:

| o que se pede | como | deixando em branco |
|---|---|---|
| quantas dezenas no pool | lista de 15 a 25, espelhando a grade | fica como está |
| quantas em cada cartela | lista, só os tamanhos que este pool tem | tanto faz |
| que garantia de acertos | lista, só as garantias que este pool tem, e vale como mínimo | tanto faz |
| no máximo quantas cartelas | número livre | todas |

O que sobra dos quatro é a lista de fechamentos, e escolher um deles é a
resposta. E os dois modos, lado a lado:

| | modo automático | montar do meu jeito |
|---|---|---|
| o que a pessoa informa | quanto quer gastar | as quatro características acima |
| quem escolhe o fechamento | o aplicativo | a pessoa |
| o que a lista mostra | os degraus | todos os fechamentos que sobram dos filtros |
| o campo de dinheiro | é o que ela digitou | vira o preço do que ela montou |
| o rodapé | o degrau seguinte | *"você montou este fechamento à mão"* |

Sete coisas mereceram cuidado, e as sete são de tela e não de matemática:

**Nenhum filtro oferece um beco.** As listas de tamanho de cartela e de garantia
são feitas do próprio pool: se não existe fechamento de 18 dezenas por cartela
com 19 no pool, "18" não aparece. Um filtro que oferece o que não existe
transforma escolha em tentativa e erro.

**A grade e o pool são a mesma coisa dita de dois jeitos.** O select do pool
espelha o que está marcado, e escolher nele remarca a grade. Duas fontes
discordando davam o pior dos resultados silenciosos: marcar vinte dezenas na
grade, abrir o modo manual — que ainda dizia vinte e cinco — e ver a primeira
escolha refazer a marcação sem avisar.

**A garantia vale como mínimo, e não como igual.** Quem pede 13 acertos aceita
14 — o que não se aceita é receber 12 tendo pedido 13.

**O descarte que sobra.** Só um: linha do mesmo tamanho de cartela, mesmo preço
ou mais caro, garantindo menos. Com 15 dezenas o catálogo tem cinco entradas —
garantias de 11 a 15 — e as cinco são o mesmo bilhete de R$ 3,50; mostrar as
cinco seria mentir sobre haver escolha. Entre tamanhos **diferentes** nada é
descartado, porque escolher o tamanho é o que este modo oferece.

**Lista vazia sem explicação é aplicativo quebrado.** Quando os quatro pedidos
juntos não deixam nada, a tela repete o que foi pedido — *"com 25 dezenas não há
fechamento catalogado com 15 acertos garantidos e no máximo 2 cartelas"* — para
a pessoa saber o que afrouxar.

**O dinheiro não pode contradizer a resposta.** Montar um fechamento de
R$ 11.424,00 com R$ 300,00 no campo põe duas afirmações na mesma tela, uma delas
falsa. O campo passa a dizer o preço do que foi montado.

**O rodapé não pode falar de escada.** *"Por mais tanto você sobe de 12 para
13"* descreve um caminho que esta resposta não percorreu. Aqui ele diz de onde a
resposta veio.

E o caminho de volta é o que se esperaria: mexer no dinheiro, tocar na grade,
limpá-la ou pedir *escolher por mim* solta o fechamento fixado e devolve o modo
automático inteiro. Não há botão de "sair do modo manual" porque não há modo em
que entrar — há um fechamento nomeado, ou não há.

Soltar é do mesmo lugar em que se solta o link de bolão: **toda troca de dezenas
solta os dois**, porque os dois eram de outro conjunto. Duas travessias mostraram
por quê. Quem chega por um link de bolão recebe uma parte — cinco bilhetes de
quinze — e, montando outro fechamento à mão com o mesmo número de dezenas,
recebia um terço do novo, chamado de parte de um bolão que já não estava na tela.
E limpar a grade com um fechamento de 22 dezenas fixado deixava dezesseis
bilhetes **vazios** sob uma manchete de garantia: não havia mais dezena nenhuma
de onde tirar os números.

### O pedido manda, e vale ao pé da letra

O modo tinha um nome que ele não cumpria. Três defeitos, e os três davam na mesma
queixa: a pessoa dizia uma coisa e a tela mostrava outra.

**A garantia era "no mínimo".** O filtro era `e.t >= t`, e a lista guardava a
escolha anterior sempre que ela continuasse passando. Com `15-14` escolhido,
baixar a garantia de 14 para 11 não mudava nada — 14 é no mínimo 11 —, e a
resposta seguia sendo **452 cartelas por R$ 1.582,00** — o preço daquele
fechamento antes de o motor o encolher para 440 — onde o pedido novo custava
**R$ 14,00**. Mudar o pedido não mudava a resposta; era o mesmo defeito visto
pelos dois lados da queixa.

Passou a ser igualdade. Não se perde nada com isso: o catálogo é **monótono em
`t`** — nos 237 fechamentos publicados não há um par `(v, k)` em que subir a
garantia barateie o fechamento —, então o de **exatamente** `t` é sempre o jeito
mais barato de conseguir ao menos `t`. O que se ganha é o pedido valendo ao pé
da letra.

**E havia um descarte que escondia 66 dos 237.** A lista sumia com a linha que,
no mesmo tamanho de cartela, custasse igual ou mais e garantisse menos — ruído,
quando ninguém a escolheria. Com garantia exata deixa de ser ruído e passa a ser
a resposta a outra pergunta: pedir 11 acertos com cartela de 15 num pool de 20
devolvia **lista vazia**, porque a linha de 11 tinha sido comida pela de 12 —
as duas custam as mesmas quatro cartelas, R$ 14,00, e a de 12 garante mais.
Medido: **66 dos 237** fechamentos publicados eram
inalcançáveis mesmo fixando `k` e `t` nos valores exatos.

O descarte saiu. A lista vem inteira, do mais barato ao mais caro e, no mesmo
preço, da maior garantia para a menor — o melhor negócio continua sendo a
primeira linha, e agora o resto existe. Conferido de fora, um a um, nos 237: com
o pedido escrito nos controles, o aplicativo chega **em todos**, com o pool
marcado certo e a resposta nomeando exatamente aquele fechamento.

### Um pedido sem resposta é dito, e não trocado por outro

O terceiro era o pior. Quando o pedido não tinha resposta — 25 dezenas, cartela
de 16, garantindo 14, que o catálogo não tem — o código fazia `fixar(null)`, e
`null` quer dizer "não há fechamento nomeado". A palavra voltava ao orçamento, e
a tela anunciava, com o número grande, o selo e a frase da garantia:

> **12 acertos garantidos** · 330 cartelas de 15 dezenas · R$ 1.155,00

Um fechamento que ninguém pediu, com outro tamanho de cartela, outra garantia e
outro preço. O *"não há fechamento catalogado"* existia — em cinza, ao lado do
select, três dedos abaixo do número que dizia outra coisa.

O estado que faltava é o do **pedido sem resposta**, que não é o mesmo que não
ter pedido nada. Agora a resposta diz o que foi pedido, diz que não há, e mostra
o que o catálogo tem perto: a mesma garantia noutro tamanho de cartela, e o mesmo
tamanho numa garantia menor, cada uma com o preço. São botões, porque um "não há"
sem saída é um beco — a pessoa fica olhando para a recusa sem saber qual dos
quatro controles afrouxar.

O mesmo vale para o teto de cartelas: digitar "no máximo 1" deixava na tela o
fechamento anterior, de quatro cartelas, que violava o teto recém-digitado.

### O que não existe é dito antes de ser escolhido

Sobrava um jeito de cair na recusa sem culpa nenhuma: **os dois selects não se
conheciam**. Cada um oferecia o que o pool tem — num pool de 20 há cartela de 15
e há garantia de 15 —, e escolher os dois valores oferecidos dava uma combinação
que não existe. `20/15/15` seria jogar **todas** as 15.504 combinações de 15
entre 20 dezenas, e o catálogo não carrega um arquivo desses.

São **255 combinações** que os dois selects deixam montar e **237 fechamentos**
publicados. Os **18 becos** estão todos no mesmo canto — garantia alta com pool
grande —, que é exatamente o cenário onde este modo parecia falhar mais. A falha
não estava em montar: estava em não avisar antes.

| pool | o que falta |
| --- | --- |
| 20, 21 | `15/15` |
| 22 | `15/15`, `16/15` |
| 23, 24 | `15/14`, `15/15`, `16/15`, `17/15` |
| 25 | `15/14`, `15/15`, `16/14`, `16/15`, `17/15`, `18/15` |

Cada valor passa a vir marcado quando, **junto com o resto do pedido**, não leva
a fechamento nenhum: *"15 acertos — sem fechamento"*. O teto de cartelas conta
junto: num pool de 20 com "no máximo 1 cartela" digitado, a cartela de 15 fica
marcada, porque o menor fechamento de 15 dezenas ali tem quatro.

Marcado, e **não removido**. Tirar o valor da lista seria decidir pela pessoa o
que ela pode pedir — que é o defeito de origem deste modo, agora com boas
intenções. Ela escolhe se quiser, e o que recebe é a recusa por escrito.

E a recusa deixou de ser só um "não há". O índice guarda o **piso** das 330
entradas, inclusive das 18 sem arquivo, e o piso é justamente o que falta saber:
quem pede 25 dezenas com cartela de 16 garantindo 14 fica sabendo que o menor
fechamento possível ali tem **3.014 cartelas, R$ 168.784,00** — e decide com
isso na mão, em vez de achar que a tela quebrou. Onde piso e tamanho coincidem a
conta fechou, e a frase muda: não é descuido do catálogo, é que um fechamento
assim só pode ser todas as combinações, e não há menor. Em `20/15/15` isso dá
R$ 54.264,00 — o preço exato de uma única cartela de 20 dezenas, que o catálogo
tem, e que é a primeira saída oferecida ao lado.

### Escolher uma linha da lista é dizer os dois valores

A escolha na lista de fechamentos vivia só ali, e a lista se refaz a cada troca
de pool. Quem escolhia *"cartela de 16, garantindo 14"* num pool de 18 e depois
voltava o pool para 15 — onde cartela de 16 não existe — via o navegador
selecionar a primeira opção sozinho, e o aplicativo montava **essa**: outro
tamanho de cartela, outra garantia, outro preço, sem uma palavra. Só nessa troca
somem quinze pares; entre todos os pools medidos, nenhum deles avisava.

Agora escolher uma linha **escreve** o tamanho da cartela e a garantia nos dois
controles. O pedido passa a morar sempre nos quatro, e o caso desaparece por
construção: quando o pool novo não atende o pedido, o que aparece é a recusa por
escrito com as saídas ao lado, e não um fechamento que ninguém escolheu.

### E nenhuma recusa fica sem saída

As duas vizinhanças oferecidas eram *a mesma garantia noutro tamanho de cartela*
e *o mesmo tamanho numa garantia menor*. Nenhuma das duas existe quando não há
garantia pedida — e aí a recusa ficava sozinha na tela: só o tamanho da cartela
escolhido, um teto que nada daquele tamanho atende, e nenhum botão. Entrou uma
rede por baixo: o menor fechamento que cabe no teto, seja de que tamanho for, e,
se nada couber, o menor que existe para aquele pool. É a resposta a *"então o
que dá para fazer com estas dezenas"*, que é a pergunta de quem chegou ali.

### O que volta de outra sessão volta descrito por inteiro

O fechamento nomeado sobrevive à sessão, e os controles voltavam dizendo metade:
o tamanho da cartela sim, a garantia em *"tanto faz"*. Isso descreve um pedido
mais largo do que o fechamento em uso, e o pedido largo é o que seria resolvido
no toque seguinte — a pessoa mexia no pool e recebia de volta um fechamento que
não era o que ela tinha guardado. Voltam os dois.

### E um caminho só para os quatro controles

Três dos quatro chamavam `desenharManual()` antes de chamar quem já a desenha, e
a lista se refazia duas vezes por toque. Somava-se a isso o pool passando por
`trocarDezenas`, que solta o fechamento nomeado e redesenha a tela inteira a
partir do orçamento — no meio de um pedido manual que ainda ia ser resolvido três
linhas adiante. Era uma resposta desenhada para ser jogada fora, e mais um
momento em que o pedido podia ser lido pela metade. Ficou um caminho só.


## Mínimo provado e menor conhecido nunca se confundem

Cada entrada carrega o **piso** — o limite inferior provado, pela cota de
contagem, por Schönheim, pela cota de Turán no avesso ou pela tabela publicada —
e o **tamanho encontrado**. `provado` é verdade se, e somente se, os dois se
encontram. Na tela isso vira dois selos que não se parecem:

- **mínimo provado** — nenhum fechamento faz isso com menos bilhetes. Ponto.
- **menor conhecido** — este é o menor que se achou, e ao lado aparece o piso:
  *"nenhum fechamento faz isso com menos de 46"*.

Hoje o catálogo tem **226 das 330 no mínimo provado** e 317 com bilhetes
publicados. E vale dizer em que cada prova se apoia, porque não são todas iguais:

<!-- a tabela das provas: gerada por ferramentas/numeros-do-catalogo.py -->
| de onde vem o mínimo | quantas | quem confere |
|---|---:|---|
| aritmética fechada — um bilhete de `k` num pool de `v` cruza `k + 15 − v` com qualquer sorteio, e quando isso já alcança `t` o mínimo é 1 | 145 | `conferir-tudo` refaz o argumento |
| fórmula — `k = 15` com `t = 15` exige que o bilhete **seja** o sorteio, logo todos os `C(v,15)` | 10 | `conferir-tudo` refaz o argumento |
| cota de Turán no avesso | 35 | a cota vem de `motor-core`, validada lá contra números publicados |
| exaustão | 19 | a cota vem de `motor-core`, validada lá contra números publicados |
| cota de Schönheim | 17 | a cota vem de `motor-core`, validada lá contra números publicados |
<!-- fim de a tabela das provas -->

Nos 155 primeiros o conferidor independente não acredita em ninguém: recalcula. Nos
71 restantes a prova se apoia numa cota que o `motor-core` implementa e testa
contra a literatura — e o conferidor só cobra que a cota anunciada não seja menor
que a cota de contagem que ele mesmo recalcula. É menos do que uma prova
independente, e é isto que se pode afirmar sem exagero.

## Nada é publicado sem varredura exaustiva

Três implementações independentes respondem à mesma pergunta, e as três têm de
concordar:

1. o **gerador** confere o que grava, por bitmask e força bruta;
2. o binário **`conferir-tudo`** confere de novo, sem `motor-core`, sem
   dependência externa nenhuma, com leitor de JSON próprio e aritmética própria.
   É ele que roda em CI, e uma falha dele bloqueia a publicação;
3. o **`conferir.js` do cliente** varre de novo no aparelho de quem duvidar, sob
   demanda. O laço é por bilhete, não por sorteio: geram-se só os sorteios que
   cada bilhete atende e marca-se um vetor de bits indexado pela máscara do
   sorteio, o que troca catorze bilhões de operações por vinte milhões. O pior
   caso do catálogo sai em torno de dois segundos.

E a varredura roda duas vezes em CI: uma sobre `catalogo/`, outra sobre
`publicar/catalogo/` — os bytes que o navegador de alguém vai baixar.

### E o conferidor reprova?

Rodá-lo sobre o catálogo bom prova que ele aceita o que é bom, e não prova nada
sobre o que ele faria com o que é ruim. Um laço de cobertura quebrado, uma
comparação invertida, um `return Ok` fora do lugar: nenhum apareceria nunca,
porque o catálogo publicado está certo e ele diria que sim. E é dele que a
publicação inteira depende para dizer não.

`ferramentas/provar-o-conferidor.py` estraga o catálogo de propósito, um defeito
de cada vez, e cobra que ele reprove **pelo motivo daquele defeito**:

| defeito | tem de reprovar dizendo |
|---|---|
| falta um bilhete, com contagem e soma refeitas | *não é coberto* |
| um bilhete trocado por outro válido e distinto | *não é coberto* |
| a soma do índice não é a do arquivo | *soma de verificação* |
| o índice conta um bilhete a mais | *o índice diz* |
| o tamanho anunciado fica abaixo do piso | *abaixo do piso* |
| mínimo provado onde os limites não se encontram | *marca provado* |
| uma das 330 sumiu do índice | *aparece 0 vezes* |
| o mesmo bilhete duas vezes | *bilhete repetido* |

Os dois primeiros são os que importam: tudo o que a forma pode conferir continua
batendo, e só varrer sorteio a sorteio acha o defeito.

Sete dos oito defeitos estão numa entrada só, e mandar o conferidor varrer as
outras 311 a cada vez levava seis minutos para provar o que uma entrada já
prova. Daí o segundo argumento de `conferir-tudo`: `conferir-tudo catalogo
20-15-13` confere o conjunto das 330 inteiro — que é barato — e varre só aquela.
Serve também a quem acabou de regerar um fechamento. O que ele imprime começa
com **CONFERÊNCIA PARCIAL** e diz que não autoriza publicação, para ninguém
confundir uma coisa com a outra; e o passo do CI que autoriza continua sendo o
sem recorte. A suíte inteira caiu de 5m44s para 40 segundos.

A primeira versão deste arquivo ficou verde sem testar nada. Ela regravava o
índice com `json.dumps`, que põe um espaço depois dos dois-pontos; o conferidor
não usa biblioteca de JSON — tem leitor próprio, de propósito, para não
compartilhar nada com o gerador — e procura a sequência exata `"entradas":[`.
Lia zero entradas e reprovava por isso, oito vezes, pelo mesmo engano. Foi por
cobrar o **motivo**, e não só o código de saída, que isso apareceu.

Uma conferência que reusa o gerador só sabe dizer que o gerador concorda consigo
mesmo.

## A IA nunca toca em número

> A IA nunca gera, escolhe, altera ou valida bilhetes. Nunca calcula nem estima
> mínimos, coberturas ou limites inferiores.

São três usos, todos opcionais, todos com caminho alternativo determinístico:

- **intenção** — texto livre vira `{orcamento, dezenas[], garantiaMinima}` sob
  esquema estrito. Fora do esquema é silêncio, e um leitor por expressão regular
  assume — o mesmo leitor de dois lados, e por isso com a mesma resposta dos dois
  lados: *"quero 30 dezenas"* o servidor aparava para 25 e o cliente recusava, e
  a mesma frase mudava de significado conforme houvesse ou não servidor no ar.
  Agora os dois recusam, porque aparar é inventar: 30 dezenas não é um pedido de
  25, é um pedido que este leitor não entende — e dizer isso é a resposta certa,
  com a grade ali do lado;
- **explicação** — uma frase sobre a troca entre dinheiro e garantia, recebendo
  **apenas** números que o catálogo já produziu. A frase é descartada se trouxer
  qualquer número que não estava no pedido, e essa regra é cobrada duas vezes:
  no servidor e de novo no cliente, antes de tocar a tela.

  A regra sabe como o Brasil escreve dinheiro. Sem isso ela rejeitava **toda**
  frase com preço: "R$ 199,50" vira os números 199 e 50, nenhum dos dois
  autorizado — e o modelo tinha sido chamado justamente para falar de dinheiro.
  O caminho com IA nunca fora exercido de ponta a ponta, e o teste que deveria
  pegá-lo montava à mão o conjunto de números autorizados, em vez de pedi-lo ao
  servidor: testava o conjunto que ele mesmo tinha escrito. Agora ele usa o do
  servidor, e a suíte da tela finge um servidor para cobrar as duas metades —
  uma frase com preço entra, uma com número inventado é descartada sem apagar a
  frase determinística.

  Reais inteiros só entram quando o valor é inteiro: com R$ 199,50 no pedido,
  "200 reais" passava, e arredondar é calcular;
- **narração pós-sorteio** — mesma restrição.

A chave nunca sai do servidor. Desligar a IA inteira mantém o aplicativo
funcional — é assim que ele está hoje, sem servidor nenhum. Como pôr as três
funções no ar está em [`servidor/LEIAME.md`](../servidor/LEIAME.md).

## Recomeçar em vez de insistir, e por que não

A busca é estocástica e a variância entre sementes é grande — o próprio
`motor-busca` registra uma medição em que trocar a semente mudou o resultado em
28 cartelas, mais do que o parâmetro que estava sendo medido. O gerador usa uma
**semente fixa**, então uma trajetória azarada não melhora por durar mais: só
fica mais longa. Daí a hipótese de dividir o orçamento em recomeços com
sementes diferentes, cada um partindo do melhor já achado.

Medido, com o mesmo tempo total, cada caso partindo do zero:

| caso | 1 corrida | 2 recomeços | 4 recomeços |
|---|---:|---:|---:|
| 21-15-13 | 117 | 117 | 117 |
| 22-15-13 | 296 | **294** | 299 |
| 23-15-12 | **83** | — | 88 |

Um empate, um ganho de 0,7% e duas perdas, de 1% e de 6%. Cada recomeço devolve
ao motor uma fase de aquecimento que ele já tinha pago, e num orçamento de uma
hora isso se repetiria doze vezes.

A hipótese era razoável e está errada. O código dos recomeços saiu — um botão
que ninguém deve girar é código para manter à toa —, e fica o número, que é o
que o próximo a ter a mesma ideia precisa ver. As três medições que decidiram
isto estão reproduzíveis: `CATALOGO_SAIDA` e um catálogo de saída vazio dão a
corrida do zero.

## O catálogo parou de melhorar, e isso também é uma medição

Cada bilhete a menos num fechamento é dinheiro que a pessoa não gasta, então
vale perguntar de tempos em tempos se a busca ainda tem o que dar. Em setembro
de 2026 a pergunta foi feita de novo, contra os degraus que a escada de fato
serve — os fechamentos que as pessoas compram.

Seis deles, 90 segundos de busca cada, partindo dos 316 fechamentos já
publicados como semente:

| caso | publicado | depois da busca |
|---|---:|---:|
| 21-15-12 | 18 | 18 |
| 22-15-12 | 40 | 40 |
| 20-15-13 | 42 | 42 |
| 23-15-12 | 82 | 82 |
| 21-15-13 | 111 | 111 |
| 22-15-13 | 290 | 290 |

Nenhum se moveu. As rodadas anteriores já tinham colhido o que havia nesta
escala de busca, e insistir com o mesmo motor e o mesmo tempo é repetir uma
pergunta já respondida. Fica registrado para que a próxima tentativa comece de
onde esta parou: melhorar estes números agora exige **outra coisa** — mais
tempo por caso em ordens de grandeza, outra técnica, ou uma construção
algébrica que o motor não conhece —, e não mais uma passada igual.

O contraponto útil: a folga que o índice mostra entre `jogos` e `piso` chega a
600%, e não quer dizer que caiba um fechamento seis vezes menor. Quer dizer que
o **piso** é fraco. Cotas de contagem e de Schönheim são notoriamente frouxas em
covering designs, e usá-las para estimar quanto ainda dá para economizar leva a
esperar um ganho que não existe.

## E depois ele voltou a melhorar, com as duas coisas que faltavam

A seção acima terminou nomeando o que faltava: *"melhorar estes números agora
exige **outra coisa** — mais tempo por caso em ordens de grandeza, outra técnica,
ou uma construção algébrica que o motor não conhece"*. As três foram medidas. A
primeira não paga; as outras duas, sim, e as duas estavam mais perto do que
parecia.

### Mais tempo não paga, e partir do zero é pior

Trezentos segundos por caso, partindo do catálogo publicado, nos casos acima do
piso: **uma** melhoria em dezessete casos buscados — `19/15/14`, de 127 para 125.
Partir **do zero** com o mesmo tempo perde nos três casos medidos:

| caso | publicado | do zero, 300 s |
|---|---:|---:|
| 20/15/14 | 452 | 458 |
| 21/15/13 | 111 | 114 |
| 20/16/15 | 1.367 | 1.422 |

O motor livre, sozinho e nesta escala de tempo, já colheu o que havia. O que a
seção anterior chamou de *"repetir uma pergunta já respondida"* continua valendo
— e é por isso que a resposta veio de outro lugar.

### A construção que só existia numa das cinco linhas

No avesso, a regra do fechamento é uma só. Com `a = v − k` dezenas faltando ao
bilhete e `b = v − 15` faltando ao sorteio:

```text
|K ∩ S| ≥ t   ⟺   |M ∩ T| ≥ t + a − 15 =: t'
```

Com `t' = a` isso é *"as `a` que faltam ao bilhete estão todas entre as `b` que
faltam ao sorteio"* — um sistema de Turán, e é a linha `t = 15`. O gerador tinha
construção fechada só para esse caso. Nas outras quatro linhas ele não tinha
construção nenhuma: partia do catálogo anterior e entregava tudo ao motor.

E é exatamente ali que a distância até o piso é maior. Medido no catálogo
publicado, das 112 entradas acima do piso:

| garantia pedida | entradas acima do piso | razão mediana |
|---|---:|---:|
| `t = 11` | 15 | 2,00× |
| `t = 12` | 19 | 4,00× |
| `t = 13` | 28 | 3,92× |
| `t = 14` | 30 | 3,08× |
| `t = 15` | 20 | 1,97× |

**92 das 112 têm `t < 15`** — a linha que tinha construção é a que está mais
perto do piso, e não por acaso.

As três ideias de sempre valem inteiras com `t' < a`: todos os `C(v,a)`
subconjuntos; a recursão por um ponto — ou `x` está no `b`-conjunto, e sobra um
`(b−1)`-conjunto para uma família de `a−1` com garantia `t'−1`, ou não está, e
serve a família do resto; e a casa dos pombos por grupos. Entrou uma quarta:
**grupos disjuntos que não cobrem tudo**, porque deixar dezenas de fora concentra
o sorteio nos grupos que existem em vez de diluí-lo em partes demais. A monotonia
em `a`, em `b` e em `t'` fecha a conta de graça — cartela maior, sorteio maior ou
garantia menor nunca custam mais.

Sem um segundo de busca, a família assim construída já nasce menor que o
catálogo publicado em nove entradas:

| caso | publicado | só a construção | piso |
|---|---:|---:|---:|
| 25/19/12 | 9 | **4** | 3 |
| 24/18/12 | 8 | **4** | 3 |
| 25/17/11 | 11 | **7** | 3 |
| 25/22/14 | 11 | **8** | 8 ← alcançado |
| 24/19/13 | 21 | **16** | 6 |
| 24/20/14 | 46 | **36** | 14 |
| 25/20/13 | 19 | **16** | 5 |
| 25/18/12 | 22 | **19** | 4 |
| 25/21/14 | 40 | **36** | 13 |

Os testes do módulo cobram cada família por força bruta — para todo `(v,a,b,t')`
até `v = 11`, todo `b`-subconjunto tem de encontrar algum membro em `t'`
elementos, e o tamanho construído tem de bater com o medido. E o catálogo inteiro
assim gerado passa no `conferir-tudo`, que não compartilha uma linha com o
gerador: 330 entradas, 239.494.601 sorteios varridos.

### A técnica que estava no repositório e nunca tinha sido chamada

`motor-busca` tem uma busca que **nunca quebra a simetria**: a unidade que ela
move é a órbita do grupo cíclico, então as `v` rotações andam juntas. Ela nasceu
para a Lotinha, onde oito dos vinte fechamentos em aberto eram perfeitamente
invariantes por rotação — sinal de que a busca livre, que move uma cartela por
vez, nunca tinha aceitado um movimento neles.

`montar_com_intersecao` já aceitava garantia parcial. A peça estava pronta, e o
gerador do catálogo da Lotofácil nunca a tinha chamado.

Medida em doze casos com 90 s cada, contra o catálogo publicado, **ganha em
seis**:

| caso | publicado | só simetria, 90 s |
|---|---:|---:|
| 22/16/14 | 932 | **748** |
| 22/15/14 | 4.184 | **3.916** |
| 20/16/14 | 90 | **80** |
| 21/17/14 | 71 | **63** |
| 22/18/14 | 61 | **55** |
| 20/15/13 | 42 | **40** |

Perde nos outros seis, então não substitui a busca livre — as duas correm e vale
a menor. Mas o ganho maior não é nenhuma das duas sozinha: **o que a simetria
acha vira partida da busca livre**, que então quebra a simetria e desce abaixo do
ótimo cíclico.

| caso | publicado | só simetria | simetria e depois o motor |
|---|---:|---:|---:|
| 20/16/14 | 90 | 80 | **72** |
| 22/16/14 | 932 | 748 | **742** |
| 21/17/14 | 71 | 63 | **63** |
| 22/15/14 | 4.184 | 3.916 | **3.904** |

Onde a simetria não cabe: a tabela de ligações cresce com `C(v,a)/v` vezes
quantos alvos cada conjunto alcança, e nas garantias parciais de pool grande isso
passa de bilhões. Dos 112 casos acima do piso, **75 cabem** no teto de 150
milhões de ligações; `25/18/13` pediria 2,5 bilhões e fica de fora.

### A colheita

As três capacidades foram postas a trabalhar em quatro turnos: os 75 casos em
que a instância cíclica cabe inteira, os 14 maiores um de cada vez com a tabela
solta até 4 GB, e os 23 que só a amostragem alcança. Somando com as nove que a
construção fechada entrega sem busca, **66 dos 312 fechamentos publicados
encolheram**.

Nos casos buscados a taxa foi alta e subiu com o tamanho do pool: 55% nos 75
primeiros, e **17 de 17** entre os que a amostragem trouxe para dentro — que são
justamente os de maior folga. As rodadas anteriores colhiam uma ou duas.

| caso | antes | depois | piso | fora da conta |
|---|---:|---:|---:|---:|
| 25/19/12 | 9 | **4** | 4 | R$ 67.830,00 |
| 24/18/12 | 8 | **4** | 4 | R$ 11.424,00 |
| 24/20/14 | 46 | **24** | 14 | R$ 1.193.808,00 |
| 25/17/11 | 11 | **7** | 3 | R$ 1.904,00 |
| 22/16/12 | 16 | **11** | 4 | R$ 280,00 |
| 24/16/14 | 6.719 | **4.766** | 1.496 | R$ 109.368,00 |
| 25/17/14 | 3.678 | **2.647** | 641 | R$ 490.756,00 |
| 24/17/14 | 1.592 | **1.152** | 300 | R$ 209.440,00 |
| 25/22/14 | 11 | **8** | 8 | — |
| 25/18/14 | 1.018 | **750** | 181 | R$ 765.408,00 |
| 24/16/13 | 481 | **357** | 79 | R$ 6.944,00 |
| 21/17/15 | 1.094 | **819** | 554 | R$ 130.900,00 |
| 23/16/14 | 2.600 | **1.976** | 573 | R$ 34.944,00 |
| 24/19/13 | 21 | **16** | 6 | R$ 67.830,00 |
| 20/16/14 | 90 | **69** | 40 | R$ 1.176,00 |
| 24/15/11 | 31 | **24** | 7 | R$ 24,50 |
| 24/18/14 | 413 | **320** | 72 | R$ 265.608,00 |
| 25/20/14 | 112 | **87** | 22 | R$ 1.356.600,00 |
| 23/17/14 | 621 | **483** | 140 | R$ 65.688,00 |
| 22/17/14 | 222 | **176** | 53 | R$ 21.896,00 |
| 22/16/14 | 932 | **742** | 257 | R$ 10.640,00 |
| 25/21/14 | 40 | **32** | 13 | — |
| 24/19/14 | 136 | **109** | 30 | R$ 366.282,00 |
| 23/18/14 | 171 | **138** | 44 | R$ 94.248,00 |
| 25/19/14 | 308 | **250** | 53 | R$ 786.828,00 |
| 22/17/13 | 27 | **22** | 8 | R$ 2.380,00 |
| 24/17/13 | 145 | **120** | 24 | R$ 11.900,00 |
| 22/16/13 | 79 | **66** | 19 | R$ 728,00 |
| 25/20/13 | 19 | **16** | 5 | R$ 162.792,00 |
| 23/16/12 | 27 | **23** | 7 | R$ 224,00 |
| 25/18/13 | 111 | **95** | 17 | R$ 45.696,00 |
| 24/15/13 | 1.631 | **1.398** | 334 | R$ 815,50 |
| 24/16/11 | 14 | **12** | 4 | R$ 112,00 |
| 25/18/12 | 22 | **19** | 4 | R$ 8.568,00 |
| 22/18/14 | 61 | **53** | 20 | R$ 22.848,00 |
| 21/16/13 | 33 | **29** | 12 | R$ 224,00 |
| 21/17/14 | 71 | **63** | 30 | R$ 3.808,00 |
| 25/16/11 | 28 | **25** | 5 | R$ 168,00 |
| 23/16/13 | 180 | **161** | 40 | R$ 1.064,00 |
| 25/17/13 | 278 | **250** | 46 | R$ 13.328,00 |
| 23/17/12 | 11 | **10** | 4 | R$ 476,00 |
| 23/20/14 | 11 | **10** | 9 | R$ 54.264,00 |
| 25/15/11 | 55 | **50** | 10 | R$ 17,50 |
| 22/15/13 | 290 | **264** | 74 | R$ 91,00 |
| 23/17/13 | 67 | **61** | 15 | R$ 2.856,00 |
| 22/19/14 | 13 | **12** | 10 | R$ 13.566,00 |
| 21/16/14 | 272 | **252** | 111 | R$ 1.120,00 |
| 23/15/13 | 694 | **644** | 161 | R$ 175,00 |
| 20/15/13 | 42 | **39** | 16 | R$ 10,50 |
| 25/19/13 | 43 | **40** | 8 | R$ 40.698,00 |
| 22/15/14 | 4.184 | **3.900** | 1.609 | R$ 994,00 |
| 25/16/13 | 938 | **875** | 154 | R$ 3.528,00 |
| 23/19/14 | 49 | **46** | 18 | R$ 40.698,00 |
| 21/15/13 | 111 | **105** | 37 | R$ 21,00 |
| 23/18/13 | 24 | **23** | 8 | R$ 2.856,00 |
| 21/15/14 | 1.431 | **1.372** | 679 | R$ 206,50 |
| 24/17/12 | 25 | **24** | 5 | R$ 476,00 |
| 24/18/13 | 50 | **48** | 10 | R$ 5.712,00 |
| 20/15/14 | 452 | **440** | 208 | R$ 42,00 |
| 25/15/13 | 3.608 | **3.525** | 671 | R$ 290,50 |
| 24/20/15 | 334 | **327** | 150 | R$ 379.848,00 |
| 20/16/15 | 1.367 | **1.340** | 1.037 | R$ 1.512,00 |
| 19/15/14 | 127 | **125** | 81 | R$ 7,00 |
| 25/15/12 | 330 | **325** | 55 | R$ 17,50 |
| 23/18/15 | 2.138 | **2.132** | 835 | R$ 17.136,00 |
| 25/19/15 | 3.856 | **3.855** | 1.261 | R$ 13.566,00 |

Somando, são **R$ 6.914.666,50** que deixam de ser cobrados de quem compra. E os
números mais visíveis do aplicativo se moveram junto:

- *"garantir 14 acertos com 20 dezenas"*, o rodapé de quem pede uma garantia que
  ainda não cabe no bolso, passou de R$ 1.582,00 para **R$ 1.540,00**;
- a resposta de R$ 400 — 25 dezenas garantindo 11 acertos — passou de 55 para
  **50 cartelas**, de R$ 192,50 para **R$ 175,00**;
- a de R$ 1.500 passou de 330 para **325**, e a de R$ 15.000 de 3.608 para
  **3.525**.

Tudo isso passou pelo `conferir-tudo`, que não compartilha uma linha com o
gerador nem com a busca: 330 entradas, 249.307.987 sorteios varridos, e cada
sorteio possível encontrando alguma cartela com a garantia prometida.

### Cinco becos fecharam, e o teto passou a dizer a verdade

O "montar do meu jeito" tinha **18 becos**: combinações que os dois selects
deixam montar e que o catálogo não atende. Eles não eram descuido — eram
entradas cujo fechamento o motor nunca tinha alcançado, ou cujo resultado
passava do teto de publicação.

O teto era o problema maior, e ele mesmo já admitia: *"ele conta cartelas, e não
dinheiro, e por isso não é a fronteira que o parágrafo acima descreve"*. Com o
corte em 8.000 cartelas, o catálogo publicava dezoito fechamentos acima de
R$ 1 milhão — o mais caro em R$ 59.907.456 — e recusava , que o motor
resolve com 10.167 cartelas de 15 dezenas por **R$ 35.584,50**. Mais barato que
49 dos que já estavam lá. O teto não protegia o bolso de ninguém: barrava
justamente os fechamentos baratos, porque são os que precisam de muitas
cartelas.

Ele passou a ser o que sempre foi de fato — um teto de **peso** do catálogo e do
tempo de conferência —, em 16.000 cartelas, cerca de 110 KiB por arquivo. O
bolso continua protegido pelo lugar certo: o preço ao lado de cada fechamento na
tela.

Cinco entradas entraram:

| entrada | cartelas | piso | custo | |
|---|---:|---:|---:|---|
| 20/15/15 | 15.504 | 15.504 | R$ 54.264,00 | mínimo provado |
| 25/18/15 | 14.850 | 5.121 | R$ 42.411.600,00 | |
| 25/16/14 | 10.944 | 3.014 | R$ 612.864,00 | |
| 23/15/14 | 10.167 | 4.378 | R$ 35.584,50 | |
| 23/17/15 | 10.051 | 3.996 | R$ 4.784.276,00 | |

 era o exemplo que a própria tela usava ao recusar um pedido. Agora
ela monta.

E três ficaram de fora de propósito —  em 18.928,  em 24.770
e  em 26.782. Subir o teto de novo para capturá-las seria mover a
trave: ele foi fixado em 16.000 por uma razão dita em voz alta, os 110 KiB, e os
números novos não mudam essa razão. Nessas o aplicativo diz o piso e mostra o
que há perto, que é o comportamento certo para um pedido que não tem resposta.

O modo manual passa de 237 para **242 fechamentos alcançáveis**, e de 18 para
**13 becos**.

### E onde a folga era da cota, não do fechamento

O piso do índice é uma **cota inferior**: diz que nada menor existe, não que
aquele tamanho exista. Em covering designs essas cotas são notoriamente frouxas,
e a folga que o aplicativo mostrava era, em muitos casos, promessa de uma
economia que ninguém poderia cumprir.

O provador de exaustão responde a outra pergunta, e a resposta é definitiva:
existe algum fechamento com `n` cartelas? Ele varre o espaço inteiro, com duas
reduções que tornam isso possível — enumerar famílias a menos de simetria, pelas
repartições das dezenas em blocos de pertinência, e conferir a cobertura sem
olhar sorteio nenhum, porque `|B ∩ S|` só depende de quantas dezenas o sorteio
toma de cada bloco. Os 3.268.760 sorteios viram alguns milhares de vetores de
contagem.

Catorze entradas ficaram provadas ótimas, em algumas centenas de nós cada:

| caso | piso antes | mínimo provado | o que o catálogo já tinha |
|---|---:|---:|---:|
| 23/16/11 | 3 | **5** | 5 |
| 22/16/11 | 2 | **4** | 4 |
| 23/17/11 | 2 | **4** | 4 |
| 24/17/11 | 2 | **4** | 4 |
| 24/18/11 | 2 | **4** | 4 |
| 25/18/11 | 2 | **4** | 4 |
| 25/19/11 | 2 | **4** | 4 |
| 21/15/11 | 3 | **4** | 4 |
| 22/17/12 | 3 | **4** | 4 |
| 23/18/12 | 3 | **4** | 4 |
| 24/18/12 | 3 | **4** | 4 |
| 24/19/12 | 3 | **4** | 4 |
| 25/19/12 | 3 | **4** | 4 |
| 25/20/12 | 3 | **4** | 4 |

Em todas elas o fechamento publicado **já era o mínimo**. O catálogo passa de 207
para **221 entradas no mínimo provado** sem que um único bilhete mude — e catorze
folgas de 33% a 100% somem da tela porque nunca existiram.

### E o piso continua sendo fraco
### E o piso continua sendo fraco

A ressalva da seção anterior não caiu, e vale repetir com número. Em `25/18/13` o
piso de 17 cartelas vem da cota de contagem: cada cartela atende 202.164 dos
3.268.760 sorteios possíveis, e 3.268.760 ÷ 202.164 = 16,17. Alcançar 17 exigiria
que dezessete cartelas se sobrepusessem em **95%** do que cobrem — o que não
existe em fechamento nenhum desse tamanho.

Ou seja: a folga de 6,5× que o índice mostra ali não é um fechamento seis vezes
menor esperando ser achado. Parte dela é o piso, e não o motor. O que **é** do
motor se mede pelo que ele consegue quando lhe dão outra ferramenta — e ali,
com cinco minutos de busca livre partindo do zero, o mesmo caso saiu de 111
para 108.

## A resposta estava fora da tela

Medido, em vez de suposto: depois do toque em *"escolher por mim"*, o número da
resposta nascia a **788 px** do topo. Num iPhone SE (390×667) isso é 121 px
abaixo da dobra — a pessoa tocava no botão e continuava olhando para a grade de
dezenas, sem nada que dissesse que havia uma resposta mais abaixo. Num iPhone 12
o número aparecia pela metade e "acertos garantidos" ficava cortado.

O aplicativo tem uma tela só, e a especificação pede que o número da resposta
seja o maior elemento dela — e era, num lugar que ninguém via.

Agora, quando a pessoa pede que o aplicativo escolha, a tela vai até a resposta:
o número, o que ele significa, o preço e a ressalva cabem juntos na menor tela
que ainda se vende. A rolagem é suave, e instantânea para quem pediu menos
movimento ao sistema. Rolar não acontece quando a pessoa marca dezenas na mão —
ali ela está trabalhando na grade, e puxar a tela debaixo do dedo seria pior do
que não rolar.

A suíte da tela mede isso num contexto de 390×667: o topo do número dentro da
janela, e o fim de "acertos garantidos" também.

## Uma lista que ninguém rola

Os milhares de bilhetes que R$ 15.000 compram viravam **339 mil pixels** de
página e 67 mil nós no DOM — eram 4.198 no dia da medição. Quatrocentas telas de rolagem entre a lista e tudo o que vem
depois dela — a conferência sorteio a sorteio, o bolão, a carteira, a tabela de
preços. Na prática, com um fechamento grande, metade do aplicativo deixava de
existir; e num telefone barato aquilo é memória que não há.

A lista passou a desenhar os primeiros cinquenta e a dizer quantos existem. O
que o aplicativo **guarda** não mudou: a varredura exaustiva, a divisão em
bolão, a conferência contra o sorteio e a impressão dos volantes continuam
vendo o fechamento inteiro — e a suíte cobra as duas metades, que a lista foi
cortada e que a varredura ainda cobre tudo.

Cinquenta linhas de números ainda eram cinquenta linhas de números logo abaixo
da resposta, e ninguém tinha pedido nenhuma delas ainda. Hoje a tela de geração
não mostra cartela alguma — o que vem a seguir é a seção adiante.

## Gerar e analisar são dois assuntos

Depois de gerar, a primeira tela diz o que foi gerado e para por aí:

```
Fechamento gerado
        40
cartelas de 15 dezenas · R$ 140,00
   [ Visualizar cartelas ]
```

As cartelas, a conferência, a simulação e a conta do dinheiro moram numa área
própria, que ocupa a tela inteira quando aberta e some quando se volta. A
navegação é uma barra de abas — **Cartelas · Conferir · Simular · Valores ·
Resumo** —, e a regra é uma coisa de cada vez. Nada foi escondido; foi
organizado, e cada coisa está a um toque de onde faz sentido procurá-la.

### Simular é contar, não resolver

A simulação sorteia resultados e conta acertos das cartelas que **já existem**:
um `and` e um popcount por cartela sobre a máscara do sorteio. Mil sorteios
contra o maior fechamento do catálogo — **3.608** cartelas — levam **85 ms**, e
**158 ms** com o chute do lado, que é o dobro do trabalho contra os mesmos
sorteios. Eram 66 e 127 antes de o prêmio passar a decompor cada cartela nas
apostas simples que ela é: trinta milissegundos por mil sorteios é o preço de
mostrar o dinheiro certo. Procurar **quais** cartelas usar — isso sim é
resolver, e segue inteiro no motor em Rust, fora do aparelho.

O número velho aqui dizia 3.678 bilhetes, de uma passada do motor que já não é
a publicada. Um número que ninguém refaz envelhece calado; este foi refeito
chamando `simular` direto sobre `catalogo/f/25-15-13.json`.

Ela pergunta de dois jeitos, e os dois são legítimos e diferentes:

| modo | o que sorteia | o que responde |
|---|---|---|
| como na vida real | 15 entre as 25 | como o fechamento se sai num concurso qualquer |
| dentro do seu pool | 15 entre as suas `v` | como ele se sai quando a garantia vale |

A diferença entre os dois **é** o produto, e por isso a tela nunca deixa um
passar pelo outro. No modo real ela diz em quantos dos sorteios as 15 caíram
todas dentro do pool — que é onde a garantia se aplica, e são poucos. No modo
do pool ela avisa que aqueles concursos são raros, e que o saldo ali não é o que
se espera por concurso. Uma simulação sem essas duas frases seria propaganda com
cara de medição, e a suíte cobra as duas: quebrando o sorteio para cair sempre
dentro do pool, o teste de módulo e o de tela apontam.

### E o chute do lado, contra os mesmos sorteios

Toda simulação corre duas vezes: o fechamento, e **os mesmos bilhetes no chute**
— mesma quantidade, mesmo tamanho, mesmo pool, mesmo dinheiro. Contra os
**mesmos** sorteios, que é o que faz a comparação medir a diferença entre os
dois jeitos de escolher bilhete, e não a sorte de dois conjuntos de sorteios.

Mil sorteios dentro de um pool de 20, fechamento de 4 cartelas garantindo 12:

```
Alcançou 12 acertos      Seu fechamento    No chute
dos sorteios                     100,0%       80,8%

Melhor bilhete do sorteio    Seu fech.    No chute
15 acertos                           0           1
14 acertos                          19          12
13 acertos                         266         237
12 acertos                         715         605
11 acertos                           0         144
10 acertos                           0           1

                         Seu fechamento    No chute
Gasto                      R$ 14.000,00   R$ 14.000,00
Prêmios de 11 a 13         R$ 38.192,00   R$ 38.444,00
Prêmios de 14 e 15         R$ 28.500,00   R$ 1.718.000,00
```

Está tudo ali. O fechamento **nunca** desce da garantia; o chute desceu em 145
dos mil. E as faixas de prêmio fixo pagaram R$ 38.192 contra R$ 38.444 — sete
décimos de por cento de diferença, que é ruído. É a frase que o aplicativo
repete desde a primeira tela — *"o fechamento compra certeza, não lucro"* —
deixando de ser afirmação e virando medição.

Por isso a linha de 14 e 15 fica **separada**: são faixas rateadas, e um único
acerto de 15 num dos lados vale R$ 1,7 milhão e vira a conta inteira. Somá-la
com as fixas produziria uma tabela onde o chute "ganha" por um golpe de sorte —
um número grande e verdadeiro dizendo uma coisa falsa.

E há configurações em que a comparação desmente o próprio produto: com 25
dezenas e 55 bilhetes garantindo 11, os dois lados alcançam 11 em 100% dos
sorteios. A garantia ali não compra nada que o acaso já não desse, e a tela diz
isso com todas as letras quando as duas colunas empatam.

### A área é um diálogo, e se comporta como um

Uma tela cheia por cima de outra levanta quatro perguntas que só aparecem no
aparelho de verdade, e as quatro estavam respondidas errado:

| o que a pessoa faz | o que acontecia | o que acontece |
|---|---|---|
| aperta "voltar" | saía do aplicativo | fecha a área |
| dá Tab com a área aberta | vazava para os 56 controles atrás | fica presa na área |
| fecha a área | o foco caía no nada | volta ao botão que a abriu |
| ouve a tela com leitor | cinco botões e cinco regiões soltas | abas e painéis ligados |

A entrada no histórico é o conserto do primeiro: abrir empilha uma, fechar pelo
botão a consome, e `popstate` fecha a área em vez de deixar o navegador sair. O
`inert` no `<main>` é o conserto do segundo — a tela de geração continua no
documento, atrás, mas fora do caminho do teclado e do leitor de tela. E as setas
andam entre as abas, como numa barra de abas de verdade.

### Os valores, prontos e editáveis

A aba **Valores** já vem preenchida — valor da cartela, quantas, custo total, e
o resultado financeiro da última conferência ou simulação. A tabela de prêmios
fica recolhida. Tudo o que é preço se edita ali, e escreve na **mesma** tabela
da tela principal: dois lugares do aplicativo com preços diferentes seria um
deles mentindo.

## O bolão dividido duas vezes

Quem abre um link de parte vê os bilhetes dele. Se então mexesse em "dividir com
outras pessoas", o aplicativo dividia **a parte** e gerava links que dizem
"parte *i* de *n* do fechamento" — e quem abrisse aquele link receberia outra
coisa, maior, do que a contagem que estava na tela de quem enviou.

E o pior deles, que só aparece no aparelho de outra pessoa: o link carrega o
fechamento em `f=v-k-t`, e o aplicativo **ignorava** isso. Os bilhetes vinham do
fechamento que o orçamento guardado naquele aparelho escolheria. Medido: com
R$ 20.000 guardados, quem recebia uma parte de cinco bilhetes abria outra coisa
inteira. Cada participante jogava um bolão diferente, e a cobertura combinada —
que é a razão de existir do bolão — não valia nada.

Agora o link fixa o fechamento, pondo o orçamento no preço exato dele: a escada
para naquele degrau, pelo caminho de sempre. E mexer no dinheiro desfaz o
vínculo com o link, porque a pergunta deixou de ser a do bolão.

E a carteira de quem é parte guardava o fechamento inteiro: um custo que essa
pessoa não pagou, ao lado de um retorno que é só o dela. A conta não fechava
para ninguém.

Agora a divisão é sempre do fechamento inteiro, para todo mundo. É o que o link
sabe expressar, e é o que faz sentido: quem organiza um bolão divide o
fechamento; quem recebeu uma parte não tem o que redividir. A suíte cobra que a
soma das partes vistas por um participante seja o fechamento inteiro, e não a
parte dele.

## A carteira guardava tudo, e não devolvia nada

*"O que eu já joguei"* guarda, de cada fechamento, o que descreve o pedido
inteiro: as dezenas daquele dia, a combinação, quantas cartelas, quanto custou,
a data e — depois de conferido — quanto voltou. Tudo o que é preciso para
remontar aquele fechamento exatamente.

E não havia como. Cada registro oferecia um botão: *apagar*.

O jogo é feito no sábado e o sorteio sai no sábado à noite, mas a conferência de
verdade é a de dias depois, quando a pessoa lembra. Aí ela abre o aplicativo e
encontra a linha certa na carteira — *13 acertos garantidos · 694 cartelas de 15
dezenas · R$ 2.429,00 · 05/09/2026* — e não tem o que fazer com ela. Para
conferir, precisaria remontar o fechamento de cabeça: marcar de novo as mesmas
vinte e três dezenas, uma a uma, e acertar o mesmo dinheiro, torcendo para cair
na mesma linha do catálogo. Conferir um bilhete velho contra o sorteio de hoje é
a coisa mais comum que se faz com um bilhete de loteria, e era a única que a
carteira não deixava fazer.

Cada registro ganhou um segundo botão, **Abrir**. Ele põe de volta as dezenas e
fixa a combinação; as cartelas saem do catálogo de sempre, e não do que foi
guardado — o registro é o pedido, não a resposta. A conferência então já
funciona como sempre funcionou, e `anotarNaCarteira` reencontra o mesmo registro
e escreve nele quanto voltou.

E a tela passou a dizer de onde ele veio. A linha abaixo da régua explica por
que o número na tela não é o que o dinheiro compraria, e ela tinha duas
respostas: *"este é o fechamento do bolão que compartilharam com você"* e
*"você montou este fechamento à mão, em montar do meu jeito"*. Um jogo que volta
da carteira não é nenhum dos dois, e cairia no segundo — a tela contando à
pessoa uma história que não foi a dela. O pedido guardado passou a carregar de
onde veio, com dois valores possíveis e o padrão na mão, para que um
armazenamento estragado não vire frase na tela.

O botão só aparece quando o registro **pode** voltar: as dezenas guardadas têm
de existir e ser tantas quantas o pool diz, e a combinação tem de continuar no
catálogo. Registros de versões antigas não guardavam dezenas, e um fechamento
sem as dezenas dele não é um fechamento — é um preço. Melhor não oferecer do que
oferecer e devolver outra coisa.

A conferência guarda um jogo, mexe no dinheiro para tirá-lo da tela, e cobra
cinco coisas: que haja onde tocar, que a resposta volte a ser a mesma, que a
tela diga que ela veio da carteira, que as dezenas marcadas voltem a ser as
mesmas, e que as cartelas venham junto — uma manchete certa sobre uma lista
vazia seria o pior jeito de isto falhar.

A primeira dessas quatro nasceu de a prova ter dado errado. Tirado o botão para
ver a suíte reprovar, ela não reprovou: **abortou**. O toque estava escrito
direto, e clicar num botão que não existe faz o navegador esperar e estourar,
matando a suíte inteira sem relatar nada — nem verde, nem vermelho, só um rastro
de pilha. Um teste que aborta é pior do que um que reprova, porque não diz o que
está errado. Agora ele confere que há onde tocar antes de tocar, e sem o botão
saem três reprovações com o defeito escrito em cada uma.

### E os botões da carteira também eram todos iguais

Com três jogos guardados, a carteira mostra seis botões e duas palavras:
*Abrir*, *Apagar*, *Abrir*, *Apagar*, *Abrir*, *Apagar*. Na tela isso basta — a
linha ao lado diz de que jogo cada par é. Na lista de botões de um leitor de
tela, não diz nada, e apagar o errado apaga o jogo de outro dia, sem desfazer. É
exatamente o caso dos quatro *"Copiar link"* do bolão, que já tinha sido
consertado ali e não tinha sido procurado aqui.

O texto visível continua curto; o nome acessível passa a descrever o registro —
*"Apagar o fechamento de 13 acertos com 694 cartelas, de 05/09/2026"*. A
conferência guarda três jogos diferentes e cobra que os seis nomes sejam seis.

## O que estava guardado também vem de fora

O aplicativo já tratava o endereço como texto de estranho: `lerLink` lê o que
veio depois do `#`, confere a forma e o catálogo, e devolve `null` para tudo o
que não for um fechamento que existe. Um link velho, ou adulterado, não
consegue fazer a tela prometer nada.

O `localStorage` não tinha esse cuidado, e é a mesma categoria de entrada. O que
está lá foi escrito por **outra** execução do aplicativo: uma versão anterior,
com outro formato; uma gravação interrompida no meio; outra aba mexendo ao
mesmo tempo. Ler aquilo como se fosse estado próprio era confiar num
desconhecido por ele já estar dentro de casa.

O preço disso foi medido caso a caso, contra os bytes publicados. Quatro chaves
estragadas não davam defeito: davam **tela em branco**.

| o que estava guardado | o que acontecia |
|---|---|
| `dezenas` sem ser uma lista | `TypeError: object is not iterable` |
| `carteira` com um `null` no meio | `TypeError: Cannot read properties of null` |
| `carteira` sem ser uma lista | `TypeError: estado.carteira.map is not a function` |
| `precos` com `"premio": null` | `TypeError: Cannot convert undefined or null to object` |

Nenhuma dessas telas tinha conserto do lado de quem usa. O aplicativo abria
vazio, não dizia nada, e o único remédio — limpar os dados do site — é coisa que
ninguém adivinha.

Outros dois casos abriam, e eram piores de outro jeito, porque pareciam
funcionar: `["a", null, 99, -3, 1, 2]` fazia a tela contar **seis dezenas** com
duas marcadas na grade, e pedir mais nove quando faltavam treze — um pool
imaginário escolhendo um fechamento que não era o da pessoa. E um orçamento
guardado como `"muito"` chegava ao campo do dinheiro como **"R$ NaN"**.

A correção é uma só, e está na leitura: `lembrar` passou a receber, junto do
padrão, o que aquela chave precisa ser. O que não passa é dispensado, e o
aplicativo abre com o padrão — perder o que estava guardado é aceitável; não
abrir, não é. Cada item da carteira precisa ser um objeto com custo em centavos;
cada dezena, um inteiro de 1 a 25; cada preço editado, dinheiro. `fixo` é a
exceção que confirma a regra: ele não ganha conferência de forma na leitura
porque já tem uma melhor adiante — `fixoValido`, a mesma porta por onde passa o
fechamento montado à mão, que reprova qualquer coisa que o catálogo não tenha.

A mesma regra alcançou um lugar onde ela é mais irônica. *"Buscar o último
concurso"* tem uma rede pela frente e um `catch` atrás: sem resposta, ele usa o
resultado guardado da última vez. Só que esse resultado sai do mesmo
armazenamento — e um estragado fazia o `catch`, que existe justamente para nada
estourar, estourar. O botão ficava em **"Buscando…"** para sempre, sem erro na
tela e sem caminho de volta, exatamente no momento em que a pessoa está sem
rede. Agora o que estava guardado passa pela mesma porta por onde passa o que
ela digita, `dezenasDoTexto`, e duas dezenas guardadas não viram mais "Concurso
1" ao lado de um campo pela metade.

Os treze casos que cobram tudo isso rodam num navegador de verdade, com a
memória do aparelho preenchida antes de a página carregar. São dezoito
conferências: a mesma pergunta de base em cada caso — *abre e responde?* — mais
o que aquele caso tem de particular. Doze delas foram vistas **falhar** com o
código antigo, cada uma com o defeito dela escrito no relatório; as outras seis
são a pergunta de base onde ela já passava. Um teste que passa dos dois jeitos
não prova nada, e por isso todo caso aqui tem pelo menos uma conferência que se
viu reprovar.

## O que é isto, dito antes de pedir dinheiro

A primeira tela abria com o nome do aplicativo e, logo abaixo, um campo pedindo
**quanto você quer gastar**. Quem chega pelo link não sabe de que loteria se
trata, nem o que vai receber em troca — o `<title>` e a descrição do HTML dizem,
e ninguém lê nenhum dos dois num telefone.

Uma linha, sem jargão de quem já sabe:

> Cartelas da Lotofácil que, juntas, garantem acertos.

Sete palavras que carregam as três coisas: **qual loteria**, **o que sai** e
**de onde vem a garantia** — do "juntas". A palavra *fechamento* não aparece, e
a conferência cobra isso: a linha tem de citar a Lotofácil, tem de falar em
cartelas e em garantir, e **não pode** conter "fechamento", "cobertura" nem
"covering". A especificação pede que alguém que nunca ouviu falar de covering
design use o aplicativo sem ajuda; o primeiro parágrafo é onde isso começa.

## Uma palavra só para a mesma coisa

No mesmo cartão, para quem nunca ouviu falar de fechamento, a tela dizia:

> **28 jogos** de 16 dezenas · R$ 1.568,00
> Se as 15 dezenas sorteadas saírem todas entre as suas 25, ao menos um destes
> **bilhetes** terá 11 acertos ou mais.
> …
> **28 cartelas** de 16 dezenas

Três palavras para o mesmo papel preenchido, em dez linhas. E a distinção
passou a carregar peso: uma **cartela** de 16 dezenas contém 16 **apostas**
simples, e é dessa diferença que sai o prêmio. Com as palavras embaralhadas, a
explicação não tem onde se apoiar.

O aplicativo passou a usar três palavras para três coisas, e só:

| palavra | o que é |
|---|---|
| **cartela** | um papel preenchido, com `k` dezenas |
| **aposta** | uma das `C(k,15)` apostas simples dentro de uma cartela |
| **fechamento** | o conjunto de cartelas que se completam |

A conferência não olha uma frase: varre as três regiões que a pessoa lê antes de
abrir a análise — a resposta, o cartão do que foi gerado e o rodapé do degrau —
e reprova se aparecer mais de uma palavra para o papel, tanto no fechamento
escolhido pelo dinheiro quanto num montado à mão com cartela de 16. Ao desfazer
a troca, ela aponta com as palavras que achou: *usou cartela e bilhete e jogo*.

Junto veio um número que não tinha unidade. Ao lado de "R$ 1.568,00", o selo de
*menor conhecido* dizia **"nenhum fechamento faz isso com menos de 5"** — cinco
o quê? Cinco reais, para quem lê rápido. Agora diz cinco cartelas.

## Quarenta e quatro pixels

O alvo de toque mínimo não é opinião: é a largura aproximada de uma ponta de
dedo, e abaixo dela errar o botão vizinho deixa de ser descuido e passa a ser o
normal. O aplicativo inteiro já respeitava o número — os botões, os campos, os
`summary` que abrem as seções. A barra de abas da área de análise nasceu com
**40**, e ela é a navegação inteira daquela área: errar o alvo ali não é um
toque perdido, é trocar de assunto.

A conferência que cobra isso não cita seletor nenhum. Ela varre todos os
`button`, `summary`, `a[href]`, `input` e `select` visíveis da tela principal e
de cada uma das cinco abas, e reprova qualquer um com menos de 44 px em
qualquer direção — porque o próximo lugar a nascer pequeno não vai ser este. Ao
descer a barra de volta para 40 px, as cinco abas aparecem no relatório com a
medida delas ao lado.

## Um valor de dinheiro cortado é um valor errado

O prêmio de 15 acertos aparecia na tabela de preços como **"R$ 1.700.000,"** —
com os centavos cortados fora, em toda largura de tela. A coluna do campo tinha
8 rem fixos; o valor precisa de 146 px e cabiam 126. Não era o campo mais
importante da tela, e era o único número da tabela que a pessoa não conseguia
ler inteiro.

Passou a 10,5 rem. De 360 px para cima nada mais mudou; em 320 px o rótulo ao
lado quebra em duas linhas — *15 / acertos* —, que é o que se troca por ver o
valor completo, e é a troca certa.

A conferência que passa a cobrar isso não cita esse campo: varre todos os
campos visíveis da tela principal e das cinco abas e reprova qualquer um cujo
conteúdo seja mais largo do que a caixa — `scrollWidth > clientWidth`. Com a
coluna de volta a 8 rem, ela aponta seis vezes, com a medida ao lado.

## Quatro botões com o mesmo nome

Olhar a tela pelo nome dos elementos, e não pelo desenho, mostra o que o desenho
esconde. Num bolão de quatro partes, os quatro botões se chamam *"Copiar link"*.
Na tela isso basta: a linha ao lado diz *Parte 2 — 83 bilhetes*, e o dedo sabe
onde está. Na lista de botões de um leitor de tela são quatro vezes a mesma
frase e nenhuma maneira de escolher — e escolher errado ali é jogar a parte de
outra pessoa. O texto visível continua *"Copiar link"*, porque na tela ele está
certo; o nome acessível passa a ser *"Copiar o link da parte 2"*.

E os títulos pulavam de nível: `h1` no nome do aplicativo, `h3` nas tabelas de
preço, e nada entre os dois. Quem navega por título passa do nome do aplicativo
direto para a tabela sem saber o que pulou. Viraram `h2`, com o desenho
inalterado — 13,6 px, peso 600, maiúsculas, a mesma cor. Era o nível que estava
errado, não a aparência.

Ao lado, o que a mesma varredura mediu e não teve o que corrigir: nenhum
controle sem nome acessível em nenhuma das seis telas, `lang` declarado,
imagens com `alt`, marcos (`main`, `footer`, `dialog`, `tablist`) no lugar, e o
foco voltando para o botão *"Visualizar cartelas"* quando a área de análise
fecha.

## A quinta aba não cabia em telefone nenhum

A área de análise tem cinco abas — cartelas, conferir, simular, valores, resumo
—, e as cinco somam **455 px** de conteúdo. A barra rolava na horizontal quando
não coubesse, com a barra de rolagem escondida por estilo. Medindo a largura
útil dela nos telefones que existem:

| tela | cabe | precisa | a última aba termina em |
|---|---:|---:|---:|
| 320 px | 288 | 455 | 471 |
| 360 px | 328 | 455 | 471 |
| 390 px | 358 | 455 | 471 |
| 414 px | 382 | 455 | 471 |

Em nenhuma. E nada dizia que havia mais: sem barra de rolagem, sem sombra na
borda, sem meia aba assomando — a quinta simplesmente não existia para quem
olhasse. A escondida era a do **resumo**, que é onde mora a varredura exaustiva:
a prova, no aparelho da pessoa, da garantia que a primeira tela anuncia. O
aplicativo escondia a própria prova atrás de um gesto que ninguém tinha motivo
para tentar.

A barra passou a quebrar em duas linhas, e as abas de cada linha repartem a
sobra entre si em vez de deixar um buraco à direita. Custa cerca de 50 px de
altura no topo da área, em telefone; numa tela larga as cinco voltam a caber
numa linha só. *"Uma coisa de cada vez, todas a um toque"* só era verdade na
metade que se via.

Repartir a linha trouxe junto uma pergunta que a rolagem escondia: **que linha?**
Numa tela de 1.200 px o conteúdo da área fica numa coluna de 704, centrada, e a
barra de navegação dele ficava com os 1.168 da janela — cinco pílulas de 230 px
alinhadas com nada. O cabeçalho passou a viver na mesma coluna do conteúdo, e a
conferência mede as duas caixas e cobra que as bordas coincidam.

A conferência é de posição, e não de estilo — qualquer jeito de fazer as cinco
caberem passa: ela abre a área nas quatro larguras e reprova qualquer aba cuja
caixa comece antes de zero ou termine depois da borda. Com a rolagem de volta,
ela aponta as quatro larguras, uma a uma, com a medida ao lado.

### E o cabeçalho grudava em duas peças

Achado no mesmo lugar, medindo a mesma barra. O título da área — com o botão
*"Voltar"*, que é a única saída dela — e a barra de abas grudam no topo quando a
página rola, e grudavam **cada um por sua conta**. O de baixo precisava então
saber a altura do de cima, e sabia por um número escrito à mão: `top: 3rem`,
contra os **63 px** que o título mede de verdade.

A diferença de 15 px era o quanto as abas subiam por cima do título assim que a
página rolasse — cobrindo o rodapé do botão de sair. Não é defeito novo: `3rem`
nunca foi 63 px, e a sobreposição estava lá desde que os dois passaram a grudar.
O que mudou foi a chance de alguém dar de cara com ela — a barra de abas ficou
com duas linhas e o dobro de peso na tela.

Os dois passaram a ser um bloco só, que gruda inteiro. Não há número a acertar:
a conta passou a ser a do navegador. A conferência rola a área e mede as três
caixas — título, abas e botão —, exigindo que nenhuma invada a outra; e exige
antes que a rolagem tenha de fato acontecido, porque sem rolar nada gruda e a
conferência passaria sem ter olhado para o que existe para olhar.


## A barra que media sempre a mesma coisa

Na tabela de distribuição da simulação — *"melhor cartela do sorteio"* — havia
uma quarta coluna com uma barrinha, para a leitura de relance antes do número.
Ela desenhava **sempre o mesmo traço**. Medido nas seis linhas de uma simulação
de 100 sorteios:

| a linha pedia | a barra saiu | a célula tinha |
|---:|---:|---:|
| 0% | 2 px | 12 px |
| 2% | 2 px | 12 px |
| 22% | 2 px | 12 px |
| 24% | 2 px | 12 px |
| 95% | 2 px | 12 px |
| 100% | 2 px | 12 px |

A largura ia em porcentagem, e porcentagem se resolve contra a caixa de quem
contém. Quem continha era uma célula de tabela sem largura própria, que por sua
vez se dimensionava pelo conteúdo — a barra. A conta era circular, o navegador
resolvia em quase nada, e todas as barras caíam nos 2 px do `min-width` que
existia justamente para nenhuma sumir. Uma coluna inteira ocupando espaço numa
tela de telefone e não dizendo nada, desde que foi escrita.

O conserto é um trilho de largura fixa — 3 rem — em volta da barra: agora a
porcentagem tem contra o que se medir, e o trilho ainda mostra o que falta para
o máximo. A conferência mede cada barra contra a fatia que a linha pediu, e
cobra também que barras de tamanhos diferentes **saiam** diferentes — porque a
primeira conferência sozinha passaria se o trilho voltasse a zero, com todo
mundo empatado nos 2 px do mínimo.

## Um ponto onde o Brasil escreve vírgula

A tabela que compara o fechamento com o chute dizia **"51.0%"** e **"46.0%"**; o
*"e se eu jogasse no chute?"*, **"94.7%"**. Numa tela onde o resto já vinha em
português — R$ 21,00, 1.631 cartelas, 1 concurso a cada 3.268.760 —, eram os
únicos números escritos como em inglês. `toFixed` não fala português, e era ele
que os escrevia.

Não muda conta nenhuma, e é exatamente por isso que vale: um número escrito de
dois jeitos na mesma tela é do tipo de coisa que faz a pessoa desconfiar de tudo
o que ela não tem como conferir sozinha — e o que este aplicativo pede que ela
aceite é justamente uma conta que ela não vai refazer. A conferência varre a aba
inteira atrás de qualquer porcentagem com ponto decimal, e a mesma varredura
passa pelo *"e se eu jogasse no chute?"*.

## Um teste que reprovava por sorteio

A suíte de tela reprovou uma vez, com a tela certa. A frase era esta:

> *1 sorteio caiu inteiro dentro do seu pool — e só nesses a garantia de 12
> acertos vale.*

O molde que a procurava era `ca[íi]ram?`: casa "caíram" e casa "caíra", e não
casa **"caiu"**. A frase tem três formas — nenhum, um, vários — e a do singular
sai quando exatamente um dos cem sorteios cai no pool. Num pool de 22 dezenas
cada sorteio cai dentro com probabilidade `C(22,15)/C(25,15) = 5,22%`, e sair
exatamente um em cem tem **2,6%** de chance: uma corrida em trinta e nove. Nas
outras trinta e oito a conferência passava.

Um teste que reprova por sorteio é pior do que um teste que falta: ele gasta o
crédito da suíte inteira, e ensina quem mantém o projeto a rodar de novo em vez
de olhar. E o mesmo molde alimentava a contagem da linha seguinte — *"na vida
real isso acontece poucas vezes, não sempre"* —, que no singular lia zero e
aprovava sem olhar para nada.

As três formas passaram a se conferir de uma vez, sem sorteio nenhum, e só
depois a frase de verdade passa pelo mesmo molde. Com o molde antigo de volta, a
forma do singular reprova todas as vezes, e não uma em trinta e nove.

## Duzentas e quarenta e três folhas, sem avisar

*"Imprimir volantes"* montava os volantes e chamava a impressão do sistema no
mesmo toque. Com as 55 cartelas de R$ 400 isso são quatro folhas e ninguém se
machuca. Com as **3.608** de R$ 15.000 são **241** — quinze volantes por folha
A4, medido no próprio desenho com a mídia de impressão emulada — e nada na tela
tinha dito isso antes de a caixa de impressão aparecer com a resma carregada.

O painel passou a dizer o tamanho: *"3.608 volantes · cerca de 241 folhas de
papel"*, os volantes abaixo para conferir, e um botão que diz quantas folhas
vai imprimir. A funcionalidade não saiu de lugar nenhum — ganhou a conta na
frente da conta. A linha do aviso e o botão são da tela e não vão para o papel:
gastar a primeira folha para dizer quantas folhas seriam é o tipo de piada que
ninguém acha graça impressa.

Foi assim que apareceu o defeito de verdade, que já estava lá: o painel de
volantes abria **atrás** da área de análise. A área é uma camada opaca de tela
cheia, o painel não tinha ordem de empilhamento nenhuma, e é de dentro da área
que se pede para imprimir. Quem fechasse a caixa de impressão do sistema ficava
com um painel aberto que não dava para ver nem fechar — o ✕ dele estava
escondido junto. Com a impressão saindo no mesmo toque, dava para nunca
perceber; com um segundo toque a pedir, o painel invisível vira um beco. Uma
linha de CSS resolve, e a conferência que a cobra não olha a linha: ela pergunta
ao navegador quem está no topo daquele ponto da tela.

## Chegar à tela em 3G

O alvo da especificação é **primeira renderização útil em menos de 1 s em 3G
rápido**. Ele é medido por `ferramentas/medir-3g.mjs`, que sobe um servidor
HTTP/2 com compressão e certificado próprio — como o GitHub Pages serve — e
estrangula a rede pelo mesmo preset do Chrome (1,6 Mbps, 562,5 ms de ida e
volta):

```bash
./construir-app.sh && node ferramentas/medir-3g.mjs
```

Isso importa mais do que parece. Este era o **único** número do projeto que
vivia como frase num documento: todos os outros — preço, quantidade de
bilhetes, garantia — são recalculados do catálogo e cobrados em CI. Um número
que ninguém consegue refazer é um número em que ninguém deveria acreditar, e a
primeira medição feita em HTTP/1.1 mostrou ganho zero para as dicas de
`modulepreload`, quase enterrando uma otimização que funciona.

| | antes das dicas | com as dicas | hoje |
|---|---:|---:|---:|
| primeira pintura | 1.200 ms | 1.260 ms | 1.340 ms |
| grade tocável | 1.880 ms | 1.360 ms | 1.474 ms |
| resposta na tela | 2.500 ms | 1.370 ms | 1.501 ms |
| pedidos no caminho crítico | 14 | 9 | 11 |

A coluna de hoje carrega a área de análise, o módulo de simulação, a conta que
decompõe um bilhete grande em apostas simples e o que a carteira passou a
devolver: 45 KiB comprimidos contra 26, dois pedidos a mais, e cento e trinta
milissegundos. O caminho continua sendo **uma onda só**, que é o que as dicas
compraram. As últimas quatro passadas de trabalho não custaram nada mensurável
aqui — os números são a mediana de três corridas, e a diferença para a medição
anterior cabe no ruído entre elas.

Esse 11 quase virou 25. O medidor contava os pedidos no servidor, e o servidor
vê também o que vem **depois** da resposta: o service worker instalando, que
rebaixa a casca inteira para a segunda visita funcionar sem rede. Somados,
davam vinte e tantos pedidos — um número que sobe sem que nada tenha piorado, e
que já estava a caminho do documento. Quem sabe o que a resposta esperou é a
própria página, e é dela que o número passa a sair: `performance
.getEntriesByType('resource')`. Os dois aparecem lado a lado, porque dizem
coisas diferentes: um é o que a pessoa espera, o outro é o que a rede dela paga.

E uma linha do medidor dizia o contrário do que se mede. O comentário sobre o
`cache-control` afirmava que `no-store` fazia o service worker rebaixar tudo —
"vinte e seis pedidos no lugar de doze". Medido dos dois jeitos, `no-store` e
`max-age=600` dão a **mesma** contagem: a segunda onda acontece de qualquer
forma. O cabeçalho continua sendo o do GitHub Pages, por fidelidade, e o
comentário passou a dizer o que a medição diz. Ela custa cerca de 43 KiB depois
que a resposta já está na tela, e não atrasa ninguém — mas é tráfego que a
pessoa paga, e agora está escrito.

A resposta chegava em duas ondas encadeadas desnecessárias. O navegador só
descobre `catalogo.js`, `conferir.js`, `estrategia.js` e `volante.js` depois de
baixar e ler `app.js`; e só pede os três arquivos do catálogo depois de executar
os módulos. Com 562 ms de latência, cada onda custa mais de meio segundo.

Sete `<link>` no cabeçalho resolvem: `modulepreload` para os quatro módulos e
`preload` para os três JSON. Tudo passa a ser pedido junto, numa onda só.

O `crossorigin` nos três `preload` não é enfeite: sem ele o navegador baixava o
arquivo, não conseguia casá-lo com o `fetch` do aplicativo e **baixava de novo**
— dobrando o tráfego e mantendo a segunda onda. A cascata mostrava os dois
pedidos, um em cada onda.

Uma coisa que a medição mostrou e a intuição errou: o service worker instala
baixando a casca inteira, e isso partia **antes** dos três arquivos do catálogo,
que são o que a resposta espera. Parecia disputa de banda no pior lugar. Movido
para depois da resposta, o número não mudou — 1.450 ms contra 1.458 ms, ruído.
O caminho crítico é dominado pelas idas e voltas, não pela banda. A ordem nova
ficou, porque é a certa e não custa nada; o ganho que se esperava dela não
existe, e fica registrado para ninguém procurá-lo de novo.

O que resta é o piso: duas idas e voltas — o HTML, e tudo o que ele referencia.
Com os 562 ms do preset do Chrome isso são 1,13 s, e não há folga abaixo disso
sem embutir o CSS e o JavaScript no HTML, o que custaria a etapa de compilação
que este aplicativo não tem. Com uma latência de 3G real (150 a 300 ms) as
mesmas duas idas e voltas dão 300 a 600 ms, dentro do alvo. Fica registrado
assim, com a latência dita, em vez de escolhido o número que passa.

### E a segunda visita, que nunca tinha sido medida

`medir-3g.mjs` mede quem chega pela primeira vez — é o número da especificação.
Metade da promessa do aplicativo, porém, é sobre a **volta**: *"depois disso o
aplicativo funciona sem ela"*, diz a tela quando a primeira visita falha por
falta de rede. Essa metade nunca teve número.

`ferramentas/medir-volta.mjs` faz a visita de instalação, espera o service
worker assumir e a casca inteira entrar no cache dele, **apaga o cache HTTP do
navegador** e só então mede. A limpeza é o ponto: sem ela a segunda visita
acontece segundos depois da primeira, tudo ainda cabe no `max-age=600` que o
GitHub Pages manda, e o que sai é o número de quem recarregou a página — não o
de quem voltou no dia seguinte, que é quem o service worker existe para atender.

O resultado, igual em todas as corridas:

> **13 pedidos** chegam ao servidor antes de a resposta aparecer — `index.html`,
> os seis módulos, o estilo, os três arquivos do catálogo, o ícone e o próprio
> `sw.js`. A casca inteira, de novo.

É o que a estratégia manda, e ela é deliberada: para a casca vale **rede
primeiro, cache atrás**, para que uma correção publicada chegue no mesmo
instante. O cache do service worker é a rede de segurança — entra quando a rede
falha —, e não um atalho. O que faltava era o preço disso escrito em algum
lugar, e agora está: a promessa de funcionar sem internet **não** é a promessa
de carregar rápido na volta.

Trocar por *cache primeiro* pareceria óbvio e não é. O rodapé mostra o carimbo
da versão, e ele é lido de `sw.js` a cada visita justamente para a pessoa
conferir se o que está na mão dela é o que acabou de ser publicado. Servindo a
casca do cache, a página seria a antiga e o carimbo poderia ser o novo — o
rodapé passaria a mentir sobre a única coisa que ele existe para dizer. Fica
como está, agora com o custo medido ao lado.

### O relógio, aqui, mede o arranjo da medição

A ferramenta imprime também os milissegundos, com uma ressalva grande: **eles não
valem como medida de rede.** A estrangulação do protocolo de depuração vale para
a página, e não para o service worker — os `fetch` que ele faz por conta própria
saem por outro alvo e não passam pelo mesmo funil. Medido: quando ele está no
comando a resposta sai em ~100 ms; quando não está, em ~1.450 ms. A mesma casca,
a mesma rede declarada, catorze vezes de diferença — decidida por *quem buscou*,
e não por quanto custou.

Fica registrado em vez de apagado, porque a contagem de pedidos, essa sim, é
contada no servidor e não muda: é ela que responde à pergunta. Uma ferramenta
que imprimisse só o relógio pareceria mais convincente e diria menos.

## Como mexer

```bash
# Regerar o catálogo. Sem argumentos, percorre as 330 dando 5s a cada caso em
# aberto; o catálogo publicado entra como semente, então regerar só pode melhorar.
cargo run --release --bin gerar-catalogo -- 30

# Só alguns casos, com mais tempo. O resto do catálogo fica como está.
cargo run --release --bin gerar-catalogo -- 3600 25-16-13 24-16-14

# A varredura exaustiva de tudo. É o que roda em CI.
cargo run --release --bin conferir-tudo

# O site, em publicar/, com o carimbo da versão calculado do conteúdo.
./construir-app.sh

# As suítes.
cargo test --release -p gerar-catalogo   # a construção de Turán, por força bruta
node app/testar-estrategia.mjs           # a função que decide o que se compra
node app/testar-catalogo.mjs             # soma de verificação, posições, bolão
node app/testar-conferir.mjs             # a varredura do cliente, contra o catálogo
node app/testar-analise.mjs              # a conta do prêmio, e a decomposição da cartela
node servidor/testar-intencao.mjs        # o leitor que responde sem modelo
node servidor/testar-explicar.mjs        # a regra que descarta número inventado
node servidor/testar-resultado.mjs       # o sorteio oficial, sem sair para a rede
python3 ferramentas/provar-o-conferidor.py    # e o conferidor reprovando de propósito
node app/testar-tela.mjs                 # a tela, num navegador de verdade
                                         # (exige ./construir-app.sh antes: elas
                                         #  servem publicar/, não app/)
node app/testar-tela.mjs /repo/fechamentos/   # e de novo, na subpasta em que vai ao ar
node ferramentas/testar-convivencia.mjs       # os dois aplicativos no mesmo endereço

# Quanto a tela leva para responder em 3G rápido — na primeira visita, e na volta.
node ferramentas/medir-3g.mjs
node ferramentas/medir-volta.mjs

# E a prévia de arquivo único, para abrir o aplicativo sem servidor de arquivos.
python3 ferramentas/previa-artefato.py previa.html
node ferramentas/testar-previa.mjs previa.html

# Os números que este documento cita, recalculados do catálogo.
python3 ferramentas/numeros-do-catalogo.py --gravar
```

`CATALOGO_SAIDA` desvia a escrita e `CATALOGO_SEMENTES` acrescenta catálogos à
leitura — é assim que vários processos buscam casos diferentes ao mesmo tempo e
os resultados voltam a ser um catálogo só, conferidos de novo antes de gravar.

## Onde ele vai ao ar

Numa subpasta, **ao lado** do motor, e não no lugar dele:

| | |
|---|---|
| motor | `https://<dono>.github.io/<repo>/` |
| fechamentos | `https://<dono>.github.io/<repo>/fechamentos/` |

São dois aplicativos com dois públicos, e o endereço de cada um continua sendo o
que sempre foi — trocar um pelo outro tiraria do ar algo que funciona. O service
worker de `fechamentos/` tem escopo mais específico que o da raiz, então é ele
que atende as páginas de lá; e o carimbo é derivado do conteúdo sem o caminho,
então montar em `publicar/` ou em `site/fechamentos/` dá o mesmo número.

Que os dois convivem não é suposição: `ferramentas/testar-convivencia.mjs` põe os
dois no ar juntos, com o service worker do motor já instalado e no comando, e
cobra que a subpasta abra inteira, assuma as páginas dela e funcione sem rede —
sem a raiz perder a sua. E a suíte da tela roda duas vezes, na raiz e na subpasta:
um caminho absoluto esquecido funciona na raiz e quebra só depois de publicado.

`publicar.yml` monta os dois e, **antes de publicar qualquer um**, roda a
varredura exaustiva das 330 entradas. Uma falha ali bloqueia a publicação do site
inteiro, de propósito: pôr no ar metade seria pôr no ar um endereço que promete o
que não confere. `catalogo.yml` roda a mesma varredura e as **dez** suítes a cada
envio, em qualquer branch — cinco do cliente (a da tela duas vezes, na raiz e na
subpasta), três do servidor e duas de ferramenta.

## As 13 entradas sem bilhetes

Dezoito das 330 guardam só o piso, e por um motivo econômico, não matemático: o
menor fechamento conhecido passa de oito mil bilhetes, o que descreve compras de
dezenas de milhares de reais para cima. `k = 15` com `t = 15` num pool de 20, por
exemplo, é exatamente `C(20,15) = 15.504` bilhetes — mínimo provado, e R$ 54.264
de aposta. O aplicativo não oferece o que ninguém compraria, e diz que ali não há
fechamento catalogado em vez de inventar um.
