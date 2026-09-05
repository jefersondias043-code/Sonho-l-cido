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

const BASE = process.argv[2] ?? '/';
const RAIZ = new URL('../publicar', import.meta.url).pathname;
const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

let feitos = 0;
const falhas = [];
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
await pagina.waitForSelector('.bilhetes li');
const quantos = await pagina.locator('.bilhetes li').count();
conferir('um toque põe bilhetes na tela', quantos > 0);
conferir('a resposta traz o número grande', /^\d+$/.test(await pagina.locator('.numero').innerText()));
conferir('e diz o que o número é',
  (await pagina.locator('.unidade').innerText()).includes('acertos garantidos'));

const selo = await pagina.locator('.selo').first().innerText();
conferir('o selo é um dos dois estados', ['mínimo provado', 'menor conhecido'].includes(selo), selo);
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
  await tela.waitForSelector('.bilhetes li', { timeout: 20000 });
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
await pagina.waitForSelector('.bilhetes li', { timeout: 30000 });
await pagina.waitForTimeout(500);
const listaGrande = await pagina.evaluate(() => ({
  desenhados: document.querySelectorAll('.bilhetes li').length,
  altura: document.documentElement.scrollHeight,
  nos: document.querySelectorAll('*').length,
  aviso: document.querySelector('#secao-bilhetes .ajuda')?.innerText ?? '',
}));
conferir('a lista não desenha milhares de bilhetes',
  listaGrande.desenhados > 0 && listaGrande.desenhados <= 50, `${listaGrande.desenhados}`);
conferir('e a página não vira quatrocentas telas',
  listaGrande.altura < 20000, `${listaGrande.altura} px`);
conferir('e o DOM continua do tamanho de uma página',
  listaGrande.nos < 3000, `${listaGrande.nos} nós`);
conferir('e a tela diz quantos existem de verdade',
  /4\.\d\d\d bilhetes/.test(listaGrande.aviso.replace(/\s+/g, ' ')), listaGrande.aviso);

// E a conferência exaustiva continua vendo o fechamento inteiro — o que a tela
// desenha é a lista, não o que ela guarda.
await pagina.evaluate(() => { document.getElementById('det-conferir').open = true; });
await pagina.click('#varrer');
await pagina.waitForFunction(
  () => document.getElementById('varredura').innerText.includes('Varridos'), null,
  { timeout: 120000 });
conferir('e a varredura ainda cobre o fechamento inteiro',
  (await pagina.locator('#varredura').innerText()).includes('está de pé'),
  await pagina.locator('#varredura').innerText());

// De volta a um fechamento que cabe inteiro na lista, para o que vem abaixo
// poder contar `<li>` e saber que está contando bilhetes, e não o limite do
// desenho.
await pagina.fill('#valor', 'R$ 65,00');
await pagina.dispatchEvent('#valor', 'change');
await pagina.click('#escolher');
await pagina.waitForSelector('.bilhetes li', { timeout: 20000 });
await pagina.waitForTimeout(500);
const cabeInteiro = await pagina.locator('.bilhetes li').count();
conferir('um fechamento pequeno é desenhado inteiro', cabeInteiro > 0 && cabeInteiro < 50,
  `${cabeInteiro}`);
conferir('e sem aviso de lista cortada',
  (await pagina.locator('#secao-bilhetes .ajuda').count()) === 0);

// ── bolão ───────────────────────────────────────────────────────────────────

await pagina.click('#det-bolao summary');
const noFechamento = await pagina.locator('.bilhetes li').count();
await pagina.fill('#partes', '3');
await pagina.dispatchEvent('#partes', 'input');
conferir('o bolão sai em três partes', (await pagina.locator('.partes li').count()) === 3);
const linkDaParte = await pagina.locator('.partes button').first().getAttribute('data-link');
conferir('e cada parte tem endereço próprio', /#d=[\d.]+&f=\d+-\d+-\d+&p=0\.3/.test(linkDaParte),
  linkDaParte);

