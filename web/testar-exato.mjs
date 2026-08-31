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

  // ─── 5. o teto nunca é ultrapassado, e a cobertura é o que anda ───
  //
  // É a regra do aplicativo: o número de cartelas está preso ao piso, e o que
  // cresce é a cobertura.
  await pagina.waitForFunction(
    () => !document.getElementById('ex-construcao-cartao').hidden,
    undefined,
    { timeout: 60000 }
  );
  const leituras = new Set();
  let passouDoTeto = false;
  for (let i = 0; i < 40; i += 1) {
    const agora = await texto('#ex-construcao');
    if (agora) leituras.add(agora);
    const cartelas = await numero('#ex-cartelas-agora');
    const teto = await numero('#ex-teto');
    if (teto > 0 && cartelas > teto) passouDoTeto = true;
    if (leituras.size >= 2) break;
    await pagina.waitForTimeout(120);
  }
  marcar(
    !passouDoTeto,
    'o número de cartelas nunca passa do teto mostrado na tela',
    `teto ${await numero('#ex-teto')}, cartelas ${await numero('#ex-cartelas-agora')}`
  );
  marcar(
    leituras.size >= 2,
    'a escalada mostra progresso que muda enquanto ela trabalha',
    `${leituras.size} leituras distintas`
  );
  marcar(
    !(await pagina.locator('#ex-parar').isHidden()),
    'e o botão de parar está à mão enquanto ela roda'
  );

  // Ela roda até mandarem parar: quem decide a hora é quem está olhando.
  await pagina.click('#ex-parar');
  await esperarResultado();
  const parcial = await texto('#ex-frase');
  const achou = await numero('#ex-encontrado');
  const provado = await numero('#ex-provado');
  marcar(
    achou > 0 && achou <= provado,
    'a configuração de tamanho real termina, sem travar e sem passar do teto',
    `${achou} cartelas com teto ${provado}`
  );
  marcar(
    /a melhor cobertura que alcancei foi/.test(parcial) || /Mínimo exato/.test(parcial),
    'e diz a cobertura alcançada, deixando claro que piso não é promessa',
    parcial.slice(0, 110)
  );
  marcar(
    /→/.test(await texto('#ex-curva')),
    'a curva registra cartela por cartela quanto foi coberto',
    (await texto('#ex-curva')).slice(0, 90)
  );
  // A cobertura parou abaixo de 100%, e o verificador tem de dizer isso — é
  // resultado, não defeito.
  const conferencia = await texto('#ex-verificacao');
  marcar(
    /Confere\.|Não confere\./.test(conferencia),
    'o verificador confere a coleção que está na tela e diz o que encontrou',
    conferencia.slice(0, 90)
  );

  // ─── 6. cartelas premiadas ───
  //
  // Pedir duas dobra a cota de contagem, e é o **teto** que dobra junto: o
  // número de cartelas continua preso ao piso, e o piso subiu.
  await marcarNumeros(25, Array.from({ length: 9 }, (_, i) => i + 1));
  await regras(3, 2, 2, 2);
  await pagina.selectOption('#ex-esforco', '1');
  await pagina.click('#ex-resolver');
  // Esperar pelo resultado, e não por um número aparecer: o teto da rodada
  // anterior ainda está na tela, e ler cedo demais leria o problema errado.
  await esperarResultado();
  const tetoComDuas = await numero('#ex-teto');
  marcar(
    tetoComDuas === 24,
    'com duas cartelas premiadas o teto dobra, porque a contagem dobra',
    `teto ${tetoComDuas}`
  );
  marcar(
    (await numero('#ex-cartelas-agora')) <= tetoComDuas,
    'e o número de cartelas continua preso a ele',
    `${await numero('#ex-cartelas-agora')} de ${tetoComDuas}`
  );
  marcar(
    await pagina.locator('#ex-parar').isHidden(),
    'o botão de parar some quando não há mais o que parar'
  );

  // ─── 7. fazer aos poucos: fechar e continuar de onde parou ───
  //
  // Num aparelho fraco isto é o que faz "aos poucos" significar alguma coisa.
  await marcarNumeros(25, Array.from({ length: 20 }, (_, i) => i + 1));
  await regras(17, 15, 15);
  await pagina.selectOption('#ex-esforco', '1');
  await pagina.click('#ex-resolver');
  await pagina.waitForFunction(
    () => Number(document.getElementById('ex-cartelas-agora').textContent.replace(/\D/g, '')) > 0,
    undefined,
    { timeout: 90000 }
  );
  await pagina.waitForTimeout(5000);
  await pagina.click('#ex-parar');
  await esperarResultado(120000);
  const guardou = await pagina.evaluate(
    () => localStorage.getItem('sonho-lucido:exato:escalada') !== null
  );
  marcar(guardou, 'o trabalho fica guardado no aparelho quando ela para');

  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('#ex-grade .numero');
  await marcarNumeros(25, Array.from({ length: 20 }, (_, i) => i + 1));
  await regras(17, 15, 15);
  await pagina.waitForTimeout(200);
  marcar(
    !(await pagina.locator('#ex-continuar').isHidden()),
    'e ao voltar com os mesmos números a tela oferece continuar de onde parou',
    (await texto('#ex-retomar-aviso')).slice(0, 90)
  );

  // Com outros números a oferta some: retomar sobre outra configuração seria
  // continuar o problema errado.
  await regras(17, 15, 13);
  await pagina.waitForTimeout(200);
  marcar(await pagina.locator('#ex-continuar').isHidden(), 'e some quando os números mudam');

  // ─── 8. conferir, e o dinheiro ───
  //
  // Um fechamento pequeno e comprovado, para que a conferência possa ser
  // cobrada contra números que se conhecem de cor: 18 dezenas, jogos de 17,
  // garante 15, mínimo 16 cartelas.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('#ex-grade .numero');
  await marcarNumeros(25, Array.from({ length: 18 }, (_, i) => i + 1));
  await regras(17, 15, 15);
  await pagina.selectOption('#ex-esforco', '1');
  await pagina.click('#ex-resolver');
  await esperarResultado(180000);

  marcar(
    (await pagina.locator('#ex-dinheiro-cartao').isVisible()) &&
      (await pagina.locator('#ex-conferir-cartao').isVisible()),
    'com as cartelas prontas, a conferência e o controle financeiro aparecem'
  );

  const faixasNaTela = await pagina.$$eval('#ex-premios input[data-faixa]', (campos) =>
    campos.map((c) => Number(c.dataset.faixa))
  );
  marcar(
    faixasNaTela.join(',') === '15,14,13,12,11',
    'há um campo de prêmio para cada faixa de acertos, do topo para baixo',
    faixasNaTela.join(', ')
  );

  // O custo total é aritmética que a pessoa confere de cabeça: 16 × 2,50 = 40.
  await pagina.fill('#ex-custo-unitario', '2,50');
  const custo = await texto('#ex-custo-total');
  marcar(
    /R\$\s*40,00/.test(custo) && /16 cartelas/.test(custo),
    'o custo total é o número de cartelas vezes o valor de cada uma',
    custo
  );

  for (const [faixa, valor] of [
    [11, '6'],
    [12, '12'],
    [13, '30'],
    [14, '1500'],
    [15, '60000'],
  ]) {
    await pagina.fill(`#ex-premio-${faixa}`, valor);
  }

  // Um sorteio tirado só dos números marcados: a garantia é uma afirmação
  // sobre exatamente estes, e tem de aparecer cumprida.
  await pagina.click('#ex-origem .opcao[data-origem="meus"]');
  await pagina.click('#ex-sortear');
  await pagina.waitForSelector('#ex-conferencia-cartao:not([hidden])');

  const sorteados = await pagina.$$eval('#ex-sorteio-saiu span', (e) =>
    e.map((x) => Number(x.textContent))
  );
  marcar(
    sorteados.length === 15 &&
      new Set(sorteados).size === 15 &&
      sorteados.every((n) => n >= 1 && n <= 18),
    'um sorteio simulado dentro dos meus números não traz nenhum de fora',
    sorteados.join(' ')
  );

  marcar(
    /🎯/.test(await texto('#ex-conferencia-topo')),
    'e a garantia aparece cumprida, porque é sobre estes números que ela vale',
    (await texto('#ex-conferencia-topo')).slice(0, 90)
  );

  // A soma da tabela tem de fechar com o total: nenhuma cartela pode sumir
  // entre as faixas mostradas e a linha de baixo.
  const somaDaTabela = await pagina.$$eval('#ex-conferencia-faixas tbody tr', (linhas) =>
    linhas.reduce(
      (s, l) => s + Number((l.children[1].textContent || '0').replace(/\D/g, '')),
      0
    )
  );
  marcar(somaDaTabela === 16, 'a tabela de faixas fecha com o total de cartelas', `${somaDaTabela} de 16`);

  // O balanço: as três linhas que respondem "valeu a pena?".
  const balanco = await texto('#ex-balanco');
  marcar(
    /Custo do fechamento/.test(balanco) &&
      /Total das premiações/.test(balanco) &&
      /Resultado líquido/.test(balanco) &&
      /R\$\s*40,00/.test(balanco),
    'o balanço mostra custo, premiação e líquido, com o custo do fechamento inteiro',
    balanco.slice(0, 110)
  );

  // Cada faixa mostra quantidade, valor e o produto — separada das outras, que
  // é como o pedido descreve.
  const linhaDoTopo = await pagina.$eval('#ex-conferencia-faixas tbody tr', (l) =>
    [...l.children].map((c) => c.textContent.trim())
  );
  const quantasNoTopo = Number(linhaDoTopo[1].replace(/\D/g, ''));
  marcar(
    linhaDoTopo.length === 4 &&
      /15 acertos/.test(linhaDoTopo[0]) &&
      new RegExp(`${(quantasNoTopo * 60000).toLocaleString('pt-BR')}`).test(linhaDoTopo[3]),
    'cada faixa mostra quantidade × prêmio = total, na própria linha',
    linhaDoTopo.join(' | ')
  );

  // As cartelas premiadas podem ser vistas, e não só contadas.
  marcar(
    (await pagina.locator('#ex-premiadas-cartao').isVisible()) &&
      (await pagina.locator('#ex-faixa-cartelas .cartela').count()) > 0,
    'e dá para ver quais cartelas foram premiadas, e não só quantas',
    `${await pagina.locator('#ex-faixa-cartelas .cartela').count()} desenhadas`
  );

  // Um resultado digitado com números de fora: a garantia não se aplica, e a
  // tela precisa dizer o motivo certo em vez do motivo genérico.
  await pagina.fill('#ex-resultado', '01 02 03 04 05 06 07 08 09 10 11 12 13 22 23');
  await pagina.click('#ex-conferir');
  const comForasteiros = await texto('#ex-conferencia-topo');
  marcar(
    /2 de fora/.test(comForasteiros) && /22, 23/.test(comForasteiros),
    'um resultado com números que não foram marcados é conferido, e a tela diz quais ficaram de fora',
    comForasteiros.slice(0, 120)
  );

  await pagina.fill('#ex-resultado', '1 2 3');
  await pagina.click('#ex-conferir');
  marcar(
    /15 números, e você digitou 3/.test(await texto('#ex-conferir-erro')),
    'e uma entrada errada é recusada com uma frase que explica o quê',
    await texto('#ex-conferir-erro')
  );

  // ─── 9. muitos sorteios, e o desempenho financeiro ao longo deles ───
  await pagina.click('#ex-origem .opcao[data-origem="universo"]');
  await pagina.evaluate(() => {
    document.getElementById('ex-simulacao-cartao').open = true;
  });
  await pagina.click('#ex-quantos .opcao[data-quantos="1000"]');
  await pagina.click('#ex-simular');
  await pagina.waitForSelector('#ex-simulacao-rolagem:not([hidden])', { timeout: 120000 });

  const tabelaDaSimulacao = await texto('#ex-simulacao-faixas');
  marcar(
    /1.000 sorteios do universo inteiro/.test(tabelaDaSimulacao) &&
      (await pagina.locator('#ex-simulacao-faixas tbody tr').count()) === 5,
    'a simulação relata cada faixa ao longo de mil sorteios',
    tabelaDaSimulacao.slice(0, 80)
  );

  const financeiro = await texto('#ex-simulacao-dinheiro');
  marcar(
    /Investido em 1.000 sorteios/.test(financeiro) &&
      /Recebido no total/.test(financeiro) &&
      /Sorteios com lucro/.test(financeiro) &&
      /R\$\s*40.000,00/.test(financeiro),
    'e o balanço da simulação diz quanto saiu, quanto voltou e em quantos sorteios houve lucro',
    financeiro.slice(0, 120)
  );

  // A promessa que faz a tela valer: experimentar outro cenário de premiação
  // não custa outra simulação.
  const antes = financeiro;
  await pagina.fill('#ex-premio-11', '12');
  await pagina.waitForTimeout(150);
  const depois = await texto('#ex-simulacao-dinheiro');
  marcar(
    antes !== depois && /Recebido no total/.test(depois),
    'mudar um prêmio refaz o balanço na hora, sem repetir a simulação'
  );

  // O aviso que impede a leitura errada do cenário mais bonito.
  await pagina.click('#ex-origem .opcao[data-origem="meus"]');
  await pagina.click('#ex-quantos .opcao[data-quantos="100"]');
  await pagina.click('#ex-simular');
  await pagina.waitForFunction(
    () => /Leia com esta ressalva/.test(document.getElementById('ex-simulacao-dinheiro').textContent),
    undefined,
    { timeout: 60000 }
  );
  const ressalva = await texto('#ex-simulacao-dinheiro');
  marcar(
    /0,025%/.test(ressalva) && /1 em 4.006/.test(ressalva),
    'simular só entre os meus números vem com a chance de isso acontecer de verdade',
    ressalva.slice(ressalva.indexOf('Leia com'), ressalva.indexOf('Leia com') + 130)
  );

  // Os preços sobrevivem a fechar o aplicativo: ninguém redigita cinco faixas.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('#ex-grade .numero');
  await marcarNumeros(25, Array.from({ length: 18 }, (_, i) => i + 1));
  await regras(17, 15, 15);
  await pagina.selectOption('#ex-esforco', '1');
  await pagina.click('#ex-resolver');
  await esperarResultado(180000);
  marcar(
    (await pagina.inputValue('#ex-custo-unitario')).replace('.', ',') === '2,5' &&
      (await pagina.inputValue('#ex-premio-15')) === '60000',
    'os valores informados sobrevivem a fechar e reabrir o aplicativo',
    `cartela ${await pagina.inputValue('#ex-custo-unitario')} · 15 acertos ${await pagina.inputValue('#ex-premio-15')}`
  );

  // ─── 10. o que não é problema é recusado com o motivo ───
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
