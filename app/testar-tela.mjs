// Testes da tela, num navegador de verdade.
//
// O que se cobra aqui é o que nenhum teste de módulo alcança: que dois toques
// bastem do carregamento à lista de bilhetes, que a régua troque a estratégia
// inteira, que a palavra "mínimo" só apareça onde há prova, que a varredura
// exaustiva rode sem travar a tela, e que a segunda visita funcione sem rede.
//
//     ./construir-app.sh && node app/testar-tela.mjs [caminho-base]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { exigirConstrucaoFresca } from '../ferramentas/publicar-esta-fresco.mjs';

const BASE = process.argv[2] ?? '/';
const RAIZ = new URL('../publicar', import.meta.url).pathname;
const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

exigirConstrucaoFresca();

let feitos = 0;
const falhas = [];

// O fechamento existe quando o cartão de "Fechamento gerado" aparece — as
// cartelas em si moraram para a área de análise, e chegar a elas é um toque.
const esperarFechamento = (pg, ms = 30000) => pg.waitForSelector('.gerado', { timeout: ms });

/// Quantas cartelas o fechamento tem, lido de onde a tela diz. Sem fechamento,
/// zero — e não uma espera que estoura.
const quantasCartelas = async (pg) => Number(
  (await pg.locator('.gerado .quantas').innerText().catch(() => '0')).replace(/\D/g, '')) || 0;

/// Abre a área de análise numa aba, e a fecha.
const abrir = async (pg, aba = 'cartelas') => {
  await pg.locator('[data-acao=abrir]').click();
  await pg.click(`#abas [data-aba=${aba}]`);
  await pg.waitForTimeout(150);
};
const fechar = (pg) => pg.click('#voltar');
function conferir(nome, condicao, detalhe = '') {
  feitos++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

// Servido sob a mesma subpasta em que o GitHub Pages serve: um caminho absoluto
// funcionaria na raiz e quebraria só depois de publicado.
const servidor = createServer(async (pedido, resposta) => {
  const caminho = decodeURIComponent(new URL(pedido.url, 'http://x').pathname);
  if (!caminho.startsWith(BASE)) return resposta.writeHead(404).end();
  let relativo = caminho.slice(BASE.length) || 'index.html';
  if (relativo.endsWith('/')) relativo += 'index.html';
  try {
    const corpo = await readFile(join(RAIZ, normalize('/' + relativo)));
    resposta.writeHead(200, { 'content-type': TIPOS[extname(relativo)] ?? 'text/plain' });
    resposta.end(corpo);
  } catch {
    resposta.writeHead(404).end();
  }
});
await new Promise((pronto) => servidor.listen(0, pronto));
const endereco = `http://127.0.0.1:${servidor.address().port}${BASE}`;

// `CHROMIUM` aponta para um navegador já instalado na máquina. Em CI o
// Playwright baixa o dele e a variável não existe.
const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const contexto = await navegador.newContext({ viewport: { width: 360, height: 740 } });
const pagina = await contexto.newPage();
const erros = [];
pagina.on('pageerror', (e) => erros.push(String(e)));
// Só erro de JavaScript. Falha de rede é assunto de outro teste — e algumas
// são esperadas: sem servidor, `api/explicar` responde 404, e o aplicativo
// segue com a frase determinística, que é exatamente o desenho.
pagina.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) erros.push(m.text());
});

await pagina.goto(endereco, { waitUntil: 'networkidle' });

// ── a tela chega inteira ────────────────────────────────────────────────────

// Quem chega pelo link não sabe o que é isto, e a primeira coisa que a tela
// pede é dinheiro. A linha do topo tem de dizer a loteria e a ideia — que as
// cartelas se completam — sem jargão de quem já sabe.
const abertura = (await pagina.locator('.oque-e').innerText().catch(() => '')).trim();
conferir('a tela diz de que loteria se trata antes de pedir dinheiro',
  /lotofácil/i.test(abertura), abertura);
conferir('e diz o que ela entrega, sem falar em fechamento nem em cobertura',
  /cartelas/i.test(abertura) && /garant/i.test(abertura)
  && !/fechamento|cobertura|covering/i.test(abertura), abertura);

conferir('a grade tem as 25 dezenas', (await pagina.locator('.grade button').count()) === 25);
conferir('o campo de dinheiro é o primeiro controle',
  await pagina.locator('#valor').isVisible());
conferir('nenhum erro de JavaScript no carregamento', erros.length === 0, erros.join(' | '));

// Nada de parâmetro técnico na tela principal.
const textoDaTela = await pagina.locator('main').innerText();
for (const proibido of ['semente', 'iterações', 'esforço', 'motor', 'universo', 'worker']) {
  conferir(`a palavra "${proibido}" não aparece na tela`,
    !textoDaTela.toLowerCase().includes(proibido), textoDaTela.slice(0, 120));
}

// ── um toque até os bilhetes ────────────────────────────────────────────────

await pagina.click('#escolher');
await esperarFechamento(pagina);
const quantos = await quantasCartelas(pagina);
conferir('um toque põe bilhetes na tela', quantos > 0);
conferir('a resposta traz o número grande', /^\d+$/.test(await pagina.locator('.numero').innerText()));
conferir('e diz o que o número é',
  (await pagina.locator('.unidade').innerText()).includes('acertos garantidos'));

const selo = await pagina.locator('.selo').first().innerText();
conferir('o selo é um dos dois estados', ['mínimo provado', 'menor conhecido'].includes(selo), selo);

// O troco não fica sozinho. Depois que a tela rola até a resposta, a linha que
// explicava o troco — o próximo degrau, lá em cima, junto da régua — está fora
// da tela, e "sobram R$ 29,00" sem mais nada convida a pensar que o aplicativo
// não soube gastar o dinheiro.
const detalhe = (await pagina.locator('.resposta .detalhe').innerText()).replace(/\s+/g, ' ');
conferir('e o troco diz por que é troco',
  !detalhe.includes('sobram') || detalhe.includes('não compram garantia maior'), detalhe);
if (selo === 'menor conhecido') {
  conferir('e sem prova o piso aparece ao lado',
    (await pagina.locator('.piso').innerText()).includes('menos de'));
}

// A palavra "mínimo" só onde há prova.
const comMinimo = await pagina.locator('main').innerText();
conferir('"mínimo" só aparece com prova',
  !comMinimo.includes('mínimo') || selo === 'mínimo provado');

// O número da resposta é o maior elemento da tela.
const tamanhos = await pagina.evaluate(() => {
  const tamanho = (s) => Number.parseFloat(getComputedStyle(s).fontSize);
  const todos = [...document.querySelectorAll('main *')].map(tamanho);
  return { resposta: tamanho(document.querySelector('.numero')), maior: Math.max(...todos) };
});
conferir('o número da resposta é o maior da tela', tamanhos.resposta === tamanhos.maior,
  `${tamanhos.resposta} vs ${tamanhos.maior}`);

// A resposta tem de estar à vista depois do toque.
//
// Ela nasce a quase 800 px do topo: num telefone pequeno, quem tocava em
// "escolher por mim" ficava olhando para a grade, com a resposta inteira fora
// da tela. Aqui se cobra na menor tela que ainda se vende — 390x667 — que o
// número e o que ele é estejam visíveis sem procurar.
const naDobra = await (async () => {
  const pequeno = await navegador.newContext({ viewport: { width: 390, height: 667 } });
  const tela = await pequeno.newPage();
  await tela.goto(endereco, { waitUntil: 'networkidle' });
  await tela.click('#escolher');
  await esperarFechamento(tela, 20000);
  await tela.waitForTimeout(800);  // a rolagem é suave
  const medido = await tela.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { numero: r('.numero').top, fim: r('.unidade').bottom, altura: innerHeight };
  });
  await pequeno.close();
  return medido;
})();
conferir('depois do toque, o número da resposta está na tela',
  naDobra.numero >= 0 && naDobra.numero < naDobra.altura,
  `topo em ${Math.round(naDobra.numero)} de ${naDobra.altura}`);
conferir('e o que ele significa também',
  naDobra.fim <= naDobra.altura, `acaba em ${Math.round(naDobra.fim)} de ${naDobra.altura}`);

// Alvos de toque de 44 px.
const pequenos = await pagina.evaluate(() =>
  [...document.querySelectorAll('button, summary, input[type=range]')]
    .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 44).length);
conferir('todo controle tem 44 px de altura', pequenos === 0, `${pequenos} abaixo`);

