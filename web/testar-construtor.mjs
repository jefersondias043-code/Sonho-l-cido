/*
 * Teste do Construtor, num navegador de verdade.
 *
 * O aplicativo faz uma promessa incomum, e é ela que precisa ficar provada: não
 * "achei uma solução", mas **"esta é a menor que existe"** — ou, quando não é,
 * o quanto ainda pode cair. As duas afirmações são caras de errar: a primeira
 * mente sobre matemática, a segunda manda alguém deixar o aparelho trabalhando
 * atrás do que não há.
 *
 * O que precisa ficar provado:
 *
 *   1. A plataforma leva aos dois aplicativos, e a Lotinha continua inteira.
 *   2. O limite inferior aparece **antes** de qualquer busca — é a metade do
 *      problema que sai de graça, e é ela que informa a decisão de começar.
 *   3. Parâmetros que não descrevem um problema são recusados com o motivo.
 *   4. A construção nasce das regras e diz de onde veio.
 *   5. A escada desce, e num caso de mínimo conhecido ela **para e prova**.
 *   6. Num caso em aberto ela não finge: continua descendo e nunca diz provado.
 *
 *   ./construir-web.sh && node web/testar-construtor.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8141;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function servir() {
  const servidor = createServer(async (req, res) => {
    let caminho = decodeURIComponent(req.url.split('?')[0]);
    if (caminho.endsWith('/')) caminho += 'index.html';
    try {
      const arquivo = join(RAIZ, normalize(caminho).replace(/^(\.\.[/\\])+/, ''));
      const conteudo = await readFile(arquivo);
      res.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' });
      res.end(conteudo);
    } catch {
      res.writeHead(404).end('não encontrado');
    }
  });
  return new Promise((ok) => servidor.listen(PORTA, () => ok(servidor)));
}

const passos = [];
function marcar(certo, descricao, detalhe = '') {
  passos.push({ certo, descricao });
  console.log(`${certo ? '  ✓' : '  ✗'} ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
}

const servidor = await servir();
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ ...devices['iPhone 13'] });
const pagina = await contexto.newPage();

const errosDeConsole = [];
pagina.on('console', (m) => m.type() === 'error' && errosDeConsole.push(m.text()));
pagina.on('pageerror', (e) => errosDeConsole.push(String(e)));

const texto = (sel) => pagina.textContent(sel).then((t) => (t ?? '').replace(/\s+/g, ' ').trim());
const numero = async (sel) => Number((await texto(sel)).replace(/\D/g, ''));

/** Preenche os quatro campos e espera a medida chegar. */
async function descrever(universo, cartela, alvo, intersecao) {
  for (const [id, valor] of [
    ['cs-universo', universo],
    ['cs-cartela', cartela],
    ['cs-alvo', alvo],
    ['cs-intersecao', intersecao],
  ]) {
    await pagina.fill(`#${id}`, String(valor));
  }
  await pagina.waitForFunction(
    (esperado) => document.getElementById('cs-medida').textContent.includes(esperado),
    'sorteios possíveis',
    { timeout: 20000 }
  );
}

console.log('Teste do Construtor\n');

