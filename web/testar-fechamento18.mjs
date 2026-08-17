/*
 * Teste da ferramenta "18 de 25", num navegador de verdade.
 *
 * O que precisa ficar provado:
 *
 *   1. A seleção é do usuário: 25 números disponíveis, exatamente 18 marcados,
 *      e nada começa antes disso.
 *   2. Os jogos saem com os números que a pessoa escolheu — não com índices.
 *   3. **A garantia é real.** Para cada um dos 816 grupos de 15 que existem
 *      dentro dos 18 escolhidos, algum jogo acerta pelo menos o prometido.
 *   4. A tela avisa quando a garantia pedida é gratuita, em vez de deixar
 *      alguém achar que otimizou algo.
 *
 * A verificação do item 3 é feita aqui, em JavaScript, percorrendo os 816 grupos
 * um a um. Se ela usasse o mesmo código que produziu o fechamento, não provaria
 * nada — provaria só que o motor concorda consigo mesmo.
 *
 *   ./construir-web.sh && node web/testar-fechamento18.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8133;

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

/** Todos os subconjuntos de tamanho `k` de `itens`. */
function combinacoes(itens, k) {
  const saida = [];
  const atual = [];
  (function passo(inicio) {
    if (atual.length === k) {
      saida.push([...atual]);
      return;
    }
    for (let i = inicio; i < itens.length; i++) {
      atual.push(itens[i]);
      passo(i + 1);
      atual.pop();
    }
  })(0);
  return saida;
}

/**
 * Confere a garantia percorrendo todos os grupos, um a um.
 *
 * Devolve o primeiro grupo que ficou sem atendimento, ou `null` se todos foram
 * atendidos. Devolver o grupo que falhou, e não apenas "falso", é o que torna
 * uma falha investigável.
 */
function conferirGarantia(jogos, escolhidos, tamanhoGrupo, acertosPedidos) {
  const grupos = combinacoes(escolhidos, tamanhoGrupo);
  const conjuntos = jogos.map((j) => new Set(j));

  for (const grupo of grupos) {
    let melhor = 0;
    for (const jogo of conjuntos) {
      let acertos = 0;
      for (const n of grupo) if (jogo.has(n)) acertos++;
      if (acertos > melhor) melhor = acertos;
      if (melhor >= acertosPedidos) break;
    }
    if (melhor < acertosPedidos) return { grupo, melhor };
  }
  return null;
}

// Uma seleção fixa e esparsa: números espalhados pelos 25, com buracos. Se o
// aplicativo estivesse trabalhando com índices em vez de rótulos, os jogos
// sairiam com números que não estão nesta lista — e o teste pegaria.
const ESCOLHIDOS = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 24, 25];

await mkdir(new URL('../capturas/', import.meta.url).pathname, { recursive: true });
const servidor = await servir();
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ ...devices['iPhone 13'] });
const pagina = await contexto.newPage();

const errosDeConsole = [];
pagina.on('console', (m) => m.type() === 'error' && errosDeConsole.push(m.text()));
pagina.on('pageerror', (e) => errosDeConsole.push(String(e)));

console.log('Teste da ferramenta 18 de 25\n');