// Contraste WCAG AA em todo texto visível, nos dois temas. Os tokens de cor são
// declarados uma vez na raiz, então basta medir o que a tela de fato pinta.
for (const tema of ['light', 'dark']) {
  await pagina.emulateMedia({ colorScheme: tema });
  const fracos = await pagina.evaluate(() => {
    const canal = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luz = (cor) => {
      const [r, g, b] = cor.match(/[\d.]+/g).map(Number).map((n) => canal(n / 255));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const fundoDe = (e) => {
      for (let n = e; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !c.startsWith('rgba(0, 0, 0, 0')) return c;
      }
      return 'rgb(255,255,255)';
    };
    return [...document.querySelectorAll('main *, footer *')]
      .filter((e) => e.offsetParent !== null && [...e.childNodes]
        .some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((e) => {
        const estilo = getComputedStyle(e);
        const [a, b] = [luz(estilo.color), luz(fundoDe(e))].sort((x, y) => y - x);
        const razao = (a + 0.05) / (b + 0.05);
        const grande = Number.parseFloat(estilo.fontSize) >= 24
          || (Number.parseFloat(estilo.fontSize) >= 18.66 && Number(estilo.fontWeight) >= 700);
        return { alvo: grande ? 3 : 4.5, razao, classe: e.className, texto: e.innerText.slice(0, 30) };
      })
      .filter((m) => m.razao < m.alvo);
  });
  conferir(`contraste AA no tema ${tema}`, fracos.length === 0,
    fracos.map((f) => `${f.classe || f.texto}: ${f.razao.toFixed(2)}`).join(' | '));
}
await pagina.emulateMedia({ colorScheme: null });

// Uma coluna, sempre: nada de rolagem horizontal.
for (const largura of [320, 360, 768, 1280]) {
  await pagina.setViewportSize({ width: largura, height: 740 });
  const rola = await pagina.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  conferir(`sem rolagem lateral em ${largura} px`, !rola);
}
await pagina.setViewportSize({ width: 360, height: 740 });

// ── a régua troca a estratégia inteira ──────────────────────────────────────

const antes = await pagina.locator('.numero').innerText();
const detalheAntes = await pagina.locator('.detalhe').innerText();
await pagina.fill('#valor', 'R$ 3.000,00');
await pagina.dispatchEvent('#valor', 'change');
await pagina.waitForFunction(
  (d) => document.querySelector('.detalhe')?.innerText !== d, detalheAntes);
const depois = await pagina.locator('.numero').innerText();
conferir('mais dinheiro nunca garante menos', Number(depois) >= Number(antes), `${antes} → ${depois}`);
conferir('o próximo degrau aparece',
  /Por mais|Não há garantia maior|já cabem/.test(await pagina.locator('#degrau').innerText()));

// A régua percorre a escala inteira, e não um pedaço dela: o valor mínimo é o de
// uma aposta simples e o máximo passa de dez mil reais. Um `max` que não bate com
// a escala do código deixa a régua presa nos primeiros reais — e o campo de
// dinheiro, que é por onde os outros testes passam, esconde isso.
const naRegua = async (posicao) => {
  await pagina.fill('#regua', String(posicao));
  await pagina.dispatchEvent('#regua', 'input');
  return Number((await pagina.inputValue('#valor')).replace(/[^\d,]/g, '').replace(',', '.'));
};
conferir('a régua começa numa aposta simples', (await naRegua(0)) <= 5);
conferir('e no fim da escala o dinheiro não compra fechamento nenhum',
  (await pagina.locator('.aviso').innerText()).includes('Faltam'));
const noTopo = await naRegua(1000);
conferir('a régua chega às dezenas de milhares', noTopo > 10000, String(noTopo));
const comMuito = Number(await pagina.locator('.numero').innerText());
conferir('e no topo da escala a garantia é bem maior', comMuito >= 14, String(comMuito));

// O alvo da especificação: trocar o orçamento devolve resposta nova em menos de
// 100 ms. Dá para prometer isso porque a resposta já estava calculada — o índice
// inteiro está na memória e nada é buscado para responder.
const relogio = await pagina.evaluate(() => {
  const regua = document.getElementById('regua');
  const antes = performance.now();
  for (let p = 300; p < 400; p += 10) {
    regua.value = String(p);
    regua.dispatchEvent(new Event('input'));
  }
  return (performance.now() - antes) / 10;
});
conferir(`cada troca de orçamento responde em menos de 100 ms (${relogio.toFixed(1)} ms)`,
  relogio < 100);

// ── a comparação com o acaso ────────────────────────────────────────────────

await abrir(pagina, 'resumo');
await pagina.click('#det-acaso summary');
const acaso = await pagina.locator('#acaso').innerText();
conferir('o acaso é comparado em porcentagem', acaso.includes('%'));
conferir('e o aplicativo diz que a média é a mesma', acaso.includes('pagam o mesmo'));
conferir('e não promete ganho', !/vai ganhar|garante lucro|vale a pena/i.test(acaso), acaso);

// O número mais desconfortável que este aplicativo mostra, e o mais honesto: o
// que os bilhetes devolvem em média por concurso. Sem ele, "em média os dois
// pagam o mesmo" é uma frase que se lê como consolo; com ele, é uma conta.
conferir('e diz quanto isso devolve por concurso, em dinheiro',
  /R\$ [\d.,]+ por concurso nas faixas de 11, 12 e 13 acertos/.test(acaso.replace(/\s+/g, ' ')),
  acaso);

// ── a varredura exaustiva ───────────────────────────────────────────────────

await pagina.click('#det-conferir summary');
await pagina.click('#varrer');
await pagina.waitForFunction(
  () => /garantia de \d+ está de pé|não se sustentou/.test(document.querySelector('#varredura').innerText),
  null, { timeout: 60000 });
const varredura = await pagina.locator('#varredura').innerText();
conferir('a varredura confirma a garantia', varredura.includes('está de pé'), varredura);
conferir('e diz quantos resultados percorreu', /\d[\d.]* resultados possíveis/.test(varredura));
await fechar(pagina);

// ── uma lista que ninguém rola ──────────────────────────────────────────────
//
// Os 4.198 bilhetes que R$ 15.000 compram davam uma página de 339 mil pixels e
// 67 mil nós no DOM: a conferência, o bolão e a carteira ficavam a quatrocentas
// telas de distância, e num telefone barato aquilo é memória que não existe. A
// lista passou a mostrar os primeiros; o estado continua com todos, e é com
// todos que se confere, divide e imprime.
await pagina.fill('#valor', 'R$ 20.000,00');
await pagina.dispatchEvent('#valor', 'change');
await pagina.click('#escolher');
await esperarFechamento(pagina);
await pagina.waitForTimeout(500);

// A primeira tela não mostra cartela nenhuma: o cartão diz quantas são e o
// resto fica a um toque. Era isto que enchia a página de números que ninguém
// tinha pedido ainda.
conferir('a primeira tela não desenha cartela nenhuma',
  (await pagina.locator('main .bilhetes li').count()) === 0);
conferir('e diz quantas foram geradas', (await quantasCartelas(pagina)) > 1000,
  `${await quantasCartelas(pagina)}`);
const alturaAntes = await pagina.evaluate(() => document.documentElement.scrollHeight);
conferir('e a primeira tela cabe numa página', alturaAntes < 6000, `${alturaAntes} px`);

await abrir(pagina, 'cartelas');
const listaGrande = await pagina.evaluate(() => ({
  desenhados: document.querySelectorAll('#lista-cartelas .bilhetes li').length,
  nos: document.querySelectorAll('*').length,
  aviso: document.querySelector('#lista-cartelas .ajuda')?.innerText ?? '',
}));
conferir('a lista não desenha milhares de bilhetes',
  listaGrande.desenhados > 0 && listaGrande.desenhados <= 50, `${listaGrande.desenhados}`);
conferir('e o DOM continua do tamanho de uma página',
  listaGrande.nos < 3000, `${listaGrande.nos} nós`);
// Sem fixar o número: quantos bilhetes este fechamento tem é coisa que a busca
// muda, e um teste que o congela quebra quando o catálogo melhora.
const quantosDizQueTem = Number(
  (listaGrande.aviso.match(/São ([\d.]+) cartelas/)?.[1] ?? '0').replace(/\./g, ''));
conferir('e a tela diz quantos existem de verdade',
  quantosDizQueTem > listaGrande.desenhados && quantosDizQueTem > 1000,
  listaGrande.aviso);

// E a conferência exaustiva continua vendo o fechamento inteiro — o que a tela
// desenha é a lista, não o que ela guarda.
await pagina.click('#abas [data-aba=resumo]');
await pagina.evaluate(() => { document.getElementById('det-conferir').open = true; });
await pagina.click('#varrer');
await pagina.waitForFunction(
  () => document.getElementById('varredura').innerText.includes('Varridos'), null,
  { timeout: 120000 });
conferir('e a varredura ainda cobre o fechamento inteiro',
  (await pagina.locator('#varredura').innerText()).includes('está de pé'),
  await pagina.locator('#varredura').innerText());
await fechar(pagina);

// De volta a um fechamento que cabe inteiro na lista, para o que vem abaixo
// poder contar `<li>` e saber que está contando bilhetes, e não o limite do
// desenho.
await pagina.fill('#valor', 'R$ 65,00');
await pagina.dispatchEvent('#valor', 'change');
await pagina.click('#escolher');
await esperarFechamento(pagina, 20000);
await pagina.waitForTimeout(500);
const cabeInteiro = await quantasCartelas(pagina);
conferir('um fechamento pequeno é desenhado inteiro', cabeInteiro > 0 && cabeInteiro < 50,
  `${cabeInteiro}`);
await abrir(pagina, 'cartelas');
conferir('um fechamento pequeno é desenhado inteiro na lista',
  (await pagina.locator('#lista-cartelas .bilhetes li').count()) === cabeInteiro);
conferir('e sem aviso de lista cortada',
  (await pagina.locator('#lista-cartelas .ajuda').count()) === 0);
await fechar(pagina);

// ── bolão ───────────────────────────────────────────────────────────────────

await pagina.click('#det-bolao summary');
const noFechamento = await quantasCartelas(pagina);
await pagina.fill('#partes', '3');
await pagina.dispatchEvent('#partes', 'input');
conferir('o bolão sai em três partes', (await pagina.locator('.partes li').count()) === 3);
const linkDaParte = await pagina.locator('.partes button').first().getAttribute('data-link');
conferir('e cada parte tem endereço próprio', /#d=[\d.]+&f=\d+-\d+-\d+&p=0\.3/.test(linkDaParte),
  linkDaParte);

const outra = await contexto.newPage();
await outra.goto(linkDaParte, { waitUntil: 'networkidle' });
await esperarFechamento(outra);
const naParte = await quantasCartelas(outra);
conferir('quem abre o link recebe só a sua parte', naParte > 0 && naParte < noFechamento,
  `${naParte} de ${noFechamento}`);

// E quem chegou por um link de parte, se dividir de novo, divide o **fechamento
// inteiro** — não a parte dele. O link que sai daqui diz "parte i de n do
// fechamento", e é isso que quem o abrir vai receber: dividindo a parte, a
// contagem na tela seria de um conjunto e o link entregaria outro.
await outra.click('#det-bolao summary');
await outra.fill('#partes', '2');
await outra.dispatchEvent('#partes', 'input');
const partesNaParte = await outra.locator('.partes li').allInnerTexts();
const somaDasPartes = partesNaParte
  .map((t) => Number(t.match(/(\d+) cartelas/)[1]))
  .reduce((a, b) => a + b, 0);
conferir('quem é parte divide o fechamento inteiro, e não a parte dele',
  somaDasPartes === noFechamento, `${somaDasPartes} de ${noFechamento} (parte tem ${naParte})`);

// E a carteira de quem é parte guarda o que **essa pessoa** jogou. Guardar o
// fechamento inteiro punha ali um custo que ela não pagou, ao lado de um retorno
// que é só o dela: a conta não fechava para ninguém.
await outra.click('[data-acao=guardar]');
const naCarteira = (await outra.locator('.registros li').first().innerText()).replace(/\s+/g, ' ');
// Comparado como número, e não como pedaço de texto: com 15 cartelas guardadas
// e 5 na mão, `includes('5 cartelas')` acha "15 cartelas" e o teste passa sobre
// o defeito. Foi o que aconteceu na primeira versão desta conferência.
const jogosNaCarteira = Number(naCarteira.match(/· (\d+) cartelas/)?.[1]);
conferir('a carteira de quem é parte guarda a parte, e não o bolão',
  jogosNaCarteira === naParte, `${jogosNaCarteira} guardados, ${naParte} na mão`);
// E o defeito que só aparece no aparelho de outra pessoa: o link carrega o
// fechamento (`f=v-k-t`), e quem o abre tem de receber bilhetes **daquele**
// fechamento. Se o aplicativo escolher pelo orçamento guardado ali, cada
// participante joga um bolão diferente — e a cobertura combinada, que é a razão
// de existir do bolão, deixa de valer.
const outroAparelho = await navegador.newContext({ viewport: { width: 390, height: 844 } });
await outroAparelho.addInitScript(() => localStorage.setItem('orcamento', '2000000'));
const deOutrem = await outroAparelho.newPage();
await deOutrem.goto(linkDaParte, { waitUntil: 'networkidle' });
await esperarFechamento(deOutrem);
await deOutrem.waitForTimeout(500);
const naOutraMao = await quantasCartelas(deOutrem);
conferir('o link entrega a mesma parte em qualquer aparelho',
  naOutraMao === naParte, `${naOutraMao} aqui, ${naParte} no aparelho de quem dividiu`);
await outroAparelho.close();

await outra.close();

// ── conferir contra o sorteio ───────────────────────────────────────────────

await abrir(pagina, 'conferir');
await pagina.fill('#sorteio', '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15');
await pagina.dispatchEvent('#sorteio', 'change');
const conferencia = await pagina.locator('#conferencia').innerText();
conferir('a conferência diz a melhor cartela', /Melhor cartela: \d+ acertos/.test(conferencia),
  conferencia);
conferir('e fecha a conta do dinheiro', /Custou R\$/.test(conferencia));

// ── carteira ────────────────────────────────────────────────────────────────

// Guardar é ação do cartão, na tela de geração — a área de análise fica por
// cima dela, e é preciso voltar.
await fechar(pagina);
await pagina.click('[data-acao=guardar]');
conferir('guardar põe o jogo na carteira', (await pagina.locator('.registros li').count()) === 1);
conferir('e o registro fecha a conta do sorteio que acabou de ser conferido',
  /voltou R\$/.test(await pagina.locator('.registros li').innerText()) === false);

// Conferir de novo, agora com o jogo já guardado: a carteira passa a dizer
// quanto voltou. É o que separa "o que eu joguei" de "o que eu ganhei".
await abrir(pagina, 'conferir');
await pagina.dispatchEvent('#sorteio', 'change');
await pagina.waitForTimeout(200);
await fechar(pagina);
conferir('a carteira registra o retorno',
  /voltou R\$/.test(await pagina.locator('.registros li').innerText()),
  await pagina.locator('.registros li').innerText());

// ── e o que está guardado volta para a tela ────────────────────────────────
//
// A carteira guardava tudo o que descreve o pedido — as dezenas do dia e a
// combinação — e não oferecia jeito nenhum de usá-lo. Quem quisesse conferir na
// quarta-feira o jogo que fez no sábado tinha de remontá-lo de cabeça: as
// mesmas dezenas, uma a uma, e o mesmo dinheiro, torcendo para cair na mesma
// linha do catálogo. Conferir um jogo velho contra o sorteio de hoje é
// exatamente o que se faz com um bilhete de loteria.
const guardado = (await pagina.locator('.registros li').innerText()).replace(/\s+/g, ' ');
const marcadasAntes = await pagina.locator('.grade [aria-pressed=true]').count();
// Mexer no dinheiro é o jeito mais curto de sair do fechamento guardado: solta o
// fechamento nomeado e devolve o que o orçamento compraria, que é outra coisa.
await pagina.fill('#valor', 'R$ 7,00');
await pagina.dispatchEvent('#valor', 'change');
await pagina.waitForTimeout(300);
const outroFechamento = (await pagina.locator('.resposta').innerText()).replace(/\s+/g, ' ');
conferir('mexer no dinheiro tira o fechamento guardado da tela',
  !outroFechamento.includes(guardado.match(/([\d.]+) cartelas? de (\d+) dezenas/)?.[0] ?? '§'),
  outroFechamento.slice(0, 100));

// O toque vem depois de conferir que há onde tocar. Clicar num botão que não
// existe faz o Playwright esperar e **estourar**, e a suíte inteira morre sem
// relatar nada — verde nenhum, vermelho nenhum, só um rastro de pilha. Um teste
// que aborta é pior do que um que reprova: ele não diz o que está errado.
const temBotao = await pagina.locator('.registros [data-reabrir="0"]').count();
conferir('o registro guardado oferece como voltar para a tela',
  temBotao === 1, `${temBotao} botões de reabrir`);
if (temBotao === 1) {
  await pagina.click('.registros [data-reabrir="0"]');
  await esperarFechamento(pagina, 20000);
  await pagina.waitForTimeout(300);
}
const devolta = (await pagina.locator('.resposta').innerText()).replace(/\s+/g, ' ');
const quantasEComo = guardado.match(/([\d.]+) cartelas? de (\d+) dezenas/)?.[0] ?? '§';
conferir('e o que está guardado volta para a tela com um toque',
  devolta.includes(quantasEComo), `guardado: ${quantasEComo} · na tela: ${devolta.slice(0, 110)}`);
// E a tela diz de onde ele veio. Sem isto ela dizia *"você montou este
// fechamento à mão, em montar do meu jeito"* — verdade para o modo manual,
// mentira para um jogo que voltou da carteira, e a linha existe justamente para
// explicar por que o número na tela não é o que o dinheiro compraria.
const degrau = (await pagina.locator('#degrau').innerText()).replace(/\s+/g, ' ');
conferir('e a tela diz que ele veio da carteira, e não da mão',
  degrau.includes('carteira'), degrau);
conferir('com as mesmas dezenas marcadas',
  (await pagina.locator('.grade [aria-pressed=true]').count()) === marcadasAntes,
  `${await pagina.locator('.grade [aria-pressed=true]').count()} de ${marcadasAntes}`);
// E as cartelas de verdade voltam junto: a resposta certa com a lista vazia
// seria uma manchete sobre nada.
//
// O mesmo cuidado de cima, e pelo mesmo motivo: sem o fechamento de volta não
// há cartão gerado, logo não há "Visualizar cartelas", e abrir sem conferir
// antes fazia a suíte estourar em vez de reprovar. Quem confere um conserto
// tirando-o do lugar precisa que a suíte sobreviva ao buraco.
const podeAbrir = await pagina.locator('[data-acao=abrir]').count();
if (podeAbrir === 1) await abrir(pagina, 'cartelas');
conferir('e as cartelas voltam junto',
  podeAbrir === 1 && (await pagina.locator('.bilhetes li').count()) > 0,
  `${podeAbrir} botões de visualizar`);
if (podeAbrir === 1) await fechar(pagina);

// ── preços editáveis, e a tela dizendo que não os audita ────────────────────

await pagina.click('#det-dinheiro summary');
const precos = await pagina.locator('#det-dinheiro').innerText();
conferir('a tela diz que não audita os valores', precos.includes('não são auditados'));

// ── pedir com as próprias palavras, sem servidor nenhum ─────────────────────

// Não há servidor neste teste: `api/intencao` responde 404. O leitor
// determinístico do cliente é quem lê — e é essa a prova de que desligar a IA
// inteira mantém o aplicativo funcional.
await pagina.click('#det-intencao summary');
await pagina.fill('#intencao', 'trezentos reais, vinte dezenas, quero garantir 14');
await pagina.click('#enviar-intencao');
await pagina.waitForFunction(
  () => document.querySelectorAll('.grade [aria-pressed=true]').length === 20, null,
  { timeout: 15000 });
conferir('o pedido em texto livre marca as vinte dezenas', true);
conferir('e ajusta o dinheiro', (await pagina.inputValue('#valor')).includes('300,00'),
  await pagina.inputValue('#valor'));
conferir('e nenhum aviso de erro sobra', (await pagina.locator('#aviso-intencao').innerText()) === '');

// "quero garantir 14" com R$ 300 não cabe, e antes disto o número era lido,
// validado e jogado fora: a tela respondia como se ninguém tivesse pedido nada.
// Agora ela responde **a pergunta que a pessoa fez** — quanto custa aquilo.
// Colapsando os espaços, que é como a tela desenha e como a pessoa lê: a frase
// nasce de um literal quebrado em duas linhas no código.
const linhaDoPedido = (await pagina.locator('#degrau').innerText()).replace(/\s+/g, ' ');
conferir('e a garantia pedida vira preço na tela, em vez de sumir',
  /Garantir 14 acertos com 20 dezenas custa R\$ [\d.,]+ — faltam R\$ [\d.,]+/.test(linhaDoPedido),
  linhaDoPedido);

// Um pedido impossível também não vira estado. "30 dezenas" não é um pedido de
// 25: aparar seria inventar, e o leitor do servidor faz igual — o mesmo texto
// não pode mudar de significado conforme haja ou não um servidor no ar.
await pagina.fill('#intencao', 'R$ 300 com 30 dezenas');
await pagina.click('#enviar-intencao');
await pagina.waitForFunction(
  () => document.getElementById('aviso-intencao').innerText.includes('Não consegui'), null,
  { timeout: 15000 });
conferir('trinta dezenas não viram vinte e cinco',
  (await pagina.locator('.grade [aria-pressed=true]').count()) === 20);

// E um pedido que ninguém entende diz isso, em vez de mexer no estado.
await pagina.fill('#intencao', 'bom dia');
await pagina.click('#enviar-intencao');
await pagina.waitForFunction(
  () => document.getElementById('aviso-intencao').innerText.includes('Não consegui'), null,
  { timeout: 15000 });
conferir('um pedido ilegível não vira estado',
  (await pagina.inputValue('#valor')).includes('300,00'));

// ── a frase do modelo, e a regra que decide se ela entra ───────────────────
//
// Nos outros testes não há servidor e `api/explicar` responde 404 — o que prova
// que o aplicativo funciona sem IA, e não prova nada sobre o caminho com ela.
// Aqui um servidor é fingido, e o que se cobra é a regra: uma frase que só usa
// os números do pedido entra, e uma que inventa qualquer outro é descartada
// **sem apagar** a frase determinística que já estava na tela.
//
// Esta é a prova que faltava. A regra rejeitava toda frase com preço, porque
// "R$ 199,50" vira os números 199 e 50 e nenhum dos dois estava autorizado —
// e o modelo tinha sido chamado justamente para falar de dinheiro.
const emReais = (c) =>
  (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let doModelo = null;
await pagina.route('**/api/explicar', async (rota) => {
  const d = JSON.parse(rota.request().postData());
  await rota.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ frase: doModelo(d) }),
  });
});