try {
  // ─── 1. a plataforma ───
  await pagina.goto(`http://localhost:${PORTA}/`, { waitUntil: 'networkidle' });
  const aplicativos = await pagina.$$eval('.aplicativo h2', (h) => h.map((x) => x.textContent.trim()));
  marcar(
    aplicativos.join(' · ') === 'Lotinha · Construtor · Construtor Exato',
    'a página inicial oferece os três aplicativos',
    aplicativos.join(' · ')
  );

  await pagina.click('.aplicativo[href="./lotinha.html"]');
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 20000 });
  marcar(true, 'e a Lotinha abre inteira a partir dela');

  await pagina.goBack();
  await pagina.click('.aplicativo[href="./construtor.html"]');
  await pagina.waitForSelector('#cs-construir', { timeout: 20000 });
  marcar(true, 'e o Construtor também');

  // ─── 2. o que se sabe antes de procurar ───
  //
  // C(13,5,2): Schönheim dá 8, mas o limite publicado prova 10 — e 10 é o
  // mínimo. É o caso que separa "o que uma fórmula geral alcança" de "o que
  // está provado", e o aplicativo tem de mostrar o segundo.
  await descrever(13, 5, 2, 2);
  const medida = await texto('#cs-medida');
  marcar(
    /78 sorteios/.test(medida) && /menos de 10 cartelas/.test(medida),
    'o limite inferior aparece antes de qualquer busca, com 78 alvos e piso 10',
    medida.slice(0, 90)
  );
  marcar(
    /teorema/.test(medida) && /literatura|Schönheim|contagem|Turán/.test(medida),
    'e a tela diz de onde ele vem, em vez de pedir fé',
    medida.slice(medida.indexOf('—') + 1, medida.indexOf('—') + 60)
  );

  // ─── 3. o que não é problema é recusado, com o motivo ───
  await pagina.fill('#cs-cartela', '20');
  await pagina.waitForSelector('#cs-erro:not([hidden])', { timeout: 10000 });
  const erro = await texto('#cs-erro');
  marcar(
    /não cabe/.test(erro) && /20/.test(erro) && /13/.test(erro),
    'uma cartela maior que o universo é recusada dizendo por quê',
    erro.slice(0, 80)
  );
  marcar(
    await pagina.locator('#cs-construir').isDisabled(),
    'e o botão de construir fica fora do alcance enquanto isso'
  );

  await pagina.fill('#cs-intersecao', '5');
  await pagina.fill('#cs-cartela', '5');
  await pagina.waitForSelector('#cs-erro:not([hidden])', { timeout: 10000 });
  marcar(
    /garantia pede 5 acertos/.test(await texto('#cs-erro')),
    'e uma garantia maior que o sorteio também',
    (await texto('#cs-erro')).slice(0, 70)
  );

  // ─── 4. a construção ───
  await descrever(13, 5, 2, 2);
  await pagina.click('#cs-construir');
  await pagina.waitForSelector('#cs-escada-cartao:not([hidden])', { timeout: 60000 });
  const construcao = await texto('#cs-construcao');
  const construidas = Number(construcao.match(/^([\d.]+) cartelas/)?.[1]?.replace(/\D/g, ''));
  marcar(
    construidas >= 10 && /Veio de:/.test(construcao),
    'a construção sai das regras e diz qual estágio a produziu',
    construcao.slice(0, 80)
  );

  // ─── 5. a escada desce, e prova ───
  const partida = await numero('#cs-melhor');
  marcar(
    (await numero('#cs-limite')) === 10 && (await numero('#cs-degrau')) === partida - 1,
    'a escada nasce apontando um degrau abaixo do que se conseguiu',
    `melhor ${partida} · degrau ${await numero('#cs-degrau')} · piso 10`
  );

  await pagina.click('#cs-descer');
  await pagina.waitForSelector('.veredito-provado', { timeout: 120000 });
  marcar(
    (await numero('#cs-melhor')) === 10,
    'e desce até as 10 cartelas que o limite publicado garante serem o mínimo',
    `${partida} → 10`
  );
  marcar(
    /Mínimo provado/.test(await texto('#cs-veredito')) &&
      /não é que não achamos/.test(await texto('#cs-veredito')),
    'a tela diz que está provado, e explica que provado não é o mesmo que não achado'
  );
  marcar(
    await pagina.locator('#cs-descer').isDisabled(),
    'e para de oferecer descer — abaixo do mínimo não há o que procurar'
  );
  marcar(
    (await pagina.locator('#cs-cartelas .cartela').count()) === 10,
    'as dez cartelas ficam na tela, prontas para copiar',
    `${await pagina.locator('#cs-cartelas .cartela').count()} cartelas`
  );

  // ─── 6. num caso em aberto ela não finge ───
  //
  // C(16,6,3): o piso é bem abaixo do que se conhece, e a escada tem de
  // continuar descendo sem nunca declarar prova.
  await descrever(16, 6, 3, 3);
  await pagina.click('#cs-construir');
  await pagina.waitForFunction(
    () => !document.getElementById('cs-escada-cartao').hidden &&
      document.getElementById('cs-melhor').textContent.trim() !== '—',
    undefined,
    { timeout: 90000 }
  );
  const emAberto = await numero('#cs-melhor');
  const pisoAberto = await numero('#cs-limite');
  marcar(
    emAberto > pisoAberto && (await pagina.locator('.veredito-provado').count()) === 0,
    'num caso em aberto a escada mostra a folga e não declara prova nenhuma',
    `${emAberto} contra piso ${pisoAberto}`
  );
  marcar(
    /Faltam no máximo/.test(await texto('#cs-veredito')),
    'e diz "no máximo", porque o piso é um piso e não uma promessa',
    (await texto('#cs-veredito')).slice(0, 70)
  );

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 120));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
