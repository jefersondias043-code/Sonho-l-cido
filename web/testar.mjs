/*
 * Teste de ponta a ponta da interface, num navegador de verdade.
 *
 * Os testes em Rust provam que a matemática está certa. Este prova que ela
 * chega até a tela: que o WebAssembly carrega, que o worker responde, que o
 * botão faz o que promete e que as cartelas exibidas realmente cobrem o que
 * dizem cobrir.
 *
 * A verificação final é feita aqui em JavaScript, lendo o que está na tela —
 * sem tocar em nada do Rust. Se a conta fosse refeita pelo mesmo código que a
 * produziu, o teste não provaria nada.
 *
 *   ./construir-web.sh && node web/testar.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8123;

// As capturas ficam fora de `site/`: aquilo é o que vai ao ar, e captura de
// tela de teste não tem por que ser publicada.
const CAPTURAS = new URL('../capturas/', import.meta.url).pathname;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function servir() {
  const servidor = createServer(async (req, res) => {
    try {
      let caminho = decodeURIComponent(req.url.split('?')[0]);
      if (caminho.endsWith('/')) caminho += 'index.html';
      const arquivo = join(RAIZ, normalize(caminho).replace(/^(\.\.[/\\])+/, ''));
      const conteudo = await readFile(arquivo);
      res.writeHead(200, {
        'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream',
      });
      res.end(conteudo);
    } catch {
      res.writeHead(404).end('não encontrado');
    }
  });
  return new Promise((ok) => servidor.listen(PORTA, () => ok(servidor)));
}

/** Confere, de forma independente, que o fechamento cobre todos os pares. */
function conferirCobertura(cartelas, pool) {
  const faltando = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      if (!cartelas.some((c) => c.includes(a) && c.includes(b))) {
        faltando.push([a, b]);
      }
    }
  }
  return faltando;
}

const passos = [];
function marcar(certo, descricao, detalhe = '') {
  passos.push({ certo, descricao, detalhe });
  const simbolo = certo ? '  ✓' : '  ✗';
  console.log(`${simbolo} ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
}

await mkdir(CAPTURAS, { recursive: true });
const servidor = await servir();
const navegador = await chromium.launch();
// Um iPhone de verdade: viewport, toque e agente de usuário do Safari móvel.
const contexto = await navegador.newContext({ ...devices['iPhone 13'] });
const pagina = await contexto.newPage();

const errosDeConsole = [];
pagina.on('console', (m) => {
  if (m.type() === 'error') errosDeConsole.push(m.text());
});
pagina.on('pageerror', (e) => errosDeConsole.push(String(e)));

console.log('Teste de ponta a ponta — interface no iPhone\n');

try {
  await pagina.goto(`http://localhost:${PORTA}/`, { waitUntil: 'networkidle' });

  marcar(await pagina.locator('h1').isVisible(), 'a página carrega');

  // ─── configuração ───
  // C(16,4,2) = 20, que o motor sabe provar. Assim o teste tem um alvo exato.
  await pagina.fill('#universo', '16');
  await pagina.fill('#pool', '16');
  await pagina.fill('#cartela', '4');
  await pagina.fill('#cobrir', '2');

  const previsao = await pagina.locator('#texto-previsao').textContent();
  marcar(
    previsao.includes('120'),
    'a previsão calcula o tamanho do problema',
    previsao.trim().slice(0, 60)
  );

  await pagina.screenshot({ path: 'capturas/captura-configurar.png' });

  // ─── busca ───
  await pagina.click('#iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });
  marcar(true, 'iniciar leva para a tela de busca');

  // O motor precisa chegar ao ótimo provado; C(16,4,2) leva alguns segundos.
  await pagina.waitForSelector('#selo-otimo:not([hidden])', { timeout: 90000 });

  const melhor = await pagina.locator('#melhor-cartelas').textContent();
  const limite = await pagina.locator('#limite-inferior').textContent();
  const iteracoes = await pagina.locator('#iteracoes').textContent();
  const velocidade = await pagina.locator('#velocidade').textContent();

  marcar(melhor.trim() === '20', 'chega ao ótimo conhecido de C(16,4,2)', `${melhor} cartelas`);
  marcar(limite.trim() === '20', 'o limite inferior confere', `≥ ${limite}`);
  marcar(true, 'velocidade no navegador', `${velocidade} iterações por segundo`);
  marcar(true, 'iterações executadas', iteracoes);

  const quantosRecordes = await pagina.locator('#lista-recordes li').count();
  marcar(quantosRecordes > 1, 'a lista de recordes acompanha a evolução', `${quantosRecordes} recordes`);

  await pagina.screenshot({ path: 'capturas/captura-buscar.png' });

  // ─── resultado ───
  await pagina.click('.aba[data-painel="resultado"]');
  await pagina.waitForSelector('#resultado.ativo');

  const cartelas = await pagina.$$eval('#lista-cartelas .cartela span:last-child', (nos) =>
    nos.map((n) => n.textContent.trim().split(/\s+/).map(Number))
  );

  marcar(cartelas.length === 20, 'as 20 cartelas aparecem na tela', `${cartelas.length} exibidas`);
  marcar(
    cartelas.every((c) => c.length === 4),
    'toda cartela tem os 4 números pedidos'
  );

  const pool = Array.from({ length: 16 }, (_, i) => i + 1);
  const faltando = conferirCobertura(cartelas, pool);
  marcar(
    faltando.length === 0,
    'verificação independente: todos os 120 pares cobertos',
    faltando.length ? `faltaram ${faltando.length}` : '120 de 120'
  );

  const redundancia = await pagina.locator('#res-redundancia').textContent();
  marcar(
    redundancia.trim() === '0',
    'redundância zero: é um sistema de Steiner exato',
    `redundância ${redundancia}`
  );

  await pagina.screenshot({ path: 'capturas/captura-resultado.png' });

  // ─── persistência ───
  const salvo = await pagina.evaluate(() => localStorage.getItem('sonho-lucido:busca'));
  marcar(!!salvo, 'a busca fica salva no aparelho');

  await pagina.reload({ waitUntil: 'networkidle' });
  const temRetomar = await pagina.locator('#retomar').isVisible();
  marcar(temRetomar, 'ao reabrir, o app oferece retomar de onde parou');

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 120));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
