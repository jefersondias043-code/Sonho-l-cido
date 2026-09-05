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
| R$ 100,00 | 23 | **11 acertos** | 15 jogos de 15 dezenas | R$ 52,50 | piso 4 |
| R$ 400,00 | 25 | **11 acertos** | 55 jogos de 15 dezenas | R$ 192,50 | piso 10 |
| R$ 1.500,00 | 25 | **12 acertos** | 331 jogos de 15 dezenas | R$ 1.158,50 | piso 55 |
| R$ 15.000,00 | 25 | **13 acertos** | 3634 jogos de 15 dezenas | R$ 12.719,00 | piso 671 |
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

> *Garantir 14 acertos com 20 dezenas custa R$ 1.582,00 — faltam R$ 1.282,00.*

É a outra metade do produto. O aplicativo já dizia o que o dinheiro compra;
passou a dizer também quanto custa o que a pessoa quer.

## Quanto isso devolve, em média

Ao lado de *"em média os dois pagam o mesmo"* — que era uma frase que se lê como
consolo — agora vem o número:

> *…que aqui é **R$ 49,41** por concurso nas faixas de 11, 12 e 13 acertos —
> mais o que sair de 14 e 15, que é rateado e ninguém sabe de antemão.*

Contra R$ 192,50 gastos. É exato e é hipergeométrico, não simulado: sai das
distribuições de `acaso.json` por diferença, e a suíte refaz a mesma média
direto da definição, sem tocar no arquivo, para as duas baterem ao centavo. Um
bilhete simples devolve **25,7%** do que custa nas faixas fixas — e é o mesmo
para qualquer arranjo dos mesmos bilhetes, que é justamente o que faz dele a
prova de que o fechamento compra certeza, e não lucro.

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
esperar. O cliente inteiro dá **1.672 linhas** somando JavaScript, HTML e CSS —
teto de 1.700 cobrado pela construção —, e o peso inicial (casca, índice, preços
e distribuições) dá **29 KiB comprimidos**.

O teto foi 1.500 enquanto havia uma porta de entrada só. Ele não subiu porque o
cliente passou a resolver mais — resolve exatamente o mesmo, nada —, mas porque
ganhou a segunda porta: a lista do catálogo, os quatro filtros, o plano fixo e o
ajuste do pool, cerca de duzentas linhas em que não há uma conta de cobertura.
Escolher é do usuário, e escolha não tem como ser pré-computada.

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

## Mínimo provado e menor conhecido nunca se confundem

Cada entrada carrega o **piso** — o limite inferior provado, pela cota de
contagem, por Schönheim, pela cota de Turán no avesso ou pela tabela publicada —
e o **tamanho encontrado**. `provado` é verdade se, e somente se, os dois se
encontram. Na tela isso vira dois selos que não se parecem:

- **mínimo provado** — nenhum fechamento faz isso com menos bilhetes. Ponto.
- **menor conhecido** — este é o menor que se achou, e ao lado aparece o piso:
  *"nenhum fechamento faz isso com menos de 46"*.

Hoje o catálogo tem **206 das 330 no mínimo provado** e 312 com bilhetes
publicados. E vale dizer em que cada prova se apoia, porque não são todas iguais:

<!-- a tabela das provas: gerada por ferramentas/numeros-do-catalogo.py -->
| de onde vem o mínimo | quantas | quem confere |
|---|---:|---|
| aritmética fechada — um bilhete de `k` num pool de `v` cruza `k + 15 − v` com qualquer sorteio, e quando isso já alcança `t` o mínimo é 1 | 145 | `conferir-tudo` refaz o argumento |
| fórmula — `k = 15` com `t = 15` exige que o bilhete **seja** o sorteio, logo todos os `C(v,15)` | 10 | `conferir-tudo` refaz o argumento |
| cota de Turán no avesso | 34 | a cota vem de `motor-core`, validada lá contra números publicados |
| cota de Schönheim | 17 | a cota vem de `motor-core`, validada lá contra números publicados |
<!-- fim de a tabela das provas -->

Nos 155 primeiros o conferidor independente não acredita em ninguém: recalcula. Nos
51 restantes a prova se apoia numa cota que o `motor-core` implementa e testa
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

## Chegar à tela em 3G

O alvo da especificação é **primeira renderização útil em menos de 1 s em 3G
rápido**, e ele nunca tinha sido medido. Medido — servido como o GitHub Pages
serve, HTTP/2 com compressão, sob a rede "3G rápido" do próprio Chrome
(1,6 Mbps, 562 ms de ida e volta):

| | antes | agora |
|---|---:|---:|
| primeira pintura | 1.200 ms | 1.260 ms |
| grade tocável | 1.880 ms | 1.360 ms |
| resposta na tela | 2.500 ms | 1.370 ms |
| pedidos | 14 | 9 |

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

O que resta é o piso: duas idas e voltas — o HTML, e tudo o que ele referencia.
Com os 562 ms do preset do Chrome isso são 1,13 s, e não há folga abaixo disso
sem embutir o CSS e o JavaScript no HTML, o que custaria a etapa de compilação
que este aplicativo não tem. Com uma latência de 3G real (150 a 300 ms) as
mesmas duas idas e voltas dão 300 a 600 ms, dentro do alvo. Fica registrado
assim, com a latência dita, em vez de escolhido o número que passa.

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
node servidor/testar-intencao.mjs        # o leitor que responde sem modelo
node servidor/testar-explicar.mjs        # a regra que descarta número inventado
node servidor/testar-resultado.mjs       # o sorteio oficial, sem sair para a rede
python3 ferramentas/provar-o-conferidor.py    # e o conferidor reprovando de propósito
node app/testar-tela.mjs                 # a tela, num navegador de verdade
                                         # (exige ./construir-app.sh antes: elas
                                         #  servem publicar/, não app/)
node app/testar-tela.mjs /repo/fechamentos/   # e de novo, na subpasta em que vai ao ar
node ferramentas/testar-convivencia.mjs       # os dois aplicativos no mesmo endereço

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
que não confere. `catalogo.yml` roda a mesma varredura e as sete suítes a cada
envio, em qualquer branch.

## As 18 entradas sem bilhetes

Dezoito das 330 guardam só o piso, e por um motivo econômico, não matemático: o
menor fechamento conhecido passa de oito mil bilhetes, o que descreve compras de
dezenas de milhares de reais para cima. `k = 15` com `t = 15` num pool de 20, por
exemplo, é exatamente `C(20,15) = 15.504` bilhetes — mínimo provado, e R$ 54.264
de aposta. O aplicativo não oferece o que ninguém compraria, e diz que ali não há
fechamento catalogado em vez de inventar um.
