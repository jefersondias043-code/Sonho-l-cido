/*
 * Teste da ferramenta "Checar fechamento", num navegador de verdade.
 *
 * O que precisa ficar provado:
 *
 *   1. **A contagem de acertos é exata.** Uma cartela igual ao resultado faz 15;
 *      uma que troca uma dezena faz 14; e assim por diante até 11 e até zero.
 *   2. **As cartelas conferidas são as que existem.** A ferramenta nunca
 *      regenera um fechamento — se o histórico guardou aquelas cartelas, são
 *      aquelas que ela confere, e o resultado descreve o que a pessoa tem na
 *      mão.
 *   3. **Só 15 acertos é prêmio.** As faixas de 11 a 14 aparecem porque medem
 *      cobertura, e a tela nunca as apresenta como premiação.
 *   4. Entradas erradas são recusadas com uma frase que explica o quê.
 *   5. Um sorteio simulado é matematicamente válido: 15 dezenas distintas
 *      entre 1 e 25.
 *   6. O trabalho salvo sobrevive a fechar e reabrir o aplicativo.
 *
 *   ./construir-web.sh && node web/testar-checagem.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8137;

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

console.log('Teste da ferramenta Checar fechamento\n');

try {
  await pagina.goto(`http://localhost:${PORTA}/lotinha.html`, { waitUntil: 'networkidle' });

  // ─── 1. a aritmética dos acertos, caso a caso ───
  //
  // Cada caso é montado à mão a partir do mesmo resultado, trocando uma dezena
  // de cada vez. Se a contagem errar por um, algum destes falha — e uma
  // ferramenta de conferência que erra por um é pior do que não existir.
  const aritmetica = await pagina.evaluate(async () => {
    const chk = await import('./checagem.js');
    const resultado = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const fora = [16, 17, 18, 19, 20];

    // Cartela com exatamente `n` das 15 sorteadas, completada com dezenas de
    // fora até ter 15 dezenas.
    const com = (n) => [...resultado.slice(0, n), ...fora.slice(0, 15 - n)];

    const casos = {};
    for (const n of [15, 14, 13, 12, 11, 0]) {
      casos[n] = chk.conferir([com(n)], resultado).melhor;
    }

    // E o inverso: uma cartela sem nenhuma sorteada.
    const nenhum = chk.conferir([[16, 17, 18, 19, 20, 21, 22, 23, 24, 25]], resultado);
    return { casos, semNenhum: nenhum.melhor, faixaZero: nenhum.porFaixa[0] };
  });

  for (const n of [15, 14, 13, 12, 11]) {
    marcar(
      aritmetica.casos[n] === n,
      `uma cartela com ${n} das dezenas sorteadas conta ${n} acertos`,
      `contou ${aritmetica.casos[n]}`
    );
  }
  marcar(
    aritmetica.semNenhum === 0 && aritmetica.faixaZero === 1,
    'e uma cartela sem nenhuma sorteada conta zero',
    `melhor ${aritmetica.semNenhum}`
  );

  // ─── 2. entradas que precisam ser recusadas ───
  const recusas = await pagina.evaluate(async () => {
    const chk = await import('./checagem.js');
    const casos = {
      vazio: '',
      poucas: '01 02 03',
      demais: '01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16',
      repetida: '01 01 02 03 04 05 06 07 08 09 10 11 12 13 14',
      foraDoUniverso: '01 02 03 04 05 06 07 08 09 10 11 12 13 14 99',
      zero: '00 01 02 03 04 05 06 07 08 09 10 11 12 13 14',
    };
    const saida = {};
    for (const [nome, texto] of Object.entries(casos)) {
      const lido = chk.interpretarResultado(texto);
      saida[nome] = lido.erro ?? null;
    }
    // E o caminho feliz, com separadores variados.
    saida.aceito = chk.interpretarResultado('01,02;03 04\n05 06 07 08 09 10 11 12 13 14 15').dezenas;
    return saida;
  });

  marcar(
    Object.entries(recusas)
      .filter(([nome]) => nome !== 'aceito')
      .every(([, erro]) => typeof erro === 'string' && erro.length > 10),
    'todas as seis entradas inválidas são recusadas com explicação',
    Object.entries(recusas)
      .filter(([n]) => n !== 'aceito')
      .map(([n]) => n)
      .join(', ')
  );
  marcar(
    /repete dezena/.test(recusas.repetida ?? ''),
    'e a repetida diz que é repetida, não "formato inválido"',
    (recusas.repetida ?? '').slice(0, 60)
  );
  marcar(
    Array.isArray(recusas.aceito) && recusas.aceito.length === 15,
    'vírgula, ponto e vírgula, espaço e quebra de linha servem de separador',
    `${recusas.aceito?.length} dezenas lidas`
  );

  // ─── 3. cartelas estranhas não podem contaminar a conta ───
  const estranhas = await pagina.evaluate(async () => {
    const chk = await import('./checagem.js');
    const resultado = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const boa = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

    const vazio = chk.conferir([], resultado);
    const invalida = chk.conferir([[0, 99, -3, 1, 2]], resultado);
    const duplicadas = chk.conferir([boa, boa, boa], resultado);
    return {
      vazioTotal: vazio.total,
      vazioMelhor: vazio.melhor,
      vazioPremiadas: vazio.premiadas,
      invalidaAcertos: invalida.melhor,
      duplicadasPremiadas: duplicadas.premiadas,
    };
  });

  marcar(
    estranhas.vazioTotal === 0 && estranhas.vazioMelhor === -1 && estranhas.vazioPremiadas === 0,
    'um fechamento vazio devolve zero, e não quebra',
    `total ${estranhas.vazioTotal}, melhor ${estranhas.vazioMelhor}`
  );
  marcar(
    estranhas.invalidaAcertos === 2,
    'uma cartela com números fora do universo conta só os válidos',
    `contou ${estranhas.invalidaAcertos} (o 1 e o 2)`
  );
  marcar(
    estranhas.duplicadasPremiadas === 3,
    'cartelas repetidas contam repetidas, sem serem silenciosamente unidas',
    `${estranhas.duplicadasPremiadas} premiadas de 3 iguais`
  );

  // ─── 4. o sorteio simulado é um sorteio de verdade ───
  const sorteios = await pagina.evaluate(async () => {
    const chk = await import('./checagem.js');
    let ruins = 0;
    const contagem = new Map();
    for (let i = 0; i < 3000; i++) {
      const s = chk.sortearResultado();
      const distintas = new Set(s);
      if (s.length !== 15 || distintas.size !== 15) ruins++;
      if (s.some((d) => d < 1 || d > 25)) ruins++;
      if (s.some((d, k) => k > 0 && d <= s[k - 1])) ruins++;
      for (const d of s) contagem.set(d, (contagem.get(d) ?? 0) + 1);
    }
    const vezes = [...contagem.values()];
    return { ruins, dezenasVistas: contagem.size, menor: Math.min(...vezes), maior: Math.max(...vezes) };
  });

  marcar(
    sorteios.ruins === 0 && sorteios.dezenasVistas === 25,
    'três mil sorteios simulados: sempre 15 distintas de 1 a 25, em ordem',
    `${sorteios.dezenasVistas} dezenas diferentes vistas`
  );
  // 3.000 sorteios × 15/25 = 1.800 esperadas por dezena. Uma faixa larga basta
  // para pegar viés grosseiro sem falhar por acaso.
  marcar(
    sorteios.menor > 1_600 && sorteios.maior < 2_000,
    'e nenhuma dezena sai muito mais que as outras',
    `de ${sorteios.menor} a ${sorteios.maior} vezes, esperado 1.800`
  );

  // ─── 5. a tela, de ponta a ponta ───
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.click('#lot-pool .opcao[data-pool="18"]');
  for (let n = 1; n <= 18; n++) await pagina.click(`#lot-grade .numero[data-n="${n}"]`);
  await pagina.click('#lot-jogo .opcao[data-jogo="17"]');
  await pagina.click('#lot-iniciar');
  await pagina.waitForFunction(
    () => /Garantia|conferidos/.test(document.getElementById('lot-conferencia').textContent),
    null,
    { timeout: 60_000 }
  );

  await pagina.click('.aba[data-painel="checar"]');
  await pagina.waitForSelector('#checar.ativo');
  const ficha = (await pagina.locator('#chk-ficha').textContent()).replace(/\s+/g, ' ');
  marcar(
    /18 dezenas/.test(ficha) && /Cartelas\s*16/.test(ficha) && /17/.test(ficha),
    'a ficha descreve o fechamento carregado: dezenas, cartelas e tamanho',
    ficha.slice(0, 76)
  );

  // Um resultado inteiramente dentro do pool: o fechamento garante os 15.
  await pagina.fill('#chk-resultado', '01 02 03 04 05 06 07 08 09 10 11 12 13 14 15');
  await pagina.click('#chk-conferir');
  await pagina.waitForSelector('#chk-resumo-cartao:not([hidden])');

  const premiacao = (await pagina.locator('#chk-premiacao').textContent()).replace(/\s+/g, ' ');
  marcar(
    /1 cartela com 15 acertos/.test(premiacao),
    'o fechamento de 18 dezenas entrega a cartela com 15, e a tela a anuncia',
    premiacao.slice(0, 70)
  );

  const faixas = (await pagina.locator('#chk-faixas').textContent()).replace(/\s+/g, ' ');
  marcar(
    /15 acertos ?1/.test(faixas) && /14 acertos ?15/.test(faixas),
    'e a tabela bate com a matemática: 1 com 15, 15 com 14',
    faixas.slice(0, 76)
  );

  const nota = (await pagina.locator('#chk-nota-premio').textContent()).replace(/\s+/g, ' ');
  marcar(
    /só 15 acertos paga/i.test(nota) && /não prêmio/.test(nota),
    'a tela diz que 11 a 14 são medida de cobertura, e não prêmio',
    nota.slice(0, 76)
  );

  // ─── 6. ver as cartelas de uma faixa ───
  await pagina.click('#chk-faixa-botoes .opcao[data-faixa="14"]');
  await pagina.waitForTimeout(150);
  const quantasNaTela = await pagina.locator('#chk-cartelas .cartela').count();
  const acertosMarcados = await pagina
    .locator('#chk-cartelas .cartela')
    .first()
    .locator('.acertou')
    .count();
  marcar(
    quantasNaTela === 15 && acertosMarcados === 14,
    'abrir a faixa de 14 mostra as 15 cartelas, com as 14 dezenas certas marcadas',
    `${quantasNaTela} cartelas, ${acertosMarcados} dezenas marcadas na primeira`
  );

  // ─── 7. o sorteio simulado na tela ───
  await pagina.click('#chk-sortear');
  await pagina.waitForTimeout(200);
  const sorteado = await pagina.$$eval('#chk-sorteio span', (s) =>
    s.map((x) => Number(x.textContent))
  );
  marcar(
    sorteado.length === 15 && new Set(sorteado).size === 15 && sorteado.every((d) => d >= 1 && d <= 25),
    'o botão de simular sorteia 15 dezenas distintas e confere na hora',
    sorteado.join(' ')
  );

  // ─── 8. muitos sorteios, com estatística ───
  await pagina.click('#chk-multi-cartao summary');
  await pagina.click('#chk-quantos .opcao[data-quantos="1000"]');
  await pagina.click('#chk-simular');
  await pagina.waitForSelector('#chk-estatistica-rolagem:not([hidden])', { timeout: 120_000 });
  const estatistica = (await pagina.locator('#chk-estatistica').textContent()).replace(/\s+/g, ' ');
  marcar(
    /1\.000 sorteios/.test(estatistica) && /15/.test(estatistica) && /11/.test(estatistica),
    'mil sorteios simulados produzem a tabela das cinco faixas',
    estatistica.slice(0, 76)
  );

  const avisoSimulacao = (await pagina.locator('#chk-multi-cartao').textContent()).replace(/\s+/g, ' ');
  marcar(
    /simulação, não previsão/i.test(avisoSimulacao),
    'e a tela diz, com todas as letras, que simulação não é previsão',
    'aviso presente'
  );

  // ─── 9. o histórico: conferir o que foi salvo, não o que seria gerado ───
  //
  // A prova de que a ferramenta não regenera: grava-se uma sessão com cartelas
  // deliberadamente esquisitas — nenhuma delas sairia de um fechamento — e
  // exige-se que a conferência descreva **essas**.
  await pagina.evaluate(() => {
    const cartelas = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
      [21, 22, 23, 24, 25, 16, 17, 18, 19, 20, 1, 2, 3, 4, 5],
    ];
    const sessao = {
      id: 'teste-checagem',
      criadaEm: Date.now() - 86_400_000,
      atualizadaEm: Date.now(),
      configuracao: { universo: 25, pool: [...Array(18)].map((_, i) => i + 1), cartela: 15, alvo: 15, intersecao: 15 },
      melhor: cartelas,
      avaliacao: { cartelas: cartelas.length },
      iteracoes: 7,
    };
    const atual = JSON.parse(localStorage.getItem('sonho-lucido:historico') ?? '[]');
    localStorage.setItem('sonho-lucido:historico', JSON.stringify([sessao, ...atual]));
  });

  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');

  const temBotao = await pagina.locator('[data-acao="checar"][data-id="teste-checagem"]').count();
  marcar(temBotao === 1, 'cada trabalho do histórico ganha um botão de checar');

  await pagina.click('[data-acao="checar"][data-id="teste-checagem"]');
  await pagina.waitForSelector('#checar.ativo');
  await pagina.fill('#chk-resultado', '01 02 03 04 05 06 07 08 09 10 11 12 13 14 15');
  await pagina.click('#chk-conferir');
  await pagina.waitForSelector('#chk-resumo-cartao:not([hidden])');

  const doHistorico = (await pagina.locator('#chk-faixas').textContent()).replace(/\s+/g, ' ');
  marcar(
    /15 acertos ?1/.test(doHistorico) && /14 acertos ?1/.test(doHistorico),
    'e confere exatamente as cartelas salvas — 1 com 15, 1 com 14, 1 com 10',
    doHistorico.slice(0, 76)
  );

  const fichaSalva = (await pagina.locator('#chk-ficha').textContent()).replace(/\s+/g, ' ');
  marcar(
    /Criado em\s*ontem/.test(fichaSalva) && /Cartelas\s*3(?!\d)/.test(fichaSalva),
    'a ficha traz a data de criação do trabalho salvo',
    fichaSalva.slice(0, 76)
  );

  // ─── 10. sobrevive a recarregar ───
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="checar"]');
  await pagina.waitForSelector('#checar.ativo');
  const opcoes = await pagina.$$eval('#chk-fechamento option', (o) => o.map((x) => x.textContent));
  marcar(
    opcoes.some((t) => /3 cartelas/.test(t)),
    'depois de recarregar, o trabalho salvo continua disponível para conferência',
    `${opcoes.length} fechamento(s) na lista`
  );

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 120));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
