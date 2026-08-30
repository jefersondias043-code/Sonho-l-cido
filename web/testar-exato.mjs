/*
 * Teste do Construtor Matemático Exato, num navegador de verdade.
 *
 * Este aplicativo já foi publicado uma vez com três defeitos que nenhum teste
 * pegava, e os três estão cobrados aqui:
 *
 *   1. Faltavam parâmetros. Ele só sabia `C(v,k,t)` — sorteio colado na
 *      garantia, e nada de cartelas premiadas. "Saem 15, garanto 13", que é o
 *      uso mais comum, não tinha como ser pedido.
 *   2. Nos tamanhos reais ele não voltava. A construção varria todas as
 *      cartelas a cada passo, e num pool de 20 isso não termina.
 *   3. A tela ficava muda. Sem progresso e sem botão de parar, uma espera longa
 *      é indistinguível de um travamento.
 *
 * E o que já valia continua valendo: **nunca chamar de mínimo o que ele apenas
 * encontrou**.
 *
 *   ./construir-web.sh && node web/testar-exato.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8143;

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

/** Define o universo e marca exatamente estes números na grade. */
async function marcarNumeros(universo, numeros) {
  await pagina.fill('#ex-universo', String(universo));
  await pagina.click('#ex-limpar');
  for (const n of numeros) await pagina.click(`#ex-grade .numero[data-n="${n}"]`);
}

/** Escolhe um valor numa das fileiras de opção. */
async function escolher(fileira, valor) {
  await pagina.click(`#${fileira} .opcao[data-valor="${valor}"]`);
}

/** Preenche as quatro regras, na ordem em que uma restringe a outra. */
async function regras(jogo, sorteio, garantia, premiadas = 1) {
  await escolher('ex-jogo', jogo);
  await escolher('ex-sorteio', sorteio);
  await escolher('ex-garantia', garantia);
  if (premiadas > 1) await escolher('ex-premiadas', premiadas);
}

async function esperarResultado(limite = 180000) {
  await pagina.waitForFunction(
    () =>
      !document.getElementById('ex-resultado-cartao').hidden &&
      document.getElementById('ex-frase').textContent.trim() !== '',
    undefined,
    { timeout: limite }
  );
}

console.log('Teste do Construtor Exato\n');

