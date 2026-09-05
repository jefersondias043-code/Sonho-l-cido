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

// ── a varredura exaustiva ───────────────────────────────────────────────────

await pagina.click('#det-conferir summary');
await pagina.click('#varrer');
await pagina.waitForFunction(
  () => /garantia de \d+ está de pé|não se sustentou/.test(document.querySelector('#varredura').innerText),
  null, { timeout: 60000 });
const varredura = await pagina.locator('#varredura').innerText();
conferir('a varredura confirma a garantia', varredura.includes('está de pé'), varredura);
conferir('e diz quantos resultados percorreu', /\d[\d.]* resultados possíveis/.test(varredura));

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

// E um pedido que ninguém entende diz isso, em vez de mexer no estado.
await pagina.fill('#intencao', 'bom dia');
await pagina.click('#enviar-intencao');
await pagina.waitForFunction(
  () => document.getElementById('aviso-intencao').innerText.includes('Não consegui'), null,
  { timeout: 15000 });
conferir('um pedido ilegível não vira estado',
  (await pagina.inputValue('#valor')).includes('300,00'));

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