const trocarOrcamento = async (texto) => {
  await pagina.fill('#valor', texto);
  await pagina.dispatchEvent('#valor', 'change');
  await pagina.waitForTimeout(600);
  return (await pagina.locator('.resposta .frase').innerText()).replace(/\s+/g, ' ');
};

// Uma frase com o preço escrito como o Brasil escreve preço.
doModelo = (d) => `São ${d.jogos} jogos de ${d.k} dezenas por R$ ${emReais(d.custo)}, `
  + `com ${d.t} acertos garantidos entre as suas ${d.v}.`;
const comPreco = await trocarOrcamento('R$ 250,00');
conferir('uma frase do modelo com preço em reais chega à tela',
  /por R\$ [\d.]+,\d\d/.test(comPreco), comPreco);

// E a mesma frase com um número que ninguém mandou: descartada, e a frase
// determinística fica onde estava.
doModelo = (d) => `São ${d.jogos} jogos que cobrem 87% dos resultados possíveis.`;
const comInvencao = await trocarOrcamento('R$ 260,00');
conferir('uma frase com número inventado não chega à tela',
  !comInvencao.includes('87%'), comInvencao);
conferir('e a frase determinística continua no lugar',
  comInvencao.includes('Não é probabilidade'), comInvencao);

await pagina.unroute('**/api/explicar');

// ── montar do meu jeito ─────────────────────────────────────────────────────
//
// O segundo modo: quem já sabe o fechamento que quer não parte do dinheiro. Ele
// diz o pool, o teto de cartelas e escolhe na lista — e o modo automático
// continua intacto do outro lado, o que esta seção também cobra, voltando a ele
// no fim.

await pagina.click('#det-manual summary');

const opcoesDe = async (pool, teto = '', k = '', t = '') => {
  await pagina.selectOption('#m-pool', String(pool));
  await pagina.selectOption('#m-k', String(k));
  await pagina.selectOption('#m-t', String(t));
  await pagina.fill('#m-teto', teto);
  await pagina.dispatchEvent('#m-teto', 'input');
  return (await pagina.locator('#m-fechamento option').allInnerTexts())
    .map((t) => t.replace(/\s+/g, ' ').trim());
};

// A grade e o select do pool dizem a mesma coisa, e têm de dizer o mesmo número:
// marcar dezenas lá e encontrar outro valor aqui faz a primeira escolha refazer
// em silêncio a marcação que a pessoa acabou de fazer.
await pagina.click('#limpar');
for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  await pagina.click(`.grade [data-dezena="${d}"]`);
}
await pagina.waitForTimeout(1200);
conferir('o pool do modo manual acompanha a grade',
  (await pagina.inputValue('#m-pool')) === '18', await pagina.inputValue('#m-pool'));
conferir('e a lista já é a desse pool',
  (await pagina.locator('#m-fechamento option').allInnerTexts())
    .every((l) => /de 1[5-8] dezenas/.test(l.replace(/\s+/g, ' '))),
  (await pagina.locator('#m-fechamento option').allInnerTexts()).join(' | '));

// ── o pedido manda, e vale ao pé da letra ──────────────────────────────────
//
// Três defeitos moravam aqui, e os três davam na mesma queixa: a pessoa dizia
// uma coisa e a tela mostrava outra.
//
// 1. A garantia era "no mínimo". Com `15-14` na lista, baixar de 14 para 11
//    deixava a linha antiga passando no filtro novo — 14 é no mínimo 11 —, e a
//    resposta continuava sendo 452 cartelas por R$ 1.582,00 onde o pedido novo
//    custava R$ 14,00. Mudar o pedido não mudava a resposta.
// 2. Um descarte por dominância escondia **66 dos 237** fechamentos: pedir 11
//    acertos com cartela de 15 num pool de 20 dava lista vazia, porque a linha
//    de 11 tinha sido comida pela de 14, que custa o mesmo.
// 3. E um pedido sem resposta virava outro fechamento: `fixar(null)` devolvia a
//    palavra ao orçamento, e a tela anunciava com manchete e selo um fechamento
//    que ninguém pediu, com o "não há" em cinza três dedos abaixo.
const respostaDiz = async () => (await pagina.locator('.resposta').innerText()).replace(/\s+/g, ' ');

await opcoesDe(20, '', 15, 14);
conferir('pedindo 14 acertos, a tela dá 14',
  /14 acertos garantidos/.test(await respostaDiz()), (await respostaDiz()).slice(0, 80));
await pagina.selectOption('#m-t', '11');
await pagina.waitForTimeout(400);
const baixou = await respostaDiz();
conferir('e baixando para 11, a tela dá 11 — e não o 14 de antes',
  /11 acertos garantidos/.test(baixou) && !/14 acertos garantidos/.test(baixou),
  baixou.slice(0, 90));
conferir('com o fechamento de 11, que custa uma fração do de 14',
  /4 cartelas de 15 dezenas · R\$ 14,00/.test(baixou), baixou.slice(0, 110));

// Nada é escondido: com o tamanho de cartela fixo, toda garantia que o catálogo
// publica para aquele pool tem de ser escolhível e chegar exatamente nela.
for (const t of [11, 12, 13, 14]) {
  await opcoesDe(20, '', 15, t);
  const diz = await respostaDiz();
  conferir(`20 dezenas, cartela de 15, garantindo ${t}: a tela dá ${t}`,
    new RegExp(`${t} acertos garantidos`).test(diz)
    && (await pagina.inputValue('#m-fechamento')) === `15-${t}`,
    `select=${await pagina.inputValue('#m-fechamento')} · ${diz.slice(0, 70)}`);
}

// ── e o que não existe é avisado antes de ser escolhido ────────────────────
//
// `20/15/15` é o beco mais curto do catálogo: o pool tem cartela de 15 e tem
// garantia de 15, cada select oferecia os dois, e juntos não existem. Agora o
// select diz isso na própria opção — e escolher assim mesmo dá a recusa com o
// tamanho que o fechamento teria, que é informação e não um beco.
await opcoesDe(20, '', 15, '');
const garantiasDe20 = await pagina.locator('#m-t option').allInnerTexts();
conferir('com cartela de 15, a garantia de 15 vem marcada como sem fechamento',
  garantiasDe20.some((l) => /^15 acertos — sem fechamento/.test(l.trim()))
  && garantiasDe20.filter((l) => /sem fechamento/.test(l)).length === 1,
  garantiasDe20.map((l) => l.trim()).join(' | '));
await opcoesDe(20, '', '', 15);
const cartelasDe20 = await pagina.locator('#m-k option').allInnerTexts();
conferir('e com garantia de 15, é a cartela de 15 que vem marcada',
  cartelasDe20.some((l) => /^15 por cartela — sem fechamento/.test(l.trim()))
  && cartelasDe20.filter((l) => /sem fechamento/.test(l)).length === 1,
  cartelasDe20.map((l) => l.trim()).join(' | '));
await opcoesDe(20, '', 15, 15);
const beco = await respostaDiz();
conferir('escolhendo o beco, a recusa diz de que tamanho seria o fechamento',
  beco.includes('Não há fechamento catalogado')
  && /todas as combinações de 15 entre as suas 20 dezenas/.test(beco)
  && beco.includes('15.504 cartelas') && beco.includes('R$ 54.264,00'),
  beco.slice(0, 220));

// ── escolher uma linha é dizer os dois valores ─────────────────────────────
//
// A escolha vivia só na lista, e a lista se refaz a cada troca de pool. Quem
// escolhia "cartela de 16, garantindo 14" num pool de 18 e voltava o pool para
// 15 — onde cartela de 16 não existe — via o navegador selecionar a primeira
// opção sozinho, e o aplicativo montava essa: cartela de 15, outra garantia,
// outro preço. Quinze pares somem só nessa troca.
await opcoesDe(18);
await pagina.selectOption('#m-fechamento', '16-14');
await esperarFechamento(pagina, 20000);
await pagina.waitForTimeout(400);
conferir('escolher uma linha da lista escreve os dois controles',
  (await pagina.inputValue('#m-k')) === '16' && (await pagina.inputValue('#m-t')) === '14',
  `k=${await pagina.inputValue('#m-k')} t=${await pagina.inputValue('#m-t')}`);
await pagina.selectOption('#m-pool', '15');
await pagina.waitForTimeout(800);
const encolheu = await respostaDiz();
conferir('e encolher o pool até o pedido não caber é recusa, não troca',
  encolheu.includes('Não há fechamento catalogado') && encolheu.includes('cartela de 16')
  && encolheu.includes('14 acertos garantidos')
  && (await pagina.locator('.resposta .numero, .resposta .unidade').count()) === 0,
  encolheu.slice(0, 160));

// ── e um pedido sem resposta é dito, não trocado ───────────────────────────
await opcoesDe(25, '', 16, 14);
const semResposta = await respostaDiz();
conferir('um pedido que o catálogo não tem é recusado por escrito',
  semResposta.includes('Não há fechamento catalogado')
  && semResposta.includes('25 dezenas') && semResposta.includes('cartela de 16')
  && semResposta.includes('14 acertos garantidos'), semResposta.slice(0, 140));
// "Não monta outro" é medido no que a resposta desenha, e não no texto: um
// fechamento montado tem manchete, unidade e selo, e a recusa não tem nenhum
// dos três. Era assim que o defeito aparecia — a recusa em cinza embaixo de um
// número grande anunciando um fechamento que ninguém pediu.
const montado = await pagina.locator(
  '.resposta .numero, .resposta .unidade, .resposta .selo').count();
conferir('e a tela não monta outro fechamento no lugar', montado === 0, `${montado} pedaços`);
// A recusa também diz de que tamanho o fechamento pedido teria de ser.
conferir('e diz o piso do que foi pedido',
  /pelo menos .*3\.014 cartelas/.test(semResposta), semResposta.slice(0, 220));
// Um "não há" sem saída é um beco. As vizinhanças existem, e um toque nelas
// resolve — senão a pessoa fica procurando qual dos quatro controles afrouxar.
const saidas = await pagina.locator('.resposta [data-manual]').count();
conferir('e mostra o que o catálogo tem perto disso', saidas > 0, `${saidas} saídas`);
await pagina.locator('.resposta [data-manual]').first().click();
await esperarFechamento(pagina, 20000);
await pagina.waitForTimeout(400);
const depoisDaSaida = await respostaDiz();
conferir('e um toque na saída monta aquele fechamento',
  /\d+ acertos garantidos/.test(depoisDaSaida)
  && !depoisDaSaida.includes('Não há fechamento'), depoisDaSaida.slice(0, 90));

// O teto de cartelas é pedido como os outros, e esvaziá-lo também é recusa por
// escrito — antes ficava na tela o fechamento anterior, que violava o teto que
// a pessoa acabara de digitar.
await opcoesDe(20, '1', 15, 11);
const comTeto = await respostaDiz();
conferir('o teto de cartelas que não cabe também é recusado por escrito',
  comTeto.includes('Não há fechamento catalogado') && comTeto.includes('no máximo 1 cartela'),
  comTeto.slice(0, 140));
await pagina.fill('#m-teto', '');
await pagina.dispatchEvent('#m-teto', 'input');
await pagina.waitForTimeout(400);
conferir('e tirar o teto devolve o fechamento',
  /11 acertos garantidos/.test(await respostaDiz()), (await respostaDiz()).slice(0, 80));

// E o beco sem garantia pedida, que era o único que ficava sem saída: só o
// tamanho da cartela e um teto que nada daquele tamanho atende. As duas
// vizinhanças de sempre — a mesma garantia noutro tamanho, o mesmo tamanho numa
// garantia menor — não existem quando não há garantia pedida.
await opcoesDe(20, '1', 15, '');
const semGarantia = await respostaDiz();
conferir('sem garantia pedida, um teto apertado ainda tem saída',
  semGarantia.includes('Não há fechamento catalogado')
  && (await pagina.locator('.resposta [data-manual]').count()) > 0,
  `${await pagina.locator('.resposta [data-manual]').count()} saídas · ${
    semGarantia.slice(0, 120)}`);
