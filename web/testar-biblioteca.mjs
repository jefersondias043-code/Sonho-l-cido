/*
 * Teste da biblioteca de coberturas do mundo, num navegador de verdade.
 *
 * O que precisa ficar provado aqui:
 *
 *   1. Um arquivo no formato da La Jolla é importado e fica guardado no
 *      aparelho, sobrevivendo a fechar e reabrir o aplicativo.
 *   2. Uma busca cuja configuração está na biblioteca **parte daquela
 *      cobertura**, em vez de reconstruí-la.
 *   3. Um arquivo malformado é recusado com explicação, e nunca vira um
 *      fechamento furado apresentado como bom.
 *   4. A biblioteca nunca piora o resultado: quando o motor já sabe construir
 *      algo melhor, ele continua vencendo.
 *
 * O arquivo de teste é sintético, no mesmo formato do covers.json oficial —
 * o real tem 2,7 GB e não cabe num teste.
 *
 *   ./construir-web.sh && node web/testar-biblioteca.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8131;

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

/**
 * As 12 cartelas do sistema de Steiner S(2,3,9) — a solução ótima de C(9,3,2).
 *
 * Escrita à mão a partir do plano afim de ordem 3: as linhas de uma grade 3×3,
 * suas colunas e as duas famílias de diagonais. É o mesmo objeto que o motor
 * sabe construir, e por isso serve para os dois testes que importam: a
 * biblioteca é usada quando ajuda, e não atrapalha quando não ajuda.
 */
const STEINER_9 = [
  [1, 2, 3], [4, 5, 6], [7, 8, 9],
  [1, 4, 7], [2, 5, 8], [3, 6, 9],
  [1, 5, 9], [2, 6, 7], [3, 4, 8],
  [1, 6, 8], [2, 4, 9], [3, 5, 7],
];

/**
 * Uma cobertura válida de C(12,5,3), montada por força bruta aqui mesmo.
 *
 * `t = 3` não tem construção fechada no motor, então esta é a configuração em
 * que a biblioteca faz diferença de verdade — e o teste precisa de uma
 * cobertura de verdade, não de um número inventado.
 */
function coberturaDe12Em5Cobrindo3() {
  // Gerador próprio, com semente fixa: `Math.random` faria este teste produzir
  // uma cobertura diferente a cada execução, e um teste que muda sozinho tanto
  // esconde regressões quanto inventa falhas que ninguém consegue repetir.
  let estado = 20260817;
  const sorteio = () => {
    estado = (estado * 1103515245 + 12345) & 0x7fffffff;
    return estado / 0x7fffffff;
  };

  const alvos = [];
  for (let a = 1; a <= 12; a++)
    for (let b = a + 1; b <= 12; b++)
      for (let c = b + 1; c <= 12; c++) alvos.push([a, b, c]);

  const descobertos = new Set(alvos.map((x) => x.join(',')));
  const blocos = [];

  // Guloso simples: a cada passo, a cartela que cobre mais trincas descobertas.
  while (descobertos.size > 0) {
    let melhor = null;
    let melhorGanho = -1;
    // Amostra de candidatas: começa de uma trinca descoberta e completa.
    for (const chave of descobertos) {
      const base = chave.split(',').map(Number);
      for (let tentativa = 0; tentativa < 40; tentativa++) {
        const cartela = [...base];
        while (cartela.length < 5) {
          const n = 1 + Math.floor(sorteio() * 12);
          if (!cartela.includes(n)) cartela.push(n);
        }
        cartela.sort((x, y) => x - y);
        let ganho = 0;
        for (let i = 0; i < 5; i++)
          for (let j = i + 1; j < 5; j++)
            for (let k = j + 1; k < 5; k++)
              if (descobertos.has([cartela[i], cartela[j], cartela[k]].join(','))) ganho++;
        if (ganho > melhorGanho) {
          melhorGanho = ganho;
          melhor = cartela;
        }
      }
      break; // uma trinca-semente por passo já basta
    }
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++)
        for (let k = j + 1; k < 5; k++)
          descobertos.delete([melhor[i], melhor[j], melhor[k]].join(','));
    blocos.push(melhor);
  }
  return blocos;
}

const servidor = await servir();
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ ...devices['iPhone 13'] });
const pagina = await contexto.newPage();

const errosDeConsole = [];
pagina.on('console', (m) => m.type() === 'error' && errosDeConsole.push(m.text()));
pagina.on('pageerror', (e) => errosDeConsole.push(String(e)));

const pasta = join(tmpdir(), 'sonho-lucido-biblioteca');
await mkdir(pasta, { recursive: true });

console.log('Teste da biblioteca de coberturas do mundo\n');

