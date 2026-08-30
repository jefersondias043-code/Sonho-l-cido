/*
 * Teste do Construtor Matemático Exato, num navegador de verdade.
 *
 * Este aplicativo faz uma promessa que é fácil de quebrar sem ninguém notar:
 * **nunca chamar de mínimo o que ele apenas encontrou**. Um número na tela não
 * diz de onde veio; e a diferença entre "achei 32" e "32 é o mínimo" é a
 * diferença entre uma solução e um teorema.
 *
 * O que precisa ficar provado:
 *
 *   1. A plataforma leva aos três aplicativos, e cada um abre.
 *   2. A análise sai **antes** de qualquer busca — é contagem, não procura.
 *   3. Parâmetros que não descrevem um problema são recusados com o motivo.
 *   4. As cartelas construídas passam pelo verificador, e ele confere de fato.
 *   5. Onde a prova fecha, a tela diz "mínimo exato" e some com o botão de
 *      insistir — não há mais o que procurar.
 *   6. Onde a prova não fecha, a tela mostra os **dois** números separados,
 *      nunca escreve "mínimo exato", e oferece insistir.
 *   7. A exaustão sobe o piso acima da cota fechada, e a origem diz isso.
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

/** Preenche os três números e o esforço, e manda resolver. */
async function resolver(v, k, t, esforco = '20000000') {
  await pagina.fill('#ex-universo', String(v));
  await pagina.fill('#ex-cartela', String(k));
  await pagina.fill('#ex-alvo', String(t));
  await pagina.selectOption('#ex-esforco', esforco);
  await pagina.click('#ex-resolver');
}

/** Espera o resultado final aparecer com a frase preenchida. */
async function esperarResultado(limite = 120000) {
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
  await pagina.waitForSelector('#ex-resolver', { timeout: 20000 });
  marcar(true, 'e o Construtor Exato abre a partir dela');

  // ─── 2. a análise sai antes de qualquer busca ───
  //
  // C(13,5,2): 78 alvos, 1287 cartelas possíveis, 10 alvos por cartela. Tudo
  // contagem — nenhuma busca precisa acontecer para estes três números.
  await resolver(13, 5, 2, '1000000');
  await pagina.waitForFunction(
    () => document.getElementById('ex-alvos').textContent.trim() === '78',
    undefined,
    { timeout: 20000 }
  );
  marcar(true, 'a análise conta os alvos antes de qualquer busca', '78 alvos');
  marcar(
    (await texto('#ex-blocos')) === '1.287' && (await texto('#ex-por-bloco')) === '10',
    'e conta as cartelas possíveis e o que cada uma cobre',
    `${await texto('#ex-blocos')} cartelas, ${await texto('#ex-por-bloco')} alvos cada`
  );

  // ─── 3. o piso aparece com a origem ───
  await pagina.waitForFunction(
    () => !document.getElementById('ex-piso-cartao').hidden,
    undefined,
    { timeout: 20000 }
  );
  const piso = await texto('#ex-piso');
  marcar(
    /Nada menor que \d+ cartelas existe/.test(piso) && /De onde vem/.test(piso),
    'o piso aparece dizendo de onde veio',
    piso.slice(0, 80)
  );

  // ─── 4. o verificador confere de verdade ───
  await pagina.waitForFunction(
    () => !document.getElementById('ex-verificacao-cartao').hidden,
    undefined,
    { timeout: 60000 }
  );
  marcar(
    /Confere\./.test(await texto('#ex-verificacao')),
    'as cartelas construídas passam pelo verificador',
    (await texto('#ex-verificacao')).slice(0, 70)
  );

  // ─── 5. onde a prova não fecha, os dois números aparecem ───
  await esperarResultado();
  const frase = await texto('#ex-frase');
  const encontrado = await numero('#ex-encontrado');
  const provado = await numero('#ex-provado');
  marcar(
    encontrado > provado,
    'em C(13,5,2) o encontrado fica acima do provado',
    `${encontrado} contra ${provado}`
  );
  marcar(
    /Solução encontrada/.test(frase) && frase.includes('≥'),
    'e a frase mostra os dois números separados',
    frase.slice(0, 90)
  );
  marcar(
    !/Mínimo exato/.test(frase),
    'sem chamar de mínimo o que só foi encontrado',
    frase.slice(0, 60)
  );
  marcar(
    !(await pagina.locator('#ex-insistir').isHidden()),
    'e oferece insistir, porque ainda há o que procurar'
  );
  const relato = await texto('#ex-prova');
  marcar(
    /não sei/.test(relato) || /orçamento acabou/.test(relato),
    'a prova diz que o orçamento acabou, e não que nada existe',
    relato.slice(-90)
  );

  // ─── 6. onde a prova fecha, ela fecha ───
  //
  // C(7,3,2) é o plano de Fano: 7 blocos, e a cota de contagem já encosta neles.
  // Aqui a palavra "mínimo" é a palavra certa.
  await resolver(7, 3, 2, '1000000');
  await esperarResultado();
  const fano = await texto('#ex-frase');
  marcar(
    /Mínimo exato: 7 cartelas/.test(fano),
    'em C(7,3,2) a tela diz mínimo exato, com todas as letras',
    fano.slice(0, 70)
  );
  marcar(
    (await numero('#ex-folga')) === 0 && (await pagina.locator('#ex-insistir').isHidden()),
    'a folga é zero e o botão de insistir some: não há mais o que procurar'
  );
  marcar(
    (await pagina.locator('#ex-cartelas .cartela').count()) === 7,
    'e as sete cartelas estão na tela'
  );

  // ─── 7. a exaustão sobe o piso acima da cota fechada ───
  //
  // C(10,4,2): a contagem para em 8, e a varredura completa prova 9. É o caso
  // em que o aplicativo descobre matemática que a fórmula não alcançava — e
  // sem consultar tabela de ninguém.
  await resolver(10, 4, 2, '200000000');
  await esperarResultado(180000);
  const origem = await texto('#ex-piso');
  marcar(
    (await numero('#ex-provado')) === 9,
    'em C(10,4,2) a varredura prova 9, acima da cota de contagem que dá 8',
    `piso ${await numero('#ex-provado')}`
  );
  marcar(
    /exaustão/.test(origem),
    'e a origem do piso diz que foi exaustão, e não fórmula',
    origem.slice(0, 90)
  );
  marcar(
    /Mínimo exato: 9 cartelas/.test(await texto('#ex-frase')),
    'com isso o mínimo fica provado'
  );

  // ─── 8. o que não é problema é recusado com o motivo ───
  await pagina.fill('#ex-universo', '5');
  await pagina.fill('#ex-cartela', '9');
  await pagina.click('#ex-resolver');
  await pagina.waitForFunction(
    () => !document.getElementById('ex-erro').hidden,
    undefined,
    { timeout: 20000 }
  );
  marcar(
    /não cabe/.test(await texto('#ex-erro')),
    'uma cartela maior que o universo é recusada com o motivo',
    (await texto('#ex-erro')).slice(0, 80)
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