await pagina.fill('#m-teto', '');
await pagina.dispatchEvent('#m-teto', 'input');
await pagina.waitForTimeout(400);

const de23 = await opcoesDe(23);
conferir('o pool de 23 dezenas abre uma lista de fechamentos', de23.length > 5, `${de23.length}`);
conferir('e cada linha diz garantia, preço, cartelas e tamanho',
  de23.every((t) => /^garante \d+ acertos · R\$ [\d.]+,\d\d · [\d.]+ cartelas? de \d+ dezenas$/.test(t)),
  de23.slice(0, 3).join(' | '));
// A lista existe para mostrar o que a escada esconde: sem isso o modo manual
// seria o automático com outra roupa.
const nasOpcoes = new Set(de23.map((t) => t.match(/de (\d+) dezenas/)[1]));
conferir('e oferece mais de um tamanho de cartela', nasOpcoes.size > 1, [...nasOpcoes].join(','));

const precoDaLinha = (t) => Number(t.match(/R\$ ([\d.]+),(\d\d)/).slice(1)
  .reduce((r, c) => r + c.replace(/\./g, ''), ''));
conferir('e vem do mais barato ao mais caro',
  de23.every((t, i) => i === 0 || precoDaLinha(de23[i - 1]) <= precoDaLinha(t)));

// O teto de cartelas é o controle de quem sabe quantos jogos vai preencher à
// mão. Ele corta, e corta pelo número que está escrito na própria linha.
const de23ate20 = await opcoesDe(23, '20');
conferir('o teto de cartelas encurta a lista', de23ate20.length < de23.length,
  `${de23ate20.length} de ${de23.length}`);
conferir('e nada acima do teto sobra',
  de23ate20.every((t) => Number(t.match(/· (\d+) cartelas?/)[1]) <= 20), de23ate20.join(' | '));

// As outras duas características que a pessoa pode pedir direto: quantas
// dezenas em cada cartela, e que garantia. Cada uma corta a lista, e só oferece
// valores que este pool tem — pedir 18 por cartela onde não há fechamento de 18
// seria oferecer um beco.
const valoresDe = async (id) => (await pagina.locator(`#${id} option`)
  .evaluateAll((os) => os.map((o) => o.value))).filter(Boolean).map(Number);

await opcoesDe(23);
const porCartela = await valoresDe('m-k');
const garantias = await valoresDe('m-t');
conferir('o filtro de dezenas por cartela oferece só o que a lotérica aceita',
  porCartela.length > 1 && porCartela.every((k) => k >= 15 && k <= 20), porCartela.join(','));
conferir('e o de garantia, só acertos que existem no catálogo',
  garantias.length > 1 && garantias.every((t) => t >= 11 && t <= 15), garantias.join(','));

const so18 = await opcoesDe(23, '', 18);
conferir('pedir 18 dezenas por cartela deixa só cartelas de 18',
  so18.length > 0 && so18.every((l) => /de 18 dezenas/.test(l)), so18.join(' | '));

const garante13 = await opcoesDe(23, '', '', 13);
conferir('pedir 13 acertos não devolve nada que garanta menos',
  garante13.length > 0 && garante13.every((l) => Number(l.match(/^garante (\d+)/)[1]) >= 13),
  garante13.join(' | '));

// Os dois juntos, que é onde um filtro mal-feito devolveria a lista inteira.
const ambos = await opcoesDe(23, '', 16, 12);
conferir('os dois filtros juntos valem os dois',
  ambos.every((l) => /de 16 dezenas$/.test(l) && Number(l.match(/^garante (\d+)/)[1]) >= 12),
  ambos.join(' | '));

// Um campo numérico aceita "-5" e "2,5", e nenhum dos dois é um número de
// cartelas. Valem como "sem teto" — que é o que a pessoa tinha antes de digitar.
const semTeto = (await opcoesDe(23)).length;
conferir('um teto negativo vale como nenhum teto',
  (await opcoesDe(23, '-5')).length === semTeto, `${(await opcoesDe(23, '-5')).length} de ${semTeto}`);
conferir('e um teto quebrado desce para o inteiro de baixo',
  (await opcoesDe(23, '5.5')).length === (await opcoesDe(23, '5')).length,
  `${(await opcoesDe(23, '5.5')).length} contra ${(await opcoesDe(23, '5')).length}`);

// Um pedido impossível não pode deixar a pessoa no escuro: a tela diz o que ela
// pediu, para ela saber o que afrouxar, em vez de só não ter opção nenhuma. E
// diz nos dois lugares — ao lado do select, onde ela está mexendo, e na resposta
// lá em cima, que é para onde ela olha.
await opcoesDe(25, '1');
const semSaida = await pagina.locator('#manual').innerText();
conferir('um teto impossível é explicado, e não silencioso',
  /não há fechamento catalogado/i.test(semSaida), semSaida);
conferir('e a explicação nomeia o que foi pedido',
  semSaida.includes('no máximo 1 cartela'), semSaida);
conferir('e a resposta lá em cima diz o mesmo',
  /não há fechamento catalogado/i.test(await pagina.locator('.resposta').innerText()),
  (await pagina.locator('.resposta').innerText()).replace(/\s+/g, ' ').slice(0, 110));

// Dois pedidos ao mesmo tempo viram uma frase, e não uma lista com vírgula
// solta no fim: quem lê isso já está confuso, e a frase é a saída.
await opcoesDe(25, '2', '', 15);
const doisPedidos = await pagina.locator('#manual').innerText();
conferir('e dois pedidos viram uma frase, com "e" no lugar da última vírgula',
  doisPedidos.includes('15 acertos garantidos e no máximo 2 cartelas'), doisPedidos);
conferir('e a frase termina em ponto, sem espaço sobrando',
  /cartelas\.$/.test(doisPedidos.trim()), doisPedidos);

// E o essencial: escolher na lista monta *aquele* fechamento. Não o mais
// próximo, não o que o dinheiro compraria — aquele.
await opcoesDe(22, '', '', '');
const alvoManual = (await pagina.locator('#m-fechamento option').allInnerTexts())
  .map((t) => t.replace(/\s+/g, ' ').trim());
// O texto das opções quebra linha; escolhe-se pelo valor, no mesmo índice.
const qual = Math.min(3, alvoManual.length - 1);
const escolhido = alvoManual[qual];
const valores = await pagina.locator('#m-fechamento option').evaluateAll(
  (os) => os.map((o) => o.value));
await pagina.selectOption('#m-fechamento', valores[qual]);
await pagina.waitForTimeout(1500);
const jogosPedidos = Number(escolhido.match(/· (\d+) cartelas?/)[1]);
const kPedido = Number(escolhido.match(/de (\d+) dezenas$/)[1]);
const tPedido = Number(escolhido.match(/^garante (\d+) acertos/)[1]);
const respostaManual = (await pagina.locator('.resposta').innerText()).replace(/\s+/g, ' ');
conferir('a resposta é o fechamento escolhido, e não outro',
  respostaManual.includes(`${jogosPedidos} cartelas de ${kPedido} dezenas`)
  || respostaManual.includes(`cartela de ${kPedido} dezenas`),
  `pedido ${escolhido} — veio ${respostaManual}`);
conferir('e a garantia é a que foi pedida',
  jogosPedidos === 1 || respostaManual.includes(`${tPedido} acertos garantidos`), respostaManual);
conferir('e a tela entrega esses bilhetes',
  (await quantasCartelas(pagina)) === Math.min(jogosPedidos, 50),
  `${await quantasCartelas(pagina)} para ${jogosPedidos}`);

// O pool pedido é o pool marcado. Escolher "22 dezenas" e receber bilhetes de um
// pool de 20 seria responder outra pergunta.
conferir('e o pool marcado passa a ser o pedido',
  (await pagina.locator('.grade [aria-pressed=true]').count()) === 22,
  `${await pagina.locator('.grade [aria-pressed=true]').count()}`);

// Duas afirmações na mesma tela, uma delas falsa, é o defeito que este teste
// existe para pegar: o campo de dinheiro tem de dizer o preço do que está na
// mão, e não o orçamento de antes.
const precoPedido = precoDaLinha(escolhido);
const noCampo = await pagina.inputValue('#valor');
conferir('e o campo de dinheiro passa a dizer o preço do que foi montado',
  Number(noCampo.replace(/\D/g, '')) === precoPedido, `${noCampo} para ${escolhido}`);

// A frase do degrau descreve a escada — "por mais tanto você sobe" —, e a escada
// não é o que está na tela quando o fechamento foi montado à mão.
conferir('e o rodapé diz que este fechamento foi montado à mão',
  (await pagina.locator('#degrau').innerText()).includes('montou este fechamento à mão'),
  await pagina.locator('#degrau').innerText());

// Quem chegou por um link de bolão recebe uma parte. Montando outro fechamento à
// mão, essa parte era de outro conjunto: entregar um terço do novo chamando de
// "parte 1 de 3 deste bolão" seria descrever um bolão que não existe mais.
const daParte = await contexto.newPage();
await daParte.goto(linkDaParte, { waitUntil: 'networkidle' });
await esperarFechamento(daParte);
const comoParte = await quantasCartelas(daParte);
conferir('quem abre o link ainda recebe a parte dele', comoParte > 0);
conferir('e a tela diz que é uma parte',
  (await daParte.locator('#secao-bilhetes').innerText()).includes('Você é a parte'),
  await daParte.locator('#secao-bilhetes').innerText());
await daParte.click('#det-manual summary');
const poolDaParte = await daParte.locator('.grade [aria-pressed=true]').count();
await daParte.selectOption('#m-pool', String(poolDaParte));
await daParte.waitForTimeout(500);
const opcoesDaParte = await daParte.locator('#m-fechamento option').evaluateAll(
  (os) => os.map((o) => o.value));
await daParte.selectOption('#m-fechamento', opcoesDaParte[0]);
await daParte.waitForTimeout(1500);
const jogosDoNovo = Number((await daParte.locator('.resposta').innerText())
  .replace(/\s+/g, ' ').match(/(\d+) cartelas de/)?.[1] ?? 1);
conferir('montar à mão desfaz o vínculo com o bolão',
  !(await daParte.locator('#secao-bilhetes').innerText()).includes('Você é a parte'),
  (await daParte.locator('#secao-bilhetes').innerText()).replace(/\s+/g, ' ').slice(0, 120));
conferir('e entrega o fechamento inteiro, não um pedaço dele',
  (await quantasCartelas(daParte)) === Math.min(jogosDoNovo, 50),
  `${await quantasCartelas(daParte)} de ${jogosDoNovo}`);
await daParte.close();

// ── e o modo automático continua inteiro ────────────────────────────────────
//
// A promessa ao usuário foi que o modo de sempre não mudaria. Mexer no dinheiro
// é voltar para ele: a resposta volta a ser a que o orçamento compra, e o rodapé
// volta a ensinar o degrau seguinte.
await pagina.fill('#valor', 'R$ 300,00');
await pagina.dispatchEvent('#valor', 'change');
await pagina.waitForTimeout(800);
const voltou = (await pagina.locator('.resposta').innerText()).replace(/\s+/g, ' ');
conferir('mexer no dinheiro devolve o modo automático',
  /sobram R\$|\bR\$ [\d.]+,\d\d\b/.test(voltou) && !voltou.includes(`${jogosPedidos} jogos`),
  voltou);
// O rodapé automático fala de dinheiro e garantia — o degrau seguinte, ou o
// preço da garantia que a pessoa pediu e ainda não cabe.
const doAutomatico = [/Por mais R\$/, /Garantir \d+ acertos com \d+ dezenas custa/,
  /Não há fechamento catalogado que/, /marque mais dezenas/, /cartelas que se completam/];
const rodape = await pagina.locator('#degrau').innerText();
conferir('e o rodapé volta a falar de dinheiro e garantia, como no automático',
  doAutomatico.some((r) => r.test(rodape)), rodape);
conferir('e não sobrou nada dito à mão', !rodape.includes('montou este fechamento à mão'));

// E o caminho de volta ao contrário: fixar de novo à mão e limpar a grade. O
// fechamento era de 22 dezenas, e sem dezena nenhuma não há de onde tirar os
// números — a tela mostrava bilhetes vazios sob uma manchete de garantia.
await opcoesDe(22, '', '', '');
const deNovo = await pagina.locator('#m-fechamento option').evaluateAll((os) => os.map((o) => o.value));
await pagina.selectOption('#m-fechamento', deNovo[qual]);
await pagina.waitForTimeout(1200);
conferir('fixar de novo à mão volta a valer',
  (await pagina.locator('#degrau').innerText()).includes('montou este fechamento à mão'));
await pagina.click('#limpar');
await pagina.waitForTimeout(1200);
conferir('limpar a grade solta o fechamento montado à mão',
  (await quantasCartelas(pagina)) === 0,
  `${await quantasCartelas(pagina)} bilhetes com a grade vazia`);
conferir('e a tela pede dezenas em vez de anunciar garantia',
  (await pagina.locator('.resposta').innerText()).includes('Marque mais'),
  (await pagina.locator('.resposta').innerText()).replace(/\s+/g, ' ').slice(0, 100));

// E de volta a um estado utilizável, que é de onde as seções seguintes partem.
await pagina.click('#escolher');
await esperarFechamento(pagina, 20000);

// ── a área de análise ───────────────────────────────────────────────────────
//
// Gerar e analisar são dois assuntos. A primeira tela confirma o que foi gerado
// e para por aí; cartelas, conferência, simulação e dinheiro ficam do outro
// lado de um toque, organizados numa barra de abas.

await pagina.fill('#valor', 'R$ 400,00');
await pagina.dispatchEvent('#valor', 'change');
await pagina.click('#escolher');
await esperarFechamento(pagina, 20000);
await pagina.waitForTimeout(400);

const cartao = (await pagina.locator('#secao-bilhetes').innerText()).replace(/\s+/g, ' ');
conferir('o cartão confirma que o fechamento foi gerado', cartao.includes('Fechamento gerado'),
  cartao);
