# O aplicativo de fechamentos da Lotofácil

Um segundo aplicativo, ao lado do motor. Ele responde a **uma** pergunta:

> *"Como gasto melhor este dinheiro na Lotofácil?"*

A pessoa diz quanto quer gastar e quais dezenas quer jogar. O aplicativo devolve
os bilhetes prontos e, numa frase, o que exatamente está garantido.

## O que o dinheiro compra

Não é figura de retórica: é o catálogo respondendo. A pessoa diz quanto tem, e o
aplicativo escolhe o maior pool que cabe no bolso e, dentro dele, a maior
garantia paga — nesta ordem, porque garantia alta num pool pequeno é uma promessa
que quase nunca se cobra.

<!-- a tabela do dinheiro: gerada por ferramentas/numeros-do-catalogo.py -->
| orçamento | dezenas | garantia | fechamento | custo | |
|---:|---:|---|---|---:|---|
| R$ 5,00 | 19 | **11 acertos** | 1 jogo de 15 dezenas | R$ 3,50 | mínimo provado |
| R$ 25,00 | 22 | **11 acertos** | 6 jogos de 15 dezenas | R$ 21,00 | piso 3 |
| R$ 100,00 | 23 | **11 acertos** | 18 jogos de 15 dezenas | R$ 63,00 | piso 4 |
| R$ 400,00 | 25 | **11 acertos** | 57 jogos de 15 dezenas | R$ 199,50 | piso 10 |
| R$ 1.500,00 | 25 | **12 acertos** | 341 jogos de 15 dezenas | R$ 1.193,50 | piso 55 |
| R$ 15.000,00 | 25 | **13 acertos** | 4198 jogos de 15 dezenas | R$ 14.693,00 | piso 671 |
<!-- fim de a tabela do dinheiro -->

A linha dos quatrocentos reais é o produto inteiro num lugar só: as vinte e
cinco dezenas inteiras, onze acertos garantidos, e troco. Ninguém compõe isso de
cabeça. A última coluna diz o que se pode afirmar de cada linha: **mínimo
provado** quando nenhum fechamento faz aquilo com menos bilhetes, e o piso
conhecido quando não.

Nenhum número acima está escrito à mão — nem no texto ao redor, de propósito: um
preço citado em prosa é o que envelhece primeiro.

A tabela sai de `ferramentas/numeros-do-catalogo.py --gravar`, que a reescreve
aqui a partir de `catalogo/indice.json`. Cada passada do motor pode mudá-la, e um
preço velho num documento é uma promessa que o aplicativo não cumpre mais.

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
esperar. O cliente inteiro dá **1.499 linhas** somando JavaScript, HTML e CSS —
teto de 1.500 cobrado pela construção —, e o peso inicial (casca, índice, preços
e distribuições) dá **25 KiB comprimidos**.

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

> *…que aqui é **R$ 51,20** por concurso nas faixas de 11, 12 e 13 acertos —
> mais o que sair de 14 e 15, que é rateado e ninguém sabe de antemão.*

Contra R$ 199,50 gastos. É exato e é hipergeométrico, não simulado: sai das
distribuições de `acaso.json` por diferença, e a suíte refaz a mesma média
direto da definição, sem tocar no arquivo, para as duas baterem ao centavo. Um
bilhete simples devolve **25,7%** do que custa nas faixas fixas — e é o mesmo
para qualquer arranjo dos mesmos bilhetes, que é justamente o que faz dele a
prova de que o fechamento compra certeza, e não lucro.

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

## Recomeçar em vez de insistir

A busca é estocástica e a variância entre sementes é grande — o próprio
`motor-busca` registra uma medição em que trocar a semente mudou o resultado em
28 cartelas, mais do que o parâmetro que estava sendo medido. E o gerador usava
**uma semente fixa**: uma trajetória azarada não melhorava por durar mais, só
ficava mais longa.

Agora o orçamento de cada caso é dividido em recomeços de cinco minutos, cada um
com outra semente e partindo do melhor que já se achou — então recomeçar nunca
custa terreno. `CATALOGO_RECOMECOS` fixa o número de recomeços, e com 1 o
gerador volta a ser a corrida única de antes: é assim que a medição abaixo foi
feita, e é assim que se refaz.

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

Uma conferência que reusa o gerador só sabe dizer que o gerador concorda consigo
mesmo.

## A IA nunca toca em número

> A IA nunca gera, escolhe, altera ou valida bilhetes. Nunca calcula nem estima
> mínimos, coberturas ou limites inferiores.

São três usos, todos opcionais, todos com caminho alternativo determinístico:

- **intenção** — texto livre vira `{orcamento, dezenas[], garantiaMinima}` sob
  esquema estrito. Fora do esquema é silêncio, e um leitor por expressão regular
  assume;
- **explicação** — uma frase sobre a troca entre dinheiro e garantia, recebendo
  **apenas** números que o catálogo já produziu. A frase é descartada se trouxer
  qualquer número que não estava no pedido, e essa regra é cobrada duas vezes:
  no servidor e de novo no cliente, antes de tocar a tela;
- **narração pós-sorteio** — mesma restrição.

A chave nunca sai do servidor. Desligar a IA inteira mantém o aplicativo
funcional — é assim que ele está hoje, sem servidor nenhum. Como pôr as três
funções no ar está em [`servidor/LEIAME.md`](../servidor/LEIAME.md).

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
node app/testar-tela.mjs                 # a tela, num navegador de verdade
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
