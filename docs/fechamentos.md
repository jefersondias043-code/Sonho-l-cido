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
esperar. O cliente inteiro dá **1.494 linhas** somando JavaScript, HTML e CSS —
teto de 1.500 cobrado pela construção —, e o peso inicial (casca, índice, preços
e distribuições) dá **24 KiB comprimidos**.

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
