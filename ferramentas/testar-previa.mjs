// Testa o arquivo único que `previa-artefato.py` monta.
//
// A costura dos cinco módulos num só é uma transformação de texto, e
// transformação de texto quebra em silêncio: um nome que colide passa a
// sobrescrever o outro, e a página abre com metade das funções erradas sem
// nenhum erro no console. Por isso a prévia tem teste próprio — e o que ele
// exercita é justamente o caminho que atravessa os cinco módulos: escolher
// dezenas (estrategia), trazer bilhetes (catalogo), varrer (conferir) e dividir
// em partes (volante).
//
//     python3 ferramentas/previa-artefato.py previa.html
//     node ferramentas/testar-previa.mjs previa.html

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const arquivo = process.argv[2] ?? 'previa.html';

let feitos = 0;
const falhas = [];
const conferir = (nome, condicao, detalhe = '') => {
  feitos++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

const servidor = createServer(async (_, resposta) => {
  resposta.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  resposta.end(await readFile(arquivo));
});
await new Promise((pronto) => servidor.listen(0, pronto));

const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const pagina = await (await navegador.newContext({ viewport: { width: 380, height: 800 } }))
  .newPage();
const erros = [];
pagina.on('pageerror', (e) => erros.push(String(e)));
pagina.on('console', (m) => {
  // O service worker não existe na prévia, e o navegador reclama disso. É o
  // desenho, não defeito.
  const texto = m.text();
  if (m.type() === 'error' && !texto.includes('MIME type')) erros.push(texto);
});

await pagina.goto(`http://127.0.0.1:${servidor.address().port}/`, { waitUntil: 'networkidle' });

await pagina.click('#escolher');
await pagina.waitForSelector('.bilhetes li', { timeout: 20000 });
const bilhetes = await pagina.locator('.bilhetes li').count();
conferir('a prévia chega aos bilhetes', bilhetes > 0);
conferir('e traz a resposta inteira',
  /acertos garantidos/.test(await pagina.locator('.resposta').innerText()));
conferir('e o selo é um dos dois estados',
  ['mínimo provado', 'menor conhecido'].includes(await pagina.locator('.selo').first().innerText()));
conferir('e a ressalva do pool aparece',
  /a garantia vale sempre|1 concurso a cada/.test(await pagina.locator('.resposta .ressalva').innerText()));

await pagina.click('#det-conferir summary');
await pagina.click('#varrer');
await pagina.waitForFunction(
  () => /está de pé|não se sustentou/.test(document.querySelector('#varredura').innerText),
  null, { timeout: 120000 });
conferir('a varredura roda e confirma',
  (await pagina.locator('#varredura').innerText()).includes('está de pé'));

await pagina.click('#det-bolao summary');
await pagina.fill('#partes', '4');
await pagina.dispatchEvent('#partes', 'input');
conferir('o bolão divide', (await pagina.locator('.partes li').count()) === 4);

conferir('sem erro de JavaScript', erros.length === 0, erros.join(' | '));

await navegador.close();
servidor.close();

console.log(`${feitos} conferências`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas) console.error(`  ${f}`);
  process.exit(1);
}
console.log('prévia: tudo confere');