try {
  const cobertura12 = coberturaDe12Em5Cobrindo3();
  const arquivo = join(pasta, 'biblioteca.json');
  await writeFile(
    arquivo,
    JSON.stringify({
      'C(9,3,2)': STEINER_9,
      'C(12,5,3)': cobertura12,
    })
  );

  await pagina.goto(`http://localhost:${PORTA}/`, { waitUntil: 'networkidle' });

  // ─── 1. importar ───
  await pagina.locator('#biblioteca summary').click();
  const antes = (await pagina.locator('#resumo-biblioteca').textContent()).trim();
  marcar(/nenhuma cobertura/.test(antes), 'começa sem nenhuma cobertura guardada', antes);

  await pagina.setInputFiles('#arquivo-biblioteca', arquivo);
  await pagina.waitForFunction(
    () => /coberturas guardadas/.test(document.getElementById('resumo-biblioteca').textContent),
    undefined,
    { timeout: 20000 }
  );
  const resumo = (await pagina.locator('#resumo-biblioteca').textContent()).trim();
  marcar(/2 coberturas guardadas/.test(resumo), 'o arquivo é importado e contado', resumo.slice(0, 70));

  // ─── 2. sobrevive a fechar e reabrir ───
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.locator('#biblioteca summary').click();
  await pagina.waitForFunction(
    () => /coberturas guardadas/.test(document.getElementById('resumo-biblioteca').textContent),
    undefined,
    { timeout: 10000 }
  );
  marcar(true, 'a biblioteca sobrevive a fechar e reabrir o aplicativo');

  // ─── 3. a busca parte da cobertura guardada ───
  //
  // C(12,5,3) é o caso que importa: sem construção fechada no motor, e longe de
  // ser resolvido em segundos. O que a biblioteca traz tem de ser aproveitado.
  await pagina.fill('#universo', '12');
  await pagina.fill('#pool', '12');
  await pagina.fill('#cartela', '5');
  await pagina.fill('#cobrir', '3');
  await pagina.click('#iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('melhor-cartelas').textContent.trim();
      return t !== '' && t !== '—' && Number(t) > 0;
    },
    undefined,
    { timeout: 30000 }
  );

  const comBiblioteca = await pagina.evaluate(() => ({
    cartelas: Number(document.getElementById('melhor-cartelas').textContent.trim()),
    partida: document.getElementById('partida').textContent.trim(),
    cobertura: document.getElementById('cobertura').textContent.trim(),
  }));

  marcar(
    comBiblioteca.cartelas <= cobertura12.length,
    'a busca parte da cobertura guardada, sem reconstruí-la',
    `biblioteca trouxe ${cobertura12.length}, o motor começou em ${comBiblioteca.cartelas}`
  );
  marcar(
    /cobertura do mundo/i.test(comBiblioteca.partida),
    'e a tela diz que partiu da cobertura do mundo, não de algo colado',
    comBiblioteca.partida.replace(/\s+/g, ' ').slice(0, 70)
  );
  marcar(
    comBiblioteca.cobertura.startsWith('100'),
    'e o ponto de partida cobre tudo',
    `cobertura ${comBiblioteca.cobertura}`
  );

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#configurar.ativo', { timeout: 10000 });

  // ─── 4. a biblioteca não atrapalha onde o motor já é melhor ───
  //
  // C(9,3,2) sai pronto da construção algébrica em zero iterações. A cobertura
  // guardada tem o mesmo tamanho, então o resultado não pode piorar.
  await pagina.fill('#universo', '9');
  await pagina.fill('#pool', '9');
  await pagina.fill('#cartela', '3');
  await pagina.fill('#cobrir', '2');
  await pagina.click('#iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });
  await pagina.waitForSelector('#selo-otimo:not([hidden])', { timeout: 60000 });
  const otimo = Number((await pagina.locator('#melhor-cartelas').textContent()).trim());
  marcar(otimo === 12, 'onde o motor já é ótimo, a biblioteca não atrapalha', `${otimo} cartelas`);

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#configurar.ativo', { timeout: 10000 });

  // ─── 5. arquivo malformado é recusado com explicação ───
  const quebrado = join(pasta, 'quebrado.json');
  await writeFile(
    quebrado,
    // Um bloco com 4 números onde a chave promete 3. Se isto passasse, o
    // aplicativo apresentaria um fechamento furado como cobertura do mundo.
    JSON.stringify({ 'C(9,3,2)': [[1, 2, 3], [4, 5, 6, 7]] })
  );

  await pagina.locator('#biblioteca summary').click();
  await pagina.setInputFiles('#arquivo-biblioteca', quebrado);
  await pagina.waitForSelector('#erro-biblioteca:not([hidden])', { timeout: 15000 });
  const erro = (await pagina.locator('#erro-biblioteca').textContent()).trim();
  marcar(
    /C\(9,3,2\)/.test(erro) && /números/.test(erro),
    'um arquivo malformado é recusado, dizendo qual design e por quê',
    erro.slice(0, 70)
  );

  const aindaTem = (await pagina.locator('#resumo-biblioteca').textContent()).trim();
  marcar(
    /2 coberturas guardadas/.test(aindaTem),
    'e a biblioteca boa continua intacta',
    aindaTem.slice(0, 50)
  );

  // ─── 6. apagar ───
  await pagina.click('#limpar-biblioteca');
  await pagina.waitForFunction(
    () => /nenhuma cobertura/.test(document.getElementById('resumo-biblioteca').textContent),
    undefined,
    { timeout: 10000 }
  );
  marcar(true, 'dá para apagar a biblioteca e recuperar o espaço');

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 120));
} finally {
  await navegador.close();
  servidor.close();
  await rm(pasta, { recursive: true, force: true });
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