try {
  await pagina.goto(`http://localhost:${PORTA}/`, { waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="fechamento18"]');
  await pagina.waitForSelector('#fechamento18.ativo');

  // ─── 1. a grade e a seleção ───
  const quantosNumeros = await pagina.locator('#grade-25 .numero').count();
  marcar(quantosNumeros === 25, 'os 25 números do universo estão na tela', `${quantosNumeros} botões`);

  marcar(
    await pagina.locator('#iniciar-18').isDisabled(),
    'não dá para começar sem escolher'
  );

  for (const n of ESCOLHIDOS.slice(0, 17)) {
    await pagina.click(`#grade-25 .numero[data-n="${n}"]`);
  }
  const parcial = (await pagina.locator('#contagem-18').textContent()).trim();
  marcar(/17 de 18/.test(parcial), 'a contagem acompanha a seleção', parcial.slice(0, 50));
  marcar(
    await pagina.locator('#iniciar-18').isDisabled(),
    'com 17 marcados ainda não dá para começar'
  );

  await pagina.click(`#grade-25 .numero[data-n="${ESCOLHIDOS[17]}"]`);
  const completa = (await pagina.locator('#contagem-18').textContent()).trim();
  marcar(/18 de 18/.test(completa) && /816/.test(completa), 'com 18 marcados, anuncia os 816 grupos', completa.slice(0, 60));

  // O 19º toque tem de ser recusado: a seleção é de 18, e passar disso
  // silenciosamente mudaria o problema sem a pessoa perceber.
  const naoEscolhido = [3, 6, 9, 12].find((n) => !ESCOLHIDOS.includes(n));
  await pagina.click(`#grade-25 .numero[data-n="${naoEscolhido}"]`);
  const aindaDezoito = (await pagina.locator('#contagem-18').textContent()).trim();
  marcar(/18 de 18/.test(aindaDezoito), 'um 19º número é recusado', aindaDezoito.slice(0, 40));

  await pagina.screenshot({ path: 'capturas/captura-fechamento18.png' });

  // ─── 2. a tela avisa quando a garantia é gratuita ───
  await pagina.click('#acertos-garantidos .opcao[data-acertos="12"]');
  const gratuita = (await pagina.locator('#explicacao-18').textContent()).trim();
  marcar(
    /um jogo só resolve/i.test(gratuita),
    'avisa que garantir 12 com jogos de 15 sai de graça',
    gratuita.replace(/\s+/g, ' ').slice(0, 72)
  );

  await pagina.click('#acertos-garantidos .opcao[data-acertos="15"]');
  const completaDemais = (await pagina.locator('#explicacao-18').textContent()).trim();
  marcar(
    /816 jogos/.test(completaDemais),
    'e que garantir os 15 exige a lista inteira',
    completaDemais.replace(/\s+/g, ' ').slice(0, 72)
  );

  // ─── 3. o fechamento de verdade ───
  const ACERTOS = 13;
  await pagina.click(`#acertos-garantidos .opcao[data-acertos="${ACERTOS}"]`);
  const trabalho = (await pagina.locator('#explicacao-18').textContent()).trim();
  marcar(
    /é aí que o motor trabalha/.test(trabalho),
    `garantir ${ACERTOS} é onde há trabalho a fazer`,
    trabalho.replace(/\s+/g, ' ').slice(0, 72)
  );

  await pagina.click('#iniciar-18');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('melhor-cartelas').textContent.trim();
      return t !== '' && t !== '—' && Number(t) > 0;
    },
    undefined,
    { timeout: 40000 }
  );

  // Um tempo de busca, para o motor ter chance de encolher a solução.
  await pagina.waitForTimeout(6000);
  await pagina.click('#pausar');
  await pagina.waitForFunction(
    () => document.getElementById('texto-situacao').textContent.includes('pausado'),
    undefined,
    { timeout: 10000 }
  );

  await pagina.click('.aba[data-painel="resultado"]');
  await pagina.waitForSelector('#resultado.ativo');

  const jogos = await pagina.$$eval('#lista-cartelas .cartela span:last-child', (nos) =>
    nos.map((n) => n.textContent.trim().split(/\s+/).map(Number))
  );

  marcar(jogos.length > 0, 'o fechamento aparece na tela', `${jogos.length} jogos`);
  marcar(
    jogos.every((j) => j.length === 15),
    'todo jogo tem os 15 números pedidos',
    `tamanhos: ${[...new Set(jogos.map((j) => j.length))].join(', ')}`
  );

  const fora = jogos.flat().filter((n) => !ESCOLHIDOS.includes(n));
  marcar(
    fora.length === 0,
    'todo número jogado está entre os 18 escolhidos',
    fora.length ? `apareceram de fora: ${[...new Set(fora)].join(', ')}` : 'nenhum número estranho'
  );

  // ─── 4. a verificação que sustenta a promessa ───
  const falha = conferirGarantia(jogos, ESCOLHIDOS, 15, ACERTOS);
  marcar(
    falha === null,
    `verificação independente: os 816 grupos recebem ${ACERTOS} acertos`,
    falha
      ? `o grupo ${falha.grupo.join(' ')} só recebeu ${falha.melhor}`
      : `816 de 816 conferidos, com ${jogos.length} jogos`
  );

  // E a garantia gratuita também tem de valer: 12 acertos sempre.
  const doze = conferirGarantia(jogos, ESCOLHIDOS, 15, 12);
  marcar(doze === null, 'e os 12 automáticos valem em todos eles');

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 120));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
