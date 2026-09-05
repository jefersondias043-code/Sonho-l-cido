// Os dois aplicativos no mesmo endereço, um dentro do outro.
//
// O motor vai ao ar na raiz e os fechamentos numa subpasta, e os dois têm
// service worker. O da raiz tem escopo `/<repo>/`, que **contém**
// `/<repo>/fechamentos/` — então é ele quem atende a primeira navegação para a
// subpasta, antes de o de lá existir. Se ele servisse a página errada, ou
// guardasse um arquivo do catálogo e o devolvesse velho para sempre, o defeito
// só apareceria depois de publicado, no aparelho de quem já usava o motor.
//
// O que se cobra aqui:
//
//   1. com o service worker da raiz já instalado e no comando, a subpasta abre
//      inteira e chega aos bilhetes;
//   2. o service worker **da subpasta** assume as páginas dela — escopo mais
//      específico ganha, e ganha já na primeira visita;
//   3. e a partir daí a subpasta funciona sem rede, sozinha;
//   4. sem que a raiz perca o service worker dela.
//
//     ./construir-app.sh && node ferramentas/testar-convivencia.mjs [/subpasta/]
//
// O aplicativo do motor entra aqui como uma página mínima que registra o
// `web/sw.js` de verdade: o que interessa é o `fetch` dele, não a tela.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

// A subpasta em que o GitHub Pages serve o repositório. Configurável porque o
// nome do repositório é o prefixo, e um teste que o fixa mente sobre onde o
// aplicativo vai parar.
const BASE = process.argv[2] ?? '/Sonho-l-cido/';
const APP = new URL('../publicar', import.meta.url).pathname;
const MOTOR_SW = new URL('../web/sw.js', import.meta.url).pathname;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

let feitos = 0;
const falhas = [];
const conferir = (nome, condicao, detalhe = '') => {
  feitos++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

// A raiz é o motor; `fechamentos/` é o aplicativo construído de verdade.
const PAGINA_DO_MOTOR = `<!doctype html><meta charset="utf-8"><title>Motor</title>
<h1>Motor</h1><script>navigator.serviceWorker.register('sw.js')</script>`;

const servidor = createServer(async (pedido, resposta) => {
  const caminho = decodeURIComponent(new URL(pedido.url, 'http://x').pathname);
  const responder = (corpo, tipo) => {
    resposta.writeHead(200, { 'content-type': tipo });
    resposta.end(corpo);
  };
  if (!caminho.startsWith(BASE)) return resposta.writeHead(404).end();

  const relativo = caminho.slice(BASE.length);
  if (relativo === '' || relativo === 'index.html') {
    return responder(PAGINA_DO_MOTOR, TIPOS['.html']);
  }
  if (relativo === 'sw.js') {
    return responder(await readFile(MOTOR_SW), TIPOS['.js']);
  }
  if (relativo.startsWith('fechamentos/')) {
    let arquivo = relativo.slice('fechamentos/'.length) || 'index.html';
    if (arquivo.endsWith('/')) arquivo += 'index.html';
    try {
      const corpo = await readFile(join(APP, normalize('/' + arquivo)));
      return responder(corpo, TIPOS[extname(arquivo)] ?? 'text/plain');
    } catch {
      return resposta.writeHead(404).end();
    }
  }
  resposta.writeHead(404).end();
});
await new Promise((pronto) => servidor.listen(0, pronto));

const raiz = `http://127.0.0.1:${servidor.address().port}${BASE}`;
const subpasta = `${raiz}fechamentos/`;

const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const contexto = await navegador.newContext({ viewport: { width: 380, height: 800 } });
const pagina = await contexto.newPage();
const erros = [];
pagina.on('pageerror', (e) => erros.push(String(e)));

const quemManda = () =>
  pagina.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);

// ── 1. o motor primeiro, e o service worker dele no comando ─────────────────

await pagina.goto(raiz, { waitUntil: 'networkidle' });
await pagina.evaluate(() => navigator.serviceWorker.ready);
await pagina.goto(raiz, { waitUntil: 'networkidle' });
conferir('o service worker do motor assume a raiz', (await quemManda())?.endsWith(`${BASE}sw.js`),
  String(await quemManda()));

// ── 2. a subpasta abre inteira sob o service worker do outro ────────────────

await pagina.goto(subpasta, { waitUntil: 'networkidle' });
await pagina.click('#escolher');
await pagina.waitForSelector('.bilhetes li', { timeout: 20000 });
const bilhetes = await pagina.locator('.bilhetes li').count();
conferir('e mesmo assim ela chega aos bilhetes', bilhetes > 0);

// ── 3. o escopo mais específico ganha, e ganha já na primeira visita ────────

// O service worker da subpasta pede o comando assim que instala (`skipWaiting`
// e `clients.claim`), então ele assume a própria página que o registrou — sem
// esperar uma segunda visita. O da raiz atendeu a navegação inicial e saiu.
conferir('o service worker da subpasta assume as páginas dela',
  (await quemManda())?.endsWith(`${BASE}fechamentos/sw.js`), String(await quemManda()));

await pagina.evaluate(() => navigator.serviceWorker.ready);
await pagina.goto(subpasta, { waitUntil: 'networkidle' });
conferir('e continua no comando na visita seguinte',
  (await quemManda())?.endsWith(`${BASE}fechamentos/sw.js`), String(await quemManda()));
await pagina.waitForSelector('.bilhetes li', { timeout: 20000 });

// ── 4. e a subpasta funciona sem rede ───────────────────────────────────────

await contexto.setOffline(true);
await pagina.goto(subpasta, { waitUntil: 'domcontentloaded' });
await pagina.waitForSelector('.bilhetes li', { timeout: 20000 });
conferir('a subpasta funciona sem rede', (await pagina.locator('.bilhetes li').count()) > 0);
await contexto.setOffline(false);

// ── 5. sem que a raiz perca o dela ──────────────────────────────────────────

await pagina.goto(raiz, { waitUntil: 'networkidle' });
conferir('a raiz continua com o service worker do motor',
  (await quemManda())?.endsWith(`${BASE}sw.js`), String(await quemManda()));

conferir('nenhum erro de JavaScript', erros.length === 0, erros.join(' | '));

await navegador.close();
servidor.close();

console.log(`${feitos} conferências`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas) console.error(`  ${f}`);
  process.exit(1);
}
console.log('convivência: tudo confere');
