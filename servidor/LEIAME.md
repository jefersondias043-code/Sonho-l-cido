# As três funções de servidor

Nenhuma delas é necessária. O aplicativo funciona inteiro sem servidor nenhum —
é assim que ele está no GitHub Pages hoje —, e cada uma tem um caminho
alternativo determinístico que assume quando a chamada falha, demora mais de
quatro segundos ou responde fora do esquema.

| arquivo | o que faz | sem ele |
|---|---|---|
| `intencao.js` | texto livre → `{orcamento, dezenas[], quantasDezenas, garantiaMinima}` | um leitor por expressão regular, dentro do cliente, lê o mesmo pedido |
| `explicar.js` | números já calculados → uma frase | a frase determinística que já está na tela permanece |
| `resultado.js` | o último concurso da Lotofácil, com cache de 24 h | o último concurso guardado no aparelho, ou as 15 dezenas digitadas |

## Onde o cliente as procura

Em `api/`, **relativo à página**. Com o aplicativo servido em
`https://exemplo/fechamentos/`, ele chama:

```
POST  https://exemplo/fechamentos/api/intencao   {"texto": "..."}
POST  https://exemplo/fechamentos/api/explicar   {"v":20,"k":15,"t":13,...}
GET   https://exemplo/fechamentos/api/resultado
```

Qualquer resposta que não seja um JSON no formato esperado — inclusive o 404 de
quando não há servidor — cai no caminho alternativo, em silêncio. É de propósito:
um aviso de "a IA está fora do ar" não ajudaria ninguém a comprar um fechamento.

## Como pôr no ar

Os três são *handlers* no formato Web padrão (`export default { fetch(pedido,
ambiente) }`), sem dependência nenhuma. Servem em Cloudflare Workers, Deno
Deploy, Vercel Edge, Netlify Edge, Bun e Node moderno.

Cloudflare Workers, uma função por rota:

```toml
# wrangler.toml
name = "fechamentos-intencao"
main = "servidor/intencao.js"
compatibility_date = "2026-01-01"
```

```bash
wrangler secret put ANTHROPIC_API_KEY   # só para intencao.js e explicar.js
wrangler deploy
```

Depois, aponte `…/fechamentos/api/intencao` para o Worker — por rota no próprio
Cloudflare, ou por um proxy à frente do GitHub Pages.

## A chave

`ANTHROPIC_API_KEY` chega pelo segundo argumento do `fetch` (`ambiente`) e
**nunca** sai do servidor. Sem ela, `intencao.js` e `explicar.js` nem tentam
falar com o modelo: vão direto ao caminho alternativo. `resultado.js` não usa
chave nenhuma.

## O que o modelo não pode fazer

`explicar.js` recebe apenas números que o catálogo já produziu, e a frase que
volta é descartada se contiver **qualquer** número que não estava no pedido. A
regra é cobrada duas vezes — aqui, antes de a resposta sair, e de novo no
cliente, antes de o texto tocar a tela — e tem teste próprio em
`testar-explicar.mjs`, com as formas que ela precisa recusar: uma conta feita
pelo modelo, um arredondamento, um número inventado, e a frase certa com um
dígito trocado.

A regra sabe como o Brasil escreve dinheiro. Sem isso ela rejeitava **toda**
frase com preço: "R$ 199,50" vira os números 199 e 50, e nenhum dos dois estava
autorizado — o modelo tinha sido chamado justamente para falar de dinheiro. E
reais inteiros só passam quando o valor é inteiro, porque arredondar é calcular.
O conjunto de números autorizados sai de `numerosDe`, exportada para que a suíte
use o que o servidor usa: montá-lo à mão no teste foi o que escondeu isto por
dias.

`intencao.js` devolve três números e uma lista de dezenas, tudo validado campo a
campo contra o esquema antes de sair. O cliente valida de novo antes de aplicar.
E o leitor por expressão regular **recusa** o que não existe em vez de aparar:
"quero 30 dezenas" não é um pedido de 25. Aparar seria inventar, e o leitor do
cliente já recusava — o mesmo texto não pode mudar de significado conforme haja
ou não um servidor no ar.

`resultado.js` é a única das três que fala com um terceiro, e a única cujo erro
não é um texto feio na tela: um sorteio errado faz a conferência dizer que a
pessoa não ganhou quando ganhou. A suíte troca o `fetch` global — nada sai para
a rede — e cobra o que não pode virar resultado: menos de quinze dezenas, uma
dezena repetida (que completava quinze e passava), uma fora de 1 a 25, concurso
ausente ou zero, origem fora do ar, rede caída.

```bash
node servidor/testar-intencao.mjs
node servidor/testar-explicar.mjs
node servidor/testar-resultado.mjs
```