const outra = await contexto.newPage();
await outra.goto(linkDaParte, { waitUntil: 'networkidle' });
await outra.waitForSelector('.bilhetes li');
const naParte = await outra.locator('.bilhetes li').count();
conferir('quem abre o link recebe só a sua parte', naParte > 0 && naParte < noFechamento,
  `${naParte} de ${noFechamento}`);
await outra.close();

// ── conferir contra o sorteio ───────────────────────────────────────────────

await pagina.click('#det-resultado summary');
await pagina.fill('#sorteio', '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15');
await pagina.dispatchEvent('#sorteio', 'change');
const conferencia = await pagina.locator('#conferencia').innerText();
conferir('a conferência diz o melhor bilhete', /Melhor bilhete: \d+ acertos/.test(conferencia),
  conferencia);
conferir('e fecha a conta do dinheiro', /Custou R\$/.test(conferencia));

// ── carteira ────────────────────────────────────────────────────────────────

await pagina.click('[data-acao=guardar]');
conferir('guardar põe o jogo na carteira', (await pagina.locator('.registros li').count()) === 1);
conferir('e o registro fecha a conta do sorteio que acabou de ser conferido',
  /voltou R\$/.test(await pagina.locator('.registros li').innerText()) === false);

// Conferir de novo, agora com o jogo já guardado: a carteira passa a dizer
// quanto voltou. É o que separa "o que eu joguei" de "o que eu ganhei".
await pagina.dispatchEvent('#sorteio', 'change');
conferir('a carteira registra o retorno',
  /voltou R\$/.test(await pagina.locator('.registros li').innerText()),
  await pagina.locator('.registros li').innerText());

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
await pagina.waitForSelector('.bilhetes li');
conferir('o service worker assume a página',
  await pagina.evaluate(() => navigator.serviceWorker.controller !== null));

await contexto.setOffline(true);
await pagina.goto(endereco, { waitUntil: 'domcontentloaded' });
await pagina.waitForSelector('.bilhetes li', { timeout: 20000 });
conferir('a segunda visita reabre sem rede o que já estava aberto',
  (await pagina.locator('.bilhetes li').count()) > 0);

// E um fechamento que nunca foi aberto: sem rede ele não chega, e a tela não
// pode ser apagada por isso.
await pagina.click('#escolher');
await pagina.waitForTimeout(1500);
conferir('e uma falha de rede não apaga a resposta',
  /^\d+$/.test(await pagina.locator('.numero').innerText()));
await contexto.setOffline(false);

conferir('nenhum erro de JavaScript no caminho todo', erros.length === 0, erros.join(' | '));

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
await semMemoria.waitForSelector('.bilhetes li', { timeout: 20000 });
conferir('sem poder guardar nada, o aplicativo ainda responde',
  (await semMemoria.locator('.bilhetes li').count()) > 0);
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
await semMemoria.waitForSelector('.bilhetes li', { timeout: 20000 });
const manchete = await semMemoria.locator('.resposta').innerText();
conferir('com um bilhete a manchete é o bilhete', /bilhete de \d+ dezenas/.test(manchete), manchete);
conferir('e não promete acertos garantidos', !/acertos garantidos/.test(manchete), manchete);
conferir('e diz que um bilhete não é fechamento', manchete.includes('não é fechamento'), manchete);
// E não fala d*a* garantia logo depois de dizer que não há garantia nenhuma: a
// ressalva sobre o sorteio cair dentro do pool é sobre uma promessa que esta
// resposta não faz.
conferir('e não fala de uma garantia que acabou de negar',
  !manchete.includes('A garantia só vale'), manchete);
conferir('e a tela entrega esse um bilhete',
  (await semMemoria.locator('.bilhetes li').count()) === 1);
conferir('e o degrau ensina onde o fechamento começa, sem partir de garantia nenhuma',
  /bilhetes que se completam/.test(await semMemoria.locator('#degrau').innerText()),
  await semMemoria.locator('#degrau').innerText());

await trancado.close();

await navegador.close();
servidor.close();

console.log(`${feitos} conferências`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas) console.error(`  ${f}`);
  process.exit(1);
}
console.log('tela: tudo confere');