conferir('e diz quantas cartelas são', /\d+ cartelas de \d+ dezenas/.test(cartao), cartao);
conferir('e quanto custam', /R\$ [\d.]+,\d\d/.test(cartao), cartao);
conferir('e oferece o caminho para as cartelas',
  (await pagina.locator('[data-acao=abrir]').innerText()).includes('Visualizar cartelas'));
conferir('e nenhuma cartela aparece antes de alguém pedir',
  (await pagina.locator('main .bilhetes li').count()) === 0);
conferir('e a área começa fechada', await pagina.locator('#analise').isHidden());

// O toque engolido: digitar um valor e tocar no botão dispara o `change` do
// campo ao perder o foco. Se o cartão se redesenhar aí, o botão que o dedo ia
// acertar deixa de existir no meio do caminho, e a pessoa toca duas vezes.
await pagina.fill('#valor', 'R$ 700,00');
await pagina.locator('[data-acao=abrir]').click();
await pagina.waitForTimeout(700);
conferir('um toque só abre a área, mesmo vindo do campo de dinheiro',
  !(await pagina.locator('#analise').isHidden()));

conferir('a área diz o que está mostrando',
  /[\d.]+ cartelas? de \d+ dezenas/.test(await pagina.locator('#analise-titulo').innerText()),
  await pagina.locator('#analise-titulo').innerText());
conferir('e as cartelas estão lá',
  (await pagina.locator('#lista-cartelas .bilhetes li').count()) > 0);

// Uma coisa de cada vez: a barra de abas mostra uma, e só uma.
for (const aba of ['cartelas', 'conferir', 'simular', 'valores', 'resumo']) {
  await pagina.click(`#abas [data-aba=${aba}]`);
  const abertas = [];
  for (const outraAba of ['cartelas', 'conferir', 'simular', 'valores', 'resumo']) {
    if (await pagina.locator(`#aba-${outraAba}`).isVisible()) abertas.push(outraAba);
  }
  conferir(`a aba ${aba} aparece sozinha`, abertas.join() === aba, abertas.join());
  conferir(`e a barra marca ${aba}`,
    (await pagina.locator('#abas [aria-selected=true]').count()) === 1);
}

// ── simular ─────────────────────────────────────────────────────────────────
//
// Com as 25 marcadas todo sorteio cai dentro do pool por definição, e a
// diferença entre os dois modos desaparece. A simulação se cobra num pool
// menor, que é onde ela tem algo a dizer.
await fechar(pagina);
await pagina.evaluate(() => { document.getElementById('det-manual').open = true; });
await pagina.selectOption('#m-pool', '22');
await esperarFechamento(pagina, 20000);
await pagina.waitForTimeout(600);
conferir('a simulação parte de um pool menor que o universo',
  (await pagina.locator('.grade [aria-pressed=true]').count()) === 22);
await abrir(pagina, 'simular');
await pagina.selectOption('#s-quantos', '100');
await pagina.selectOption('#s-onde', 'real');
await pagina.click('#simular');
await pagina.waitForFunction(() => document.getElementById('simulacao').innerText.includes('Gasto'),
  null, { timeout: 60000 });
const simulacao = (await pagina.locator('#simulacao').innerText()).replace(/\s+/g, ' ');
conferir('a simulação diz quantos sorteios percorreu',
  simulacao.includes('100 sorteios entre as 25 dezenas'), simulacao.slice(0, 90));
conferir('e o melhor resultado', /Melhor resultado: \d+ acertos/.test(simulacao));
conferir('e fecha a conta do dinheiro',
  /Gasto R\$ [\d.]+,\d\d/.test(simulacao) && /Prêmios de 11 a 13 R\$/.test(simulacao)
  && /Resultado −?R\$/.test(simulacao), simulacao.slice(-160));
// O número que separa uma simulação honesta de propaganda: num sorteio entre as
// 25, a garantia quase nunca se aplica, e a tela tem de dizer isso.
//
// A frase tem três formas — nenhum, um, vários —, e qual delas aparece depende
// do sorteio. O molde antigo, `ca[íi]ram?`, casava "caíram" e "caíra", e não
// casava "caiu": a forma do singular. Ela sai quando exatamente um dos cem
// sorteios cai no pool, o que acontece em cerca de uma corrida em vinte — e nas
// outras dezenove a conferência passava. Um teste que reprova por sorteio, com
// a tela certa, não prova nada e ainda gasta o crédito das suítes; e o mesmo
// molde alimentava a contagem logo abaixo, que no singular lia zero e aprovava
// sem olhar. As três formas se conferem aqui, de uma vez e sem sorteio nenhum,
// e só então a frase de verdade passa pelo mesmo molde.
const CAIU_NO_POOL =
  /(Nenhum sorteio caiu|[\d.]+ sorteios? ca(?:iu|íram)) inteiro dentro do seu pool/;
for (const [forma, frase] of [
  ['nenhum', 'Nenhum sorteio caiu inteiro dentro do seu pool'],
  ['um', '1 sorteio caiu inteiro dentro do seu pool'],
  ['vários', '37 sorteios caíram inteiro dentro do seu pool'],
  ['milhares', '1.000 sorteios caíram inteiro dentro do seu pool'],
]) {
  conferir(`a frase do pool é reconhecida na forma "${forma}"`, CAIU_NO_POOL.test(frase), frase);
}
conferir('e diz em quantos sorteios a garantia chegou a valer',
  CAIU_NO_POOL.test(simulacao), simulacao.slice(0, 200));
// E esse número tem de ser pequeno. Um sorteio entre as 25 cai inteiro num pool
// de 22 em cerca de 5% das vezes; se a simulação "da vida real" estivesse
// sorteando dentro do pool, ela mostraria a garantia valendo sempre — que é
// exatamente como uma simulação vira propaganda.
const caiuDentro = Number(
  (simulacao.match(/([\d.]+) sorteios? ca(?:iu|íram) inteiro/)?.[1] ?? '0').replace(/\./g, ''));
conferir('e na vida real isso acontece poucas vezes, não sempre',
  caiuDentro <= 30, `${caiuDentro} de 100 sorteios caíram dentro do pool`);

// Mil sorteios dentro do pool: são os concursos em que a garantia vale, e ali
// ela tem de valer em todos — a mesma promessa que a varredura exaustiva cobra,
// vista por outro caminho.
await pagina.selectOption('#s-quantos', '1000');
await pagina.selectOption('#s-onde', 'pool');
await pagina.click('#simular');
await pagina.waitForFunction(
  () => document.getElementById('simulacao').innerText.includes('dentro das suas'), null,
  { timeout: 90000 });
const noPool = (await pagina.locator('#simulacao').innerText()).replace(/\s+/g, ' ');
conferir('mil sorteios dentro do pool rodam e respondem',
  noPool.includes('1.000 sorteios dentro das suas'), noPool.slice(0, 90));
const garantia = Number((await pagina.locator('.numero').innerText()).match(/\d+/)?.[0] ?? 0);
// A distribuição do **melhor bilhete de cada sorteio** — não as faixas. Num
// sorteio em que a garantia de 12 se cumpre, outros bilhetes fazem 11 sem que a
// promessa falhe; o que não pode existir é sorteio cujo melhor bilhete fique
// abaixo dela.
const melhoresPorSorteio = await pagina.evaluate(() => {
  const tabela = [...document.querySelectorAll('#simulacao .quadro')]
    .find((t) => t.innerText.includes('Melhor cartela do sorteio'));
  return [...(tabela?.querySelectorAll('tbody tr') ?? [])].map((tr) => ({
    acertos: Number(tr.cells[0].innerText.match(/\d+/)?.[0] ?? -1),
    doFechamento: Number(tr.cells[1].innerText.replace(/\D/g, '')),
  }));
});
// A tabela mostra os dois lados, e linhas abaixo da garantia existem — mas são
// do chute. A coluna do fechamento tem de estar zerada nelas.
conferir('e nenhum sorteio do fechamento fica abaixo da garantia',
  melhoresPorSorteio.length > 0
  && melhoresPorSorteio.filter((l) => l.acertos < garantia).every((l) => l.doFechamento === 0),
  `garantia ${garantia}, linhas ${JSON.stringify(melhoresPorSorteio)}`);
conferir('e a tela avisa que estes concursos são raros na vida real',
  noPool.includes('Estes são os concursos em que a garantia vale'), noPool.slice(0, 160));

// ── o chute, medido ao lado do fechamento ───────────────────────────────────
//
// A frase que o aplicativo repete desde o começo — "o fechamento compra
// certeza, não lucro" — passa a ser um número na frente de quem duvida. É a
// conferência mais importante desta área, porque é a única que pode mostrar o
// aplicativo estando errado sobre si mesmo.

await pagina.selectOption('#s-quantos', '1000');
await pagina.selectOption('#s-onde', 'pool');
await pagina.click('#simular');
await pagina.waitForFunction(
  () => document.getElementById('simulacao').innerText.includes('Alcançou'), null,
  { timeout: 90000 });
const duelo = (await pagina.locator('#simulacao').innerText()).replace(/\s+/g, ' ');
conferir('a simulação compara o fechamento com o chute',
  duelo.includes('Seu fechamento') && duelo.includes('No chute'), duelo.slice(0, 120));

// A porcentagem chega escrita como o Brasil escreve — "44,5%" —, e `parseFloat`
// pararia na vírgula: 44,5 viraria 44. Truncar sempre para baixo é o pior jeito
// de errar aqui, porque a comparação de baixo é "o chute não passa do
// fechamento": com 44,9% contra 44,1%, os dois viram 44 e a violação passa.
const numeroBr = (texto) => Number.parseFloat(String(texto).replace(/\./g, '').replace(',', '.'));
const alcance = await pagina.evaluate(() => {
  const t = [...document.querySelectorAll('#simulacao .quadro')]
    .find((x) => x.innerText.includes('Alcançou'));
  const c = t?.querySelector('tbody tr')?.cells;
  return c ? { garantia: Number(t.innerText.match(/Alcançou (\d+)/)[1]),
    meu: c[1].innerText, chute: c[2].innerText } : null;
}).then((a) => (a ? { ...a, meu: numeroBr(a.meu), chute: numeroBr(a.chute) } : null));
conferir('e diz em que porcentagem cada lado alcançou a garantia',
  alcance && Number.isFinite(alcance.meu) && Number.isFinite(alcance.chute),
  JSON.stringify(alcance));
// Dentro do pool a garantia é certeza — 100%, sem exceção. Se esta linha
// mostrar menos, ou o fechamento está furado ou a conta está errada.
conferir('e o fechamento alcança a garantia em 100% dos sorteios de dentro do pool',
  alcance.meu === 100, `${alcance.meu}%`);
conferir('e o chute não a alcança mais do que o fechamento',
  alcance.chute <= alcance.meu, `chute ${alcance.chute}% × fechamento ${alcance.meu}%`);

// A distribuição junta os dois lados, e é onde se vê a promessa: o fechamento
// não tem sorteio nenhum abaixo da garantia; o chute tem.
const abaixo = await pagina.evaluate(() => {
  const t = [...document.querySelectorAll('#simulacao .quadro')]
    .find((x) => x.innerText.includes('Melhor cartela do sorteio'));
  return [...t.querySelectorAll('tbody tr')].map((tr) => ({
    acertos: Number(tr.cells[0].innerText.match(/\d+/)[0]),
    meu: Number(tr.cells[1].innerText.replace(/\D/g, '')),
    chute: Number(tr.cells[2].innerText.replace(/\D/g, '')),
  }));
});
conferir('a distribuição mostra os dois lados', abaixo.length > 0 && abaixo.every(
  (l) => Number.isFinite(l.meu) && Number.isFinite(l.chute)));
conferir('e o fechamento não tem nenhum sorteio abaixo da garantia',
  abaixo.filter((l) => l.acertos < alcance.garantia).every((l) => l.meu === 0),
  JSON.stringify(abaixo.filter((l) => l.acertos < alcance.garantia)));

// A conta do dinheiro separa o que se compara do que não se compara: 11 a 13
// pagam valor fixo; 14 e 15 são rateadas, e um acerto só vira milhão.
conferir('o dinheiro separa as faixas fixas das rateadas',
  duelo.includes('Prêmios de 11 a 13') && duelo.includes('Prêmios de 14 e 15'),
  duelo.slice(-200));
conferir('e a tela diz por que só uma das duas se compara',
  duelo.includes('não se compara'), duelo.slice(-200));

// ── valores ─────────────────────────────────────────────────────────────────

await pagina.click('#abas [data-aba=valores]');
await pagina.waitForTimeout(200);
const painel = (await pagina.locator('#valores').innerText()).replace(/\s+/g, ' ');
conferir('o painel de valores traz a conta pronta',
  painel.includes('Valor de cada cartela') && painel.includes('Custo total'), painel.slice(0, 90));
conferir('e o resultado da última simulação',
  painel.includes('sorteios simulados') && painel.includes('Resultado'), painel.slice(0, 160));
// Recolhido por padrão: a tabela de prêmios está lá, e não ocupa a tela.
conferir('a tabela de prêmios fica recolhida até alguém pedir',
  (await pagina.locator('#aba-valores details[open]').count()) === 0);

// E editável: quem discorda do preço corrige, e a conta segue.
const custoAntes = painel.match(/Custo total R\$ ([\d.]+,\d\d)/)?.[1];
// Qual cartela se edita depende do fechamento que está na mão.
const kEditado = await pagina.getAttribute('#valores [data-grupo=aposta]', 'data-chave');
await pagina.fill('#valores [data-grupo=aposta]', 'R$ 4,00');
await pagina.dispatchEvent('#valores [data-grupo=aposta]', 'change');
await pagina.waitForTimeout(600);
const custoDepois = (await pagina.locator('#valores').innerText())
  .replace(/\s+/g, ' ').match(/Custo total R\$ ([\d.]+,\d\d)/)?.[1];
conferir('editar o valor da cartela refaz o custo total',
  custoDepois && custoDepois !== custoAntes, `${custoAntes} → ${custoDepois}`);
// E é o mesmo preço da tela principal: dois lugares com preços diferentes seria
// um deles mentindo.
await fechar(pagina);
// `open = true` em vez de clicar no resumo: uma seção que já estava aberta se
// fecharia com o clique, e o teste passaria a medir a seção errada.
await pagina.evaluate(() => { document.getElementById('det-dinheiro').open = true; });
conferir('e a tabela de preços da tela principal diz o mesmo',
  (await pagina.inputValue(`#tabela-precos [data-grupo=aposta][data-chave="${kEditado}"]`))
    .includes('4,00'),
  await pagina.inputValue(`#tabela-precos [data-grupo=aposta][data-chave="${kEditado}"]`));