try {
  // ─── 1. a plataforma ───
  await pagina.goto(`http://localhost:${PORTA}/`, { waitUntil: 'networkidle' });
  const aplicativos = await pagina.$$eval('.aplicativo h2', (h) =>
    h.map((x) => x.textContent.trim())
  );
  marcar(
    aplicativos.join(' · ') === 'Lotinha · Construtor · Construtor Exato',
    'a página inicial oferece os três aplicativos',
    aplicativos.join(' · ')
  );

  await pagina.click('.aplicativo[href="./exato.html"]');
  // Esperar pelo botão não basta: ele vem no HTML, e a grade e as fileiras são
  // montadas pelo módulo depois. Esperar por um número na grade é esperar pelo
  // aplicativo de fato pronto.
  await pagina.waitForSelector('#ex-grade .numero', { timeout: 20000 });
  marcar(true, 'e o Construtor Exato abre a partir dela');

  // ─── 2. os cinco parâmetros existem ───
  const fileiras = ['ex-jogo', 'ex-sorteio', 'ex-garantia', 'ex-premiadas'];
  const presentes = [];
  for (const f of fileiras) {
    presentes.push((await pagina.locator(`#${f} .opcao`).count()) > 0);
  }
  marcar(
    presentes.every(Boolean) && (await pagina.locator('#ex-grade .numero').count()) === 25,
    'a tela tem a grade e as quatro fileiras de regra',
    `grade com ${await pagina.locator('#ex-grade .numero').count()} números`
  );

  // A garantia nunca pode passar do sorteio nem do jogo: a tela precisa impedir
  // em vez de deixar o motor recusar depois.
  await marcarNumeros(25, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await regras(4, 3, 3);
  const maiorGarantia = await pagina.$$eval('#ex-garantia .opcao', (b) =>
    Math.max(...b.map((x) => Number(x.dataset.valor)))
  );
  marcar(
    maiorGarantia === 3,
    'a garantia não oferece mais do que o sorteio permite',
    `vai até ${maiorGarantia}`
  );

  // ─── 3. o caso pequeno, onde a prova fecha ───
  //
  // Nove números, cartelas de 3, saem 2 e garante 2: é C(9,3,2), o sistema de
  // Steiner de ordem 9, com mínimo 12.
  await marcarNumeros(25, [3, 5, 7, 9, 11, 13, 15, 17, 19]);
  await regras(3, 2, 2);
  await pagina.selectOption('#ex-esforco', '1');
  await pagina.click('#ex-resolver');

  await pagina.waitForFunction(
    () => document.getElementById('ex-alvos').textContent.trim() === '36',
    undefined,
    { timeout: 30000 }
  );
  marcar(true, 'a análise conta os sorteios antes de qualquer busca', '36 sorteios');

  await esperarResultado();
  const frase = await texto('#ex-frase');
  marcar(
    /Mínimo exato: 12 cartelas/.test(frase),
    'em C(9,3,2) a tela diz mínimo exato, com todas as letras',
    frase.slice(0, 70)
  );

  // As cartelas precisam sair com os números marcados, e não com posições.
  const primeira = await texto('#ex-cartelas .cartela:first-child');
  const usados = (await pagina.$$eval('#ex-cartelas .cartela span:last-child', (s) =>
    s.flatMap((x) => x.textContent.trim().split(/\s+/).map(Number))
  )).sort((a, b) => a - b);
  const distintos = [...new Set(usados)];
  marcar(
    distintos.every((n) => [3, 5, 7, 9, 11, 13, 15, 17, 19].includes(n)),
    'as cartelas saem com os números que foram marcados na grade',
    `primeira: ${primeira}`
  );

  // ─── 4. sorteio separado da garantia ───
  //
  // Pool de 20, jogos de 17, saem 15 e garante 13. É o pedido que o modelo
  // antigo não sabia sequer receber.
  await marcarNumeros(25, Array.from({ length: 20 }, (_, i) => i + 1));
  await regras(17, 15, 13);
  await pagina.selectOption('#ex-esforco', '1');
  await pagina.click('#ex-resolver');

  await pagina.waitForFunction(
    () => document.getElementById('ex-por-bloco').textContent.trim() === '9.316',
    undefined,
    { timeout: 30000 }
  );
  marcar(true, 'aceita sorteio diferente da garantia e conta certo', '9.316 sorteios por cartela');

  await pagina.waitForFunction(
    () => !document.getElementById('ex-piso-cartao').hidden,
    undefined,
    { timeout: 30000 }
  );
  const piso = await texto('#ex-piso');
  marcar(
    /cota de contagem/.test(piso) && /só a cota de contagem vale/.test(piso),
    'e avisa que fora do covering design só a contagem vale',
    piso.slice(-90)
  );

  // ─── 5. o progresso anda ───
  //
  // É o teste que pega a tela muda: o texto da construção precisa **mudar**
  // enquanto ela trabalha, e o botão de parar precisa estar à mão.
  const leituras = new Set();
  for (let i = 0; i < 40; i += 1) {
    const agora = await texto('#ex-construcao');
    if (agora) leituras.add(agora);
    if (leituras.size >= 2) break;
    await pagina.waitForTimeout(120);
  }
  marcar(
    leituras.size >= 2,
    'a construção mostra progresso que muda enquanto ela trabalha',
    `${leituras.size} leituras distintas`
  );
  marcar(
    !(await pagina.locator('#ex-parar').isHidden()),
    'e o botão de parar está à mão enquanto ela roda'
  );

  await esperarResultado();
  const parcial = await texto('#ex-frase');
  const achou = await numero('#ex-encontrado');
  const provado = await numero('#ex-provado');
  marcar(
    achou > 0 && achou >= provado,
    'a configuração de tamanho real termina, sem travar',
    `${achou} cartelas contra piso ${provado}`
  );
  marcar(
    !/Mínimo exato/.test(parcial) || achou === provado,
    'e não chama de mínimo o que só foi encontrado',
    parcial.slice(0, 80)
  );
  marcar(
    /Confere\./.test(await texto('#ex-verificacao')),
    'o verificador confere a coleção que está na tela',
    (await texto('#ex-verificacao')).slice(0, 70)
  );

  // ─── 6. cartelas premiadas ───
  await marcarNumeros(25, Array.from({ length: 9 }, (_, i) => i + 1));
  await regras(3, 2, 2, 2);
  await pagina.selectOption('#ex-esforco', '1');
  await pagina.click('#ex-resolver');
  await esperarResultado();
  const comDuas = await numero('#ex-encontrado');
  marcar(
    comDuas > 12,
    'pedir duas cartelas premiadas custa mais do que pedir uma',
    `${comDuas} contra as 12 de uma só`
  );
  marcar(
    /2 cartelas cada/.test(await texto('#ex-verificacao')),
    'e o verificador cobra as duas cópias',
    (await texto('#ex-verificacao')).slice(0, 80)
  );

  // ─── 7. o botão de parar interrompe de verdade ───
  await marcarNumeros(25, Array.from({ length: 22 }, (_, i) => i + 1));
  await regras(17, 15, 15);
  await pagina.selectOption('#ex-esforco', '20');
  await pagina.click('#ex-resolver');
  await pagina.waitForFunction(
    () => !document.getElementById('ex-construcao-cartao').hidden,
    undefined,
    { timeout: 60000 }
  );
  await pagina.waitForTimeout(600);
  await pagina.click('#ex-parar');
  await esperarResultado(120000);
  marcar(true, 'o botão de parar interrompe e a tela chega ao resultado assim mesmo');
  marcar(
    await pagina.locator('#ex-parar').isHidden(),
    'e o botão some quando não há mais o que parar'
  );

  // ─── 8. o que não é problema é recusado com o motivo ───
  await marcarNumeros(25, Array.from({ length: 25 }, (_, i) => i + 1));
  await regras(12, 15, 11);
  await pagina.click('#ex-resolver');
  await pagina.waitForFunction(
    () => !document.getElementById('ex-erro').hidden,
    undefined,
    { timeout: 60000 }
  );
  marcar(
    /teto/.test(await texto('#ex-erro')),
    'um problema grande demais é recusado com o número, e não com um travamento',
    (await texto('#ex-erro')).slice(0, 110)
  );

  marcar(
    errosDeConsole.length === 0,
    'nenhum erro no console',
    errosDeConsole.join(' | ').slice(0, 160)
  );
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