await pagina.click('#restaurar-precos');
await pagina.waitForTimeout(300);

// ── segunda visita, sem rede ────────────────────────────────────────────────

// A promessa é a do avião: o que já foi aberto continua abrindo. O catálogo
// inteiro não fica em cache — são mais de trezentos arquivos, e cada pessoa usa
// um punhado —, então o que se cobra aqui é que o pedido guardado volte inteiro.
await pagina.evaluate(() => navigator.serviceWorker.ready);

// Uma visita inteira sob o service worker antes de cortar a rede. Na primeira, o
// service worker ainda está instalando enquanto a página já pede arquivos, e o
// que passa antes de ele assumir não entra no cache — o que é a vida real, e não
// o que este teste quer medir.
await pagina.goto(endereco, { waitUntil: 'networkidle' });
await esperarFechamento(pagina);
conferir('o service worker assume a página',
  await pagina.evaluate(() => navigator.serviceWorker.controller !== null));

await contexto.setOffline(true);
await pagina.goto(endereco, { waitUntil: 'domcontentloaded' });
await esperarFechamento(pagina, 20000);
conferir('a segunda visita reabre sem rede o que já estava aberto',
  (await quantasCartelas(pagina)) > 0);

// E um fechamento que nunca foi aberto: sem rede ele não chega, e a tela não
// pode ser apagada por isso.
await pagina.click('#escolher');
await pagina.waitForTimeout(1500);
conferir('e uma falha de rede não apaga a resposta',
  /^\d+$/.test(await pagina.locator('.numero').innerText()));
await contexto.setOffline(false);

conferir('nenhum erro de JavaScript no caminho todo', erros.length === 0, erros.join(' | '));

// ── primeira visita sem rede, mexendo no que ainda não carregou ─────────────
//
// Os controles existem na página antes de o catálogo chegar. Sem rede na
// primeira visita ele nunca chega — e mexer neles não pode quebrar a tela, que
// é o que ainda restava para dizer "abra de novo quando houver rede".

const semRede = await navegador.newContext({ viewport: { width: 360, height: 740 } });
await semRede.route('**/catalogo/**', (rota) => rota.abort());
const primeira = await semRede.newPage();
const errosSemRede = [];
primeira.on('pageerror', (e) => errosSemRede.push(String(e)));
await primeira.goto(endereco, { waitUntil: 'domcontentloaded' });
await primeira.waitForTimeout(1500);
conferir('sem catálogo a tela diz o que fazer',
  (await primeira.locator('.resposta').innerText()).includes('Sem internet'),
  await primeira.locator('.resposta').innerText());
await primeira.click('#det-manual summary');
await primeira.fill('#m-teto', '7');
await primeira.dispatchEvent('#m-teto', 'input');
await primeira.click('.grade [data-dezena="3"]');
await primeira.waitForTimeout(800);
conferir('e mexer no modo manual sem catálogo não quebra nada',
  errosSemRede.length === 0, errosSemRede.join(' | '));
conferir('e o aviso continua na tela',
  (await primeira.locator('.resposta').innerText()).includes('Sem internet'),
  await primeira.locator('.resposta').innerText());
await semRede.close();

// ── com a memória do aparelho trancada ──────────────────────────────────────

// Navegação privada e "bloquear dados de sites" fazem `localStorage` **lançar**,
// não devolver vazio. Um aplicativo que guarda o que a pessoa marcou tem de
// continuar respondendo aí — perder o que foi guardado é aceitável; não abrir,
// não é.
const trancado = await navegador.newContext({ viewport: { width: 360, height: 740 } });
await trancado.addInitScript(() => {
  const recusa = { get: () => { throw new Error('acesso negado'); } };
  Object.defineProperty(window, 'localStorage', recusa);
  Object.defineProperty(window, 'sessionStorage', recusa);
});
const semMemoria = await trancado.newPage();
const errosSemMemoria = [];
semMemoria.on('pageerror', (e) => errosSemMemoria.push(String(e)));
await semMemoria.goto(endereco, { waitUntil: 'networkidle' });
await semMemoria.click('#escolher');
await esperarFechamento(semMemoria, 20000);
conferir('sem poder guardar nada, o aplicativo ainda responde',
  (await quantasCartelas(semMemoria)) > 0);
conferir('e sem erro de JavaScript', errosSemMemoria.length === 0, errosSemMemoria.join(' | '));

// ── um bilhete não se veste de garantia ─────────────────────────────────────
//
// Com dinheiro para um bilhete só, a manchete deixa de ser um número de acertos
// e passa a ser o que a pessoa comprou. "11 acertos garantidos" ali seria
// verdade e seria engano: um bilhete não tem com quem se completar, e a
// garantia é tautologia — ele acerta o que acertar.
await semMemoria.fill('#valor', 'R$ 3,50');
await semMemoria.dispatchEvent('#valor', 'change');
await semMemoria.click('#escolher');
await esperarFechamento(semMemoria, 20000);
const manchete = await semMemoria.locator('.resposta').innerText();
conferir('com uma cartela a manchete é a cartela',
  /cartela de \d+ dezenas/.test(manchete), manchete);
conferir('e não promete acertos garantidos', !/acertos garantidos/.test(manchete), manchete);
conferir('e diz que um bilhete não é fechamento', manchete.includes('não é fechamento'), manchete);
// E não fala d*a* garantia logo depois de dizer que não há garantia nenhuma: a
// ressalva sobre o sorteio cair dentro do pool é sobre uma promessa que esta
// resposta não faz.
conferir('e não fala de uma garantia que acabou de negar',
  !manchete.includes('A garantia só vale'), manchete);
conferir('e a tela entrega esse um bilhete',
  (await quantasCartelas(semMemoria)) === 1);

conferir('e o degrau ensina onde o fechamento começa, sem partir de garantia nenhuma',
  /cartelas que se completam/.test(await semMemoria.locator('#degrau').innerText()),
  await semMemoria.locator('#degrau').innerText());

// "1 bilhetes", "1 jogos", "1 cartelas": o erro que faz a pessoa desconfiar do
// resto da tela. Com um bilhete só na mão, a página inteira — resposta,
// carteira, bolão, a lista do modo manual — não pode escrever nenhum deles.
await semMemoria.click('[data-acao=guardar]');
await semMemoria.click('#det-bolao summary');
await semMemoria.click('#det-manual summary');
await semMemoria.selectOption('#m-pool', '15');
await semMemoria.waitForTimeout(800);
const aPaginaToda = await semMemoria.locator('body').innerText();
const singularErrado = ['1 bilhetes', '1 jogos', '1 cartelas', '1 dezenas', '1 partes',
  '1 fechamentos']
  .filter((erro) => aPaginaToda.includes(erro));
conferir('e nenhum plural sobra num contador de um só', singularErrado.length === 0,
  singularErrado.join(', '));
conferir('a carteira guarda "1 cartela", no singular',
  /· 1 cartela de \d+ dezenas/.test(aPaginaToda.replace(/\s+/g, ' ')),
  await semMemoria.locator('.registros li').innerText());

// Marcar exatamente as quinze favoritas é o que muita gente faz de primeira, e
// ali não há fechamento nenhum — nem um degrau acima para comprar. A tela tem de
// dizer o que fazer, e não só constatar que não há o que comprar.
await semMemoria.click('#limpar');
for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  await semMemoria.click(`.grade [data-dezena="${d}"]`);
}
await esperarFechamento(semMemoria, 20000);
conferir('com as quinze marcadas, a tela diz o que fazer em vez de dar em nada',
  (await semMemoria.locator('#degrau').innerText()).includes('marque mais dezenas'),
  await semMemoria.locator('#degrau').innerText());

await trancado.close();



// ── uma palavra só para a mesma coisa ───────────────────────────────────────
//
// A tela dizia "28 jogos de 16 dezenas", "ao menos um destes bilhetes" e "28
// cartelas de 16 dezenas" — três palavras para o mesmo papel preenchido, no
// mesmo cartão, para quem nunca ouviu falar de fechamento. E a distinção passou
// a carregar peso: uma **cartela** de 16 dezenas contém 16 **apostas** simples,
// e é essa diferença que explica o prêmio. Com as palavras embaralhadas, a
// explicação não tem onde se apoiar.
//
// A varredura não olha uma frase: olha as três regiões que a pessoa lê antes de
// abrir a análise, e reprova se aparecer mais de uma palavra para o papel.
{
  const nomes = { cartela: /\bcartelas?\b/i, bilhete: /\bbilhetes?\b/i, jogo: /\bjogos?\b/i };
  const caixa = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await caixa.newPage();
  await pg.goto(endereco, { waitUntil: 'networkidle' });

  const misturadas = async (onde) => {
    const texto = (await pg.locator(onde).innerText().catch(() => '')).replace(/\s+/g, ' ');
    return Object.entries(nomes).filter(([, r]) => r.test(texto)).map(([n]) => n);
  };
  const olhar = async (rotulo) => {
    for (const onde of ['.resposta', '#secao-bilhetes', '#degrau']) {
      const achadas = await misturadas(onde);
      conferir(`${rotulo}: ${onde} usa uma palavra só para a cartela`,
        achadas.length <= 1, `usou ${achadas.join(' e ')}`);
    }
  };

  await pg.click('#escolher');
  await esperarFechamento(pg, 20000);
  await olhar('escolhido pelo dinheiro');

  // E com cartela maior que a aposta simples, que é onde as duas palavras
  // precisam mais estar separadas.
  await pg.click('#det-manual summary');
  await pg.selectOption('#m-pool', '25');
  await pg.selectOption('#m-k', '16');
  await pg.waitForTimeout(400);
  await pg.selectOption('#m-fechamento', '16-11');
  await esperarFechamento(pg, 20000);
  await olhar('montado à mão, cartela de 16');

  // E o piso não é um número solto: "menos de 5" ao lado de "R$ 1.568,00" se lê
  // como cinco reais.
  const piso = (await pg.locator('.piso').innerText().catch(() => '')).replace(/\s+/g, ' ');
  conferir('e o piso diz de que são as unidades',
    /menos de \d+ cartelas?/.test(piso), piso);
  await caixa.close();
}

// ── um bilhete grande são várias apostas, e paga como várias ────────────────
//
// A lotérica cobra R$ 56,00 por um bilhete de 16 dezenas porque ele **é** as 16
// apostas de 15 que cabem dentro dele. Porque cobra assim, paga assim: um
// bilhete de 16 com 14 acertos leva duas catorzes e catorze trezes, não uma
// catorze. O aplicativo pagava um prêmio só por bilhete, e o dinheiro que
// mostrava — na conferência, na simulação, na carteira e na expectativa — ficava
// abaixo do que a lotérica deposita: 14% do certo num bilhete de 16 dezenas, e
// um milésimo num de 20.
{
  const caixa = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await caixa.newPage();
  await pg.goto(endereco, { waitUntil: 'networkidle' });
  // 25 dezenas, cartelas de 16, garantindo 11: 28 bilhetes, o menor fechamento
  // do catálogo com bilhete maior que a aposta simples.
  await pg.click('#det-manual summary');
  await pg.selectOption('#m-pool', '25');
  await pg.selectOption('#m-k', '16');
  await pg.waitForTimeout(400);
  await pg.selectOption('#m-fechamento', '16-11');
  await esperarFechamento(pg, 20000);

  // A frase mais visível do aplicativo — "esses 11 acertos pagam X por cartela
  // premiada" — também estava abaixo do que a lotérica deposita. Numa cartela
  // de 16 dezenas, cinco das dezesseis apostas ficam com as onze certas:
  // C(11,11) × C(5,4) = 5, e o prêmio é cinco onzes.
  const precos = JSON.parse(await readFile(new URL('../catalogo/precos.json', import.meta.url)));
  const emReais = (c) => (c / 100).toLocaleString('pt-BR',
    { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');
  const naTela = (await pg.locator('.resposta').innerText()).replace(/\s/g, ' ');
  conferir('a garantia de 11 numa cartela de 16 vale cinco onzes',
    naTela.includes(`pagam ${emReais(5 * precos.premio[11])} por cartela`),
    naTela.slice(0, 200));
  // E o número é explicado onde ele contradiz a tabela de preços: ali a faixa
  // de 11 vale R$ 7,00, e a resposta diz R$ 35,00.
  conferir('e a tela diz de onde vêm os cinco',
    naTela.includes('são 5 apostas de 15 dentro dela'), naTela.slice(0, 200));

  await abrir(pg, 'conferir');
  await pg.fill('#sorteio', '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15');
  await pg.dispatchEvent('#sorteio', 'change');
  await pg.waitForTimeout(400);

  const conferencia = (await pg.locator('#conferencia').innerText()).replace(/\s+/g, ' ');
  conferir('a conferência explica que o bilhete de 16 vale 16 apostas',
    conferencia.includes('vale 16 apostas de 15'), conferencia.slice(0, 120));

  // O dinheiro tem de passar da conta ingênua — "uma cartela premiada, um
  // prêmio" —, que é exatamente o que o aplicativo fazia antes.
  const dados = await pg.evaluate(() => {
    const texto = document.getElementById('conferencia').innerText;
    const linhas = [...texto.matchAll(/(\d+) × (\d+) acertos/g)]
      .map((m) => [Number(m[1]), Number(m[2])]);
    const voltou = texto.match(/voltou R\$\s*([\d.]+,\d\d)/);
    return { linhas, voltou: voltou && voltou[1] };
  });
  const centavos = (t) => Math.round(Number(t.replace(/\./g, '').replace(',', '.')) * 100);
  const ingenua = dados.linhas.reduce((soma, [q, a]) => soma + q * (precos.premio[a] ?? 0), 0);
  conferir('e o sorteio premiou alguma cartela', dados.linhas.length > 0 && ingenua > 0,
    JSON.stringify(dados));
  conferir('e o que voltou passa da conta de um prêmio por cartela',
    dados.voltou && centavos(dados.voltou) > ingenua,
    `voltou ${dados.voltou} · uma-por-cartela daria ${(ingenua / 100).toFixed(2)}`);

  // Com aposta simples não há decomposição nenhuma, e a frase não aparece.
  await fechar(pg);
  await pg.selectOption('#m-k', '15');
  await pg.waitForTimeout(400);
  await pg.selectOption('#m-fechamento', '15-11');
  await esperarFechamento(pg, 20000);
  await abrir(pg, 'conferir');
  await pg.fill('#sorteio', '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15');
  await pg.dispatchEvent('#sorteio', 'change');
  await pg.waitForTimeout(400);
  const simples = (await pg.locator('#conferencia').innerText()).replace(/\s+/g, ' ');
  conferir('e com bilhete de 15 dezenas não há o que explicar',
    !simples.includes('apostas de 15'), simples.slice(0, 120));
  await caixa.close();
}

// ── o que um leitor de tela encontra ────────────────────────────────────────
//
// Duas coisas que só aparecem quando se olha a tela pelo nome dos elementos, e
// não pelo desenho. Quem navega por título e quem lê a lista de botões fora do
// contexto visual depende das duas.
{
  const caixa = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await caixa.newPage();
  await pg.goto(endereco, { waitUntil: 'networkidle' });
  await pg.click('#escolher');
  await esperarFechamento(pg, 20000);
  await pg.click('#det-bolao summary');
  await pg.fill('#partes', '4');
  await pg.dispatchEvent('#partes', 'input');
  await pg.click('#det-dinheiro summary');
  await pg.waitForTimeout(400);

  // Quatro botões escritos "Copiar link" copiam quatro links diferentes. Na
  // tela, a linha ao lado diz qual é qual; na lista de botões de um leitor de
  // tela, são quatro vezes a mesma frase e nenhuma maneira de escolher.
  const partes = await pg.evaluate(() => [...document.querySelectorAll('#bolao button')]
    .map((b) => b.getAttribute('aria-label') || b.textContent.trim()));
  conferir('cada parte do bolão tem seu próprio nome',
    partes.length === 4 && new Set(partes).size === 4, partes.join(' · '));

  // A carteira tem o mesmo problema, e por mais tempo: cada registro guardado
  // traz "Abrir" e "Apagar", e com três jogos guardados são seis botões e duas
  // palavras. Na tela a linha ao lado diz de que jogo são; na lista de botões,
  // não — e apagar o errado apaga o jogo de outro dia, sem desfazer.
  await pg.evaluate(() => {
    document.getElementById('det-carteira').open = true;
  });
  // Três jogos diferentes, guardados um a um: é assim que a carteira de alguém
  // fica, e é com mais de um registro que a repetição aparece. `esperarFechamento`
  // não serve aqui — o cartão já está na tela desde o "escolher por mim", e ela
  // voltaria na hora, antes de as cartelas do orçamento novo chegarem.
  for (const orcamento of ['R$ 40,00', 'R$ 300,00', 'R$ 2.000,00']) {
    await pg.fill('#valor', orcamento);
    await pg.dispatchEvent('#valor', 'change');
    await pg.waitForTimeout(700);
    await pg.click('[data-acao=guardar]');
    await pg.waitForTimeout(150);
  }
  const carteira = await pg.evaluate(() => ({
    nomes: [...document.querySelectorAll('.registros button')]
      .map((b) => b.getAttribute('aria-label') || b.textContent.trim()),
    // Os registros em si, sem o texto dos botões: se dois deles saíssem iguais,
    // dois nomes iguais seriam a verdade e não um defeito — e a conferência
    // estaria reprovando o preparo, não o produto.
    linhas: [...document.querySelectorAll('.registros li')]
      .map((li) => li.innerText.replace(/Abrir|Apagar/g, '').replace(/\s+/g, ' ').trim()),
  }));
  conferir('e cada botão da carteira também tem o seu',
    carteira.nomes.length >= 4
    && new Set(carteira.linhas).size === carteira.linhas.length
    && new Set(carteira.nomes).size === carteira.nomes.length,
    `${carteira.nomes.length} botões, ${new Set(carteira.nomes).size} nomes · ${
      carteira.nomes.join(' | ')}`);

  // Pular de `h1` para `h3` deixa um degrau vazio: quem navega por título passa
  // do nome do aplicativo direto para a tabela de preços sem saber o que pulou.
  const titulos = await pg.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter((h) => h.getBoundingClientRect().width)
    .map((h) => ({ nivel: Number(h.tagName[1]), texto: h.textContent.trim().slice(0, 24) })));
  const pulos = titulos.filter((t, i) => i > 0 && t.nivel > titulos[i - 1].nivel + 1);
  conferir('os títulos da tela não pulam de nível', pulos.length === 0,
    `${titulos.map((t) => `h${t.nivel}:${t.texto}`).join(' | ')} — pulou em ${
      pulos.map((t) => `h${t.nivel}:${t.texto}`).join(', ')}`);
  await caixa.close();
}

// ── a conta em papel, antes do papel ────────────────────────────────────────
//
// "Imprimir volantes" com 3.608 cartelas na mão punha a caixa de impressão do
// sistema na frente da pessoa com **241 folhas** carregadas, e nada na tela
// tinha dito isso. Quem imprimisse sem olhar gastava uma resma; quem olhasse
// ainda teria de descobrir sozinho o que fazer. A funcionalidade não saiu de
// lugar nenhum: o painel passou a dizer o tamanho e a impressão passou a
// esperar um segundo toque.
{
  const caixa = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  // Nada de caixa de impressão de verdade no meio de uma suíte: o que interessa
  // é **quando** ela seria pedida.
  await caixa.addInitScript(() => {
    window.__imprimiu = 0;
    window.print = () => { window.__imprimiu++; };
  });
  const pg = await caixa.newPage();
  await pg.goto(endereco, { waitUntil: 'networkidle' });
  await pg.fill('#valor', 'R$ 400,00');
  await pg.dispatchEvent('#valor', 'change');
  await pg.click('#escolher');
  await esperarFechamento(pg, 20000);
  const cartelas = await quantasCartelas(pg);
  await abrir(pg, 'cartelas');
  await pg.locator('#lista-cartelas [data-acao=imprimir]').click();
  await pg.waitForTimeout(200);

  conferir('imprimir abre o painel de volantes', await pg.locator('#painel').isVisible());
  conferir('e ainda não mandou imprimir nada',
    (await pg.evaluate(() => window.__imprimiu)) === 0);

  const aviso = (await pg.locator('#painel-corpo .ajuda').innerText()
    .catch(() => '(o painel não diz nada)')).replace(/\s+/g, ' ');
  // Quinze volantes por folha, medido no próprio desenho com a mídia de
  // impressão emulada. Cinquenta e cinco cartelas são quatro folhas.
  const folhas = Math.ceil(cartelas / 15);
  conferir('e diz quantos volantes e quantas folhas serão',
    aviso.includes(`${cartelas} volantes`) && aviso.includes(`${folhas} folhas`), aviso);
  conferir('e o painel traz um volante para cada cartela',
    (await pg.locator('#painel-corpo .volante').count()) === cartelas);

  // O painel abre a partir da área de análise, que é uma camada opaca de tela
  // cheia. Sem ficar por cima dela, ele abria escondido atrás — com o ✕ dele
  // junto —, e quem fechasse a caixa de impressão do sistema ficava com um
  // painel aberto que não dava para ver nem fechar.
  conferir('e o painel fica na frente da área de análise', await pg.evaluate(() => {
    const p = document.getElementById('painel');
    const r = p.getBoundingClientRect();
    const em = document.elementFromPoint(r.left + r.width / 2, r.top + 8);
    return p.contains(em);
  }));

  const clicou = await pg.locator('#painel-corpo [data-acao=imprimir-agora]')
    .click({ timeout: 5000 }).then(() => true, () => false);
  await pg.waitForTimeout(200);
  conferir('e só então a impressão é pedida',
    clicou && (await pg.evaluate(() => window.__imprimiu)) === 1,
    clicou ? 'o botão não fez efeito' : 'não deu para tocar no botão');

  // A conta de folhas é da tela: gastar a primeira folha para dizer quantas
  // folhas seriam é o tipo de piada que ninguém acha graça no papel.
  await pg.emulateMedia({ media: 'print' });
  await pg.waitForTimeout(150);
  conferir('e nada disso vai junto para o papel',
    !(await pg.locator('#painel-corpo .ajuda').isVisible())
    && !(await pg.locator('#painel-corpo [data-acao=imprimir-agora]').isVisible()));
  await pg.emulateMedia({ media: 'screen' });
  await caixa.close();
}

// ── nada de mira fina ───────────────────────────────────────────────────────
//
// Quarenta e quatro pixels é o alvo de toque mínimo, e não é opinião: é a
// largura aproximada de uma ponta de dedo. Abaixo disso, errar o botão vizinho
// deixa de ser descuido e passa a ser o normal.
//
// O resto do aplicativo já respeitava esse número; a barra de abas da área de
// análise nasceu com 40, e ela é a navegação inteira daquela área — errar o
// alvo ali troca de assunto. Esta varredura passa por toda a página, em vez de
// citar um seletor, porque o próximo lugar a nascer pequeno não é este.
{
  const caixa = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await caixa.newPage();
  await pg.goto(endereco, { waitUntil: 'networkidle' });
  // A tabela de preços nasce recolhida, e é onde mora o campo mais largo do
  // aplicativo. Fechada, ela não entra em varredura nenhuma.
  await pg.click('#det-dinheiro summary');
  await pg.waitForTimeout(200);

  // Um valor de dinheiro cortado é um valor errado: "R$ 1.700.000," não é o
  // prêmio de 15 acertos, é o prêmio de 15 acertos sem os centavos. O campo do
  // prêmio maior não cabia na coluna, em largura de tela nenhuma.
  const cortados = () => pg.evaluate(() => [...document.querySelectorAll('input')]
    .filter((i) => i.type !== 'range' && i.getBoundingClientRect().width
      && i.scrollWidth > i.clientWidth + 1)
    .map((i) => `${i.id || i.dataset.chave || '?'}="${i.value}" (cabe ${i.clientWidth
      }, precisa ${i.scrollWidth})`));

  const miudos = () => pg.evaluate(() => {
    const fora = [];
    for (const el of document.querySelectorAll('button, summary, a[href], input, select')) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === 'hidden') continue;
      // O deslizador é agarrado pelo corpo inteiro, e a caixa dele não é o alvo.
      if (el.type === 'range' || el.type === 'checkbox') continue;
      if (r.width < 44 || r.height < 44) {
        fora.push(`${el.tagName.toLowerCase()}#${el.id || el.className || '?'} `
          + `"${(el.textContent || el.value || '').trim().slice(0, 18)}" `
          + `${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return fora;
  });

  let apertados = await miudos();
  conferir('nenhum alvo de toque menor que 44px na tela principal',
    apertados.length === 0, apertados.join(' · '));
  const truncados = await cortados();
  conferir('nenhum valor de dinheiro aparece cortado na tela principal',
    truncados.length === 0, truncados.join(' · '));

  await pg.click('#escolher');
  await esperarFechamento(pg, 20000);
  await pg.locator('[data-acao=abrir]').click();
  for (const aba of ['cartelas', 'conferir', 'simular', 'valores', 'resumo']) {
    await pg.click(`#abas [data-aba=${aba}]`);
    await pg.waitForTimeout(200);
    const aqui = await miudos();
    conferir(`nenhum alvo de toque menor que 44px na aba ${aba}`,
      aqui.length === 0, aqui.join(' · '));
    const cortadosAqui = await cortados();
    conferir(`nenhum valor de dinheiro aparece cortado na aba ${aba}`,
      cortadosAqui.length === 0, cortadosAqui.join(' · '));
    apertados = apertados.concat(aqui);
  }
  await caixa.close();
}

// ── a navegação inteira, à vista ────────────────────────────────────────────
//
// As cinco abas somam 455 px de conteúdo. A barra rolava na horizontal com a
// barra de rolagem escondida — em telefone nenhum, de 320 a 414 de largura, a
// quinta cabia —, e nada dizia que havia mais: nem barra, nem sombra, nem meia
// aba assomando na borda. A escondida era a do **resumo**, onde mora a
// varredura exaustiva que prova a garantia anunciada na primeira tela.
//
// "Uma coisa de cada vez, todas a um toque" só é verdade se todas estiverem à
// vista. A conferência é de posição, e não de estilo: qualquer jeito de fazer
// as cinco caberem passa aqui.
for (const largura of [320, 360, 390, 414]) {
  const caixa = await navegador.newContext({ viewport: { width: largura, height: 800 } });
  const pg = await caixa.newPage();
  await pg.goto(endereco, { waitUntil: 'networkidle' });
  await pg.click('#escolher');
  await esperarFechamento(pg, 20000);
  await abrir(pg);
  const fora = await pg.evaluate((w) => [...document.querySelectorAll('#abas button')]
    .filter((b) => {
      const r = b.getBoundingClientRect();
      return r.left < -0.5 || r.right > w + 0.5;
    })
    .map((b) => `${b.textContent.trim()} termina em ${Math.round(b.getBoundingClientRect().right)}`),
  largura);
  // Sem esta contagem a conferência acima passa quando não há aba nenhuma —
  // área que não abriu, seletor que mudou de nome —, que é o jeito de um teste
  // de posição ficar verde sem ter olhado para nada.
  const quantas = await pg.locator('#abas button').count();
  conferir(`as cinco abas cabem na tela de ${largura} px`,
    quantas === 5 && fora.length === 0, `${quantas} abas · ${fora.join(' · ')}`);
  await caixa.close();
}

// E numa tela larga elas ficam na coluna do conteúdo, e não na largura da
// janela. As abas repartem entre si a linha em que estão; sem um limite, a
// linha é a janela inteira — numa tela de 1.200 px, cinco pílulas de 230 px
// sobre uma coluna de conteúdo de 704, centrada, alinhadas com nada.
{
  const caixa = await navegador.newContext({ viewport: { width: 1200, height: 900 } });
  const pg = await caixa.newPage();
  await pg.goto(endereco, { waitUntil: 'networkidle' });
  await pg.click('#escolher');
  await esperarFechamento(pg, 20000);
  await abrir(pg);
  const colunas = await pg.evaluate(() => {
    const a = document.getElementById('abas').getBoundingClientRect();
    const c = document.getElementById('aba-cartelas').getBoundingClientRect();
    return { abas: [Math.round(a.left), Math.round(a.right)],
      conteudo: [Math.round(c.left), Math.round(c.right)] };
  });
  conferir('em tela larga, as abas ficam na coluna do conteúdo',
    Math.abs(colunas.abas[0] - colunas.conteudo[0]) <= 1
    && Math.abs(colunas.abas[1] - colunas.conteudo[1]) <= 1,
    JSON.stringify(colunas));
  await caixa.close();
}

// ── a barra que media coisa nenhuma, e o ponto no lugar da vírgula ──────────
//
// Duas coisas na mesma tabela de simulação, e as duas invisíveis de tão à
// vista:
//
// A coluna de barras da distribuição desenhava **sempre o mesmo traço**. A
// largura ia em porcentagem numa célula de tabela sem largura própria, a
// porcentagem resolvia contra quase nada, e as seis barras — pedidas a 0%, 2%,
// 22%, 24%, 95% e 100% — saíam todas nos 2 px do `min-width`. Uma coluna
// inteira ocupando espaço e não dizendo nada.
//
// E as porcentagens saíam com ponto: "51.0%" numa tela onde todo o resto já
// vinha em pt-BR — R$ 21,00, 1.631, 3.268.760. `toFixed` não fala português.
{
  const caixa = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await caixa.newPage();
  await pg.goto(endereco, { waitUntil: 'networkidle' });
  await pg.click('#escolher');
  await esperarFechamento(pg, 20000);
  await abrir(pg, 'simular');
  await pg.click('#simular');
  await pg.waitForFunction(() => document.querySelector('#simulacao table'), null, { timeout: 60000 });

  const barras = await pg.evaluate(() => [...document.querySelectorAll('#simulacao .barra')]
    .map((b) => ({
      pedido: Number.parseFloat(b.style.width),
      trilho: b.parentElement.getBoundingClientRect().width,
      real: b.getBoundingClientRect().width,
    })));
  // Uma barra desenha o que a linha diz — a fatia pedida do trilho, nunca menos
  // que os 2 px que a fazem existir.
  const erradas = barras.filter(({ pedido, trilho, real }) =>
    Math.abs(real - Math.max(2, (pedido * trilho) / 100)) > 1.5);
  conferir('cada barra da distribuição mede a fatia que a linha diz',
    barras.length >= 3 && erradas.length === 0,
    barras.map((b) => `${b.pedido}% de ${Math.round(b.trilho)} deu ${Math.round(b.real)}`).join(' · '));
  // E o defeito antigo passava pela conferência acima se o trilho fosse zero:
  // 2 px é o mínimo, e todo mundo em 2 px "confere". O que ele não sobrevive é
  // a esta: barras de tamanhos diferentes têm de sair diferentes.
  conferir('e barras de tamanhos diferentes saem diferentes',
    new Set(barras.map((b) => Math.round(b.real))).size >= 3,
    barras.map((b) => Math.round(b.real)).join(' '));

  const aba = (await pg.locator('#aba-simular').innerText()).replace(/\s+/g, ' ');
  const comPonto = aba.match(/\d+\.\d+\s*%/g) ?? [];
  conferir('nenhuma porcentagem escrita com ponto decimal', comPonto.length === 0,
    comPonto.join(' · '));
  conferir('e a comparação com o chute vem em porcentagem brasileira',
    /\d+,\d+\s*%/.test(aba), aba.match(/[\d.,]+\s*%/g)?.join(' · ') ?? '(nenhuma porcentagem)');

  await pg.click('#tab-resumo');
  await pg.click('#det-acaso > summary');
  await pg.waitForTimeout(200);
  const acaso = (await pg.locator('#acaso').innerText()).replace(/\s+/g, ' ');
  const pontoNoAcaso = acaso.match(/\d+\.\d+\s*%/g) ?? [];
  // A exigência de haver uma porcentagem à brasileira não é enfeite: sem ela,
  // um "e se eu jogasse no chute?" que não desenhasse porcentagem nenhuma
  // passaria por não ter ponto em lugar nenhum.
  conferir('nem no "e se eu jogasse no chute?"',
    pontoNoAcaso.length === 0 && /\d+,\d+\s*%/.test(acaso),
    `com ponto: ${pontoNoAcaso.join(' · ') || 'nenhuma'} · todas: ${
      acaso.match(/[\d.,]+\s*%/g)?.join(' ') ?? 'nenhuma'}`);

  // ── e o cabeçalho gruda como uma peça só ─────────────────────────────────
  //
  // Título e abas grudavam no topo cada um por sua conta, e o de baixo carregava
  // a altura do de cima escrita à mão: `top: 3rem` contra os 63 px que o título
  // mede. Assim que a página rolava, as abas subiam **por cima** dos 15 px de
  // baixo do título — e do botão "Voltar", que é a única saída da área.
  await pg.click('#tab-simular');
  await pg.evaluate(() => { document.getElementById('analise').scrollTop = 600; });
  await pg.waitForTimeout(150);
  const cabeca = await pg.evaluate(() => {
    const t = document.querySelector('.analise-topo').getBoundingClientRect();
    const a = document.getElementById('abas').getBoundingClientRect();
    const v = document.getElementById('voltar').getBoundingClientRect();
    return {
      rolou: document.getElementById('analise').scrollTop,
      // Positivo quer dizer que as abas invadiram o que está acima delas.
      sobreOTitulo: Math.round(t.bottom - a.top),
      sobreOVoltar: Math.round(v.bottom - a.top),
    };
  });
  // `rolou > 0` não é enfeite: sem rolagem nada gruda, e a conferência passaria
  // sem ter olhado para o que ela existe para olhar.
  conferir('rolando, as abas não sobem por cima do título nem do "Voltar"',
    cabeca.rolou > 0 && cabeca.sobreOTitulo <= 0 && cabeca.sobreOVoltar <= 0,
    JSON.stringify(cabeca));
  await caixa.close();
}

// ── com o que foi guardado estragado ────────────────────────────────────────
//
// O que volta do `localStorage` é de fora tanto quanto um endereço numa barra:
// pode ter sido escrito por outra versão do aplicativo, por uma gravação
// interrompida, ou por outra aba mexendo ao mesmo tempo. Cada caso abaixo já
// fez o aplicativo **não abrir** — tela em branco e um `TypeError` — por uma
// chave que ele mesmo sabia dispensar, e a pessoa não tem como adivinhar que o
// conserto é limpar os dados do site.
//
// O que se cobra não é sobreviver: é **responder**. Pintar a casca e não chegar
// a uma resposta seria a mesma tela morta com outro nome.
const comMemoria = async (nome, guardado, olhar = null) => {
  const caixa = await navegador.newContext({ viewport: { width: 360, height: 740 } });
  await caixa.addInitScript((d) => {
    for (const [chave, valor] of Object.entries(d)) localStorage.setItem(chave, valor);
  }, guardado);
  const pg = await caixa.newPage();
  const ruins = [];
  pg.on('pageerror', (e) => ruins.push(String(e)));
  await pg.goto(endereco, { waitUntil: 'networkidle' });
  const respondeu = await pg.waitForSelector('.resposta .numero, .resposta .aviso',
    { timeout: 15000 }).then(() => true, () => false);
  const texto = (await pg.locator('#resposta').innerText()).replace(/\s+/g, ' ').trim();
  conferir(`com ${nome}, o aplicativo abre e responde`, respondeu && ruins.length === 0,
    ruins.join(' | ') || `resposta: "${texto.slice(0, 70)}"`);
  if (olhar) await olhar(pg, texto);
  await caixa.close();
};

await comMemoria('as dezenas guardadas sem ser uma lista', { dezenas: '{"x":1}' });
await comMemoria('lixo no meio das dezenas guardadas',
  { dezenas: '["a",null,99,-3,1,2]' },
  async (pg) => {
    // Aqui nada estoura, e o defeito é pior por isso: `"a"`, `null`, `99` e
    // `−3` entram na conta do pool e não aparecem na grade. A tela dizia "6
    // dezenas" com duas marcadas, e pedia mais nove quando faltavam treze —
    // um pool imaginário, do tamanho errado, escolhendo o fechamento errado.
    const marcadas = await pg.locator('.grade [aria-pressed=true]').count();
    const contado = Number((await pg.locator('#contagem').innerText()).replace(/\D/g, '')) || 0;
    conferir('e a conta do pool é a das dezenas que a grade mostra',
      marcadas === 2 && contado === 2, `${contado} contadas, ${marcadas} marcadas`);
  });
await comMemoria('a carteira guardada com buracos',
  { carteira: '[{"jogos":"x","custo":null},null,3]' });
await comMemoria('a carteira guardada sem ser uma lista', { carteira: '"x"' });
await comMemoria('a tabela de preços guardada pela metade',
  { precos: '{"aposta":{"15":"grátis"},"premio":null}' },
  async (pg) => {
    // Um preço que não é dinheiro não pode virar `NaN` na tela: quando o
    // editado não presta, quem vale é o publicado.
    await pg.click('#det-dinheiro summary');
    const painel = (await pg.locator('#det-dinheiro').innerText()).replace(/\s+/g, ' ');
    conferir('e nenhum preço estragado chega à tela como NaN',
      !painel.includes('NaN'), painel.slice(0, 90));
  });
// Dinheiro que não é dinheiro chegava ao campo do jeito que estava guardado:
// "R$ NaN" e "−R$ 50,00" são as duas caras disso, e nenhuma das duas é um
// orçamento de onde se possa escolher fechamento.
for (const [nome, guardado] of [['sem ser um número', '"muito"'], ['negativo', '-5000']]) {
  await comMemoria(`o orçamento guardado ${nome}`, { orcamento: guardado }, async (pg) => {
    const campo = await pg.locator('#valor').inputValue();
    conferir(`e o campo de dinheiro mostra dinheiro, com o orçamento ${nome}`,
      /\d/.test(campo) && !campo.includes('NaN') && !/[-\u2212]/.test(campo), campo);
  });
}
// Um fechamento nomeado que o catálogo não tem — guardado por uma versão
// anterior, ou vindo de um link velho. Aqui não há erro nenhum a evitar: o
// defeito é a tela parar num beco. Sem `fixoValido` na porta, quem abre o
// aplicativo recebe "não há fechamento catalogado" por causa de um pedido que
// nem lembra de ter feito, em vez do fechamento que o dinheiro dele compra.
await comMemoria('um fechamento fixo que não existe mais',
  { fixo: '{"v":18,"k":15,"t":99}', dezenas: '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]' },
  async (pg) => {
    conferir('e a tela volta a responder pelo dinheiro, em vez de parar no beco',
      (await pg.locator('.resposta .numero').count()) === 1,
      (await pg.locator('#resposta').innerText()).replace(/\s+/g, ' ').slice(0, 70));
  });
await comMemoria('tudo guardado como JSON inválido',
  { dezenas: '{{{', orcamento: 'nan', carteira: '][' });

// ── e o último resultado guardado, que também vem de fora ───────────────────
//
// "Buscar o último concurso" tem uma rede pela frente e um `catch` atrás: sem
// resposta, ele usa o resultado da última vez. Só que esse resultado saiu do
// mesmo armazenamento, e um estragado fazia o `catch` — que existe justamente
// para nada estourar — estourar. O botão ficava em "Buscando…" para sempre, sem
// erro na tela e sem caminho de volta, no exato momento em que a pessoa está
// sem rede. Aqui não há servidor, então o caminho de rede sempre falha: é o
// caso que interessa.
for (const [nome, guardado, esperado] of [
  ['sem as dezenas', '{"concurso":3000}', 'Sem resultado'],
  ['com as dezenas sem ser lista', '{"dezenas":"x"}', 'Sem resultado'],
  ['sem ser um objeto', '"nada"', 'Sem resultado'],
  // Duas dezenas não são um sorteio, e dizer "Concurso 1" ao lado de um campo
  // pela metade é pior do que dizer que não há resultado.
  ['com um sorteio pela metade', '{"dezenas":[1,2],"concurso":1}', 'Sem resultado'],
]) {
  const caixa = await navegador.newContext({ viewport: { width: 360, height: 740 } });
  await caixa.addInitScript((v) => localStorage.setItem('ultimo-sorteio', v), guardado);
  const pg = await caixa.newPage();
  const ruins = [];
  pg.on('pageerror', (e) => ruins.push(String(e)));
  await pg.goto(endereco, { waitUntil: 'networkidle' });
  await pg.click('#escolher');
  await esperarFechamento(pg, 20000);
  await abrir(pg, 'conferir');
  await pg.click('#buscar-sorteio');
  await pg.waitForTimeout(5000);
  const rotulo = (await pg.locator('#buscar-sorteio').innerText()).trim();
  conferir(`com o resultado guardado ${nome}, o botão diz o que houve`,
    ruins.length === 0 && rotulo.startsWith(esperado),
    `${ruins.join(' | ')} · o botão diz "${rotulo}"`);
  await caixa.close();
}

// ── o que volta de outra sessão volta descrito por inteiro ─────────────────
//
// O fechamento nomeado sobrevive à sessão, e os controles têm de voltar dizendo
// **qual** é. Voltava só o tamanho da cartela: a garantia ficava em "tanto
// faz", que descreve um pedido mais largo do que o fechamento em uso — e mexer
// em qualquer outro controle resolvia esse pedido largo, trazendo de volta um
// fechamento que não era o guardado.
{
  const caixa = await navegador.newContext({ viewport: { width: 360, height: 740 } });
  await caixa.addInitScript(() => {
    localStorage.setItem('dezenas', JSON.stringify([...Array(20)].map((_, i) => i + 1)));
    localStorage.setItem('fixo', JSON.stringify({ v: 20, k: 15, t: 12, de: 'mao' }));
  });
  const pg = await caixa.newPage();
  await pg.goto(endereco, { waitUntil: 'networkidle' });
  await esperarFechamento(pg, 20000);
  await pg.click('#det-manual summary');
  await pg.waitForTimeout(300);
  conferir('o fechamento guardado volta descrito nos dois controles',
    (await pg.inputValue('#m-k')) === '15' && (await pg.inputValue('#m-t')) === '12'
    && (await pg.inputValue('#m-fechamento')) === '15-12',
    `k=${await pg.inputValue('#m-k')} t=${await pg.inputValue('#m-t')} ` +
    `fechamento=${await pg.inputValue('#m-fechamento')}`);
  conferir('e é ele que a tela mostra',
    /12 acertos garantidos/.test((await pg.locator('.resposta').innerText())
      .replace(/\s+/g, ' ')),
    (await pg.locator('.resposta').innerText()).replace(/\s+/g, ' ').slice(0, 90));
  await caixa.close();
}

await navegador.close();
servidor.close();

console.log(`${feitos} conferências`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas) console.error(`  ${f}`);
  process.exit(1);
}
console.log('tela: tudo confere');
