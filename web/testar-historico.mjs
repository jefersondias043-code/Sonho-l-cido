/*
 * Teste do histórico de trabalhos.
 *
 * Verifica a promessa central: nenhum trabalho se perde, e dá para voltar a
 * qualquer um deles e continuar de onde parou.
 *
 * Quatro exigências, cada uma verificada de ponta a ponta num navegador:
 *
 *   1. toda busca é salva sozinha, sem o usuário pedir;
 *   2. buscas diferentes viram registros diferentes — a nova não apaga a velha,
 *      que era exatamente o defeito da versão anterior;
 *   3. continuar um trabalho retoma do ponto em que parou e **atualiza aquele
 *      mesmo registro**, em vez de espalhar cópias quase idênticas;
 *   4. excluir um trabalho não leva os outros junto.
 *
 *   ./construir-web.sh && node web/testar-historico.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8129;
const BASE = '/Sonho-l-cido/';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function servir() {
  const servidor = createServer(async (req, res) => {
    try {
      let caminho = decodeURIComponent(req.url.split('?')[0]);
      if (!caminho.startsWith(BASE)) return res.writeHead(404).end('fora da base');
      caminho = caminho.slice(BASE.length - 1);
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

const passos = [];
function marcar(certo, descricao, detalhe = '') {
  passos.push({ certo, descricao });
  console.log(`${certo ? '  ✓' : '  ✗'} ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
}

await mkdir(new URL('../capturas/', import.meta.url).pathname, { recursive: true });
const servidor = await servir();
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ ...devices['iPhone 13'] });
const pagina = await contexto.newPage();

const errosDeConsole = [];
pagina.on('console', (m) => m.type() === 'error' && errosDeConsole.push(m.text()));
pagina.on('pageerror', (e) => errosDeConsole.push(String(e)));

/** As sessões como estão gravadas no aparelho. */
const sessoesGravadas = () =>
  pagina.evaluate(() => {
    const bruto = localStorage.getItem('sonho-lucido:historico');
    return bruto ? JSON.parse(bruto) : [];
  });

/**
 * Carrega um fechamento da Lotinha e espera a busca registrar uma solução.
 *
 * As dezenas são sempre as `pool` primeiras: quais são não muda nada aqui — o
 * fechamento vem do banco em posições, e o histórico grava a configuração, não
 * a sorte de quem escolheu.
 */
async function buscar({ pool, jogo }) {
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.waitForSelector('#lotinha.ativo');
  await pagina.click(`#lot-pool .opcao[data-pool="${pool}"]`);
  await pagina.click('#lot-limpar');
  for (let n = 1; n <= pool; n++) await pagina.click(`#lot-grade .numero[data-n="${n}"]`);
  await pagina.click(`#lot-jogo .opcao[data-jogo="${jogo}"]`);
  // O estágio 0 roda em um segundo aqui: o que se testa é que ele acontece e
  // entrega, não quanto ele consegue achar com tempo de verdade.
  await pagina.evaluate(() => {
    const campo = document.getElementById('segundos-construtor');
    if (campo) campo.value = '1';
  });
  await pagina.click('#lot-iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 30000 });
  await esperarSolucao();
}

/** Espera até existir um número de cartelas na tela. */
async function esperarSolucao() {
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('melhor-cartelas').textContent.trim();
      return t !== '' && t !== '—' && Number(t) > 0;
    },
    undefined,
    { timeout: 40000 }
  );
}

async function encerrar() {
  await pagina.click('.aba[data-painel="buscar"]');
  await pagina.click('#encerrar');
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 15000 });
}

console.log('Teste do histórico de trabalhos\n');

try {
  await pagina.goto(`http://localhost:${PORTA}${BASE}`, { waitUntil: 'networkidle' });
  await pagina.evaluate(() => localStorage.clear());
  await pagina.reload({ waitUntil: 'networkidle' });

  // ─── começa vazio ───
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  marcar(
    (await pagina.locator('.historico-vazio').count()) === 1,
    'sem trabalhos, a tela explica que ainda não há nada'
  );

  // ─── 1. toda busca é salva sozinha ───
  await buscar({ pool: 18, jogo: 17 });
  await encerrar();

  let sessoes = await sessoesGravadas();
  marcar(sessoes.length === 1, 'a busca é salva sem o usuário pedir', `${sessoes.length} registro`);
  marcar(
    sessoes[0].melhor.length > 0 && sessoes[0].melhor.every((c) => c.length === 17),
    'o registro guarda os jogos de verdade',
    `${sessoes[0].melhor.length} jogos de 17 dezenas`
  );

  // ─── 2. uma busca nova não apaga a anterior ───
  //
  // Era exatamente o defeito da versão anterior: existia um único espaço de
  // gravação, e começar outro trabalho apagava o primeiro sem aviso.
  await buscar({ pool: 19, jogo: 17 });
  await encerrar();

  sessoes = await sessoesGravadas();
  marcar(
    sessoes.length === 2,
    'uma busca nova não apaga a anterior',
    `${sessoes.length} registros guardados`
  );

  const configuracoes = sessoes.map((s) => s.configuracao.pool.length).sort();
  marcar(
    configuracoes.join(',') === '18,19',
    'cada registro guarda a própria configuração',
    `pools ${configuracoes.join(' e ')}`
  );

  // ─── 3. continuar retoma e atualiza o mesmo registro ───
  //
  // Usa um fechamento cujo mínimo é problema em aberto, para que continuar
  // tenha mesmo o que melhorar. Vinte dezenas com jogos de 17: 240 jogos, piso
  // conhecido 160, e ninguém no mundo sabe o mínimo — o motor não vai provar
  // nada ali e segue rodando enquanto deixarem.
  await buscar({ pool: 20, jogo: 17 });
  await pagina.waitForTimeout(2500);
  await encerrar();

  sessoes = await sessoesGravadas();
  const antes = sessoes.find((s) => s.configuracao.pool.length === 20);
  marcar(!!antes, 'o trabalho longo também foi salvo', `${antes?.melhor.length} jogos`);

  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  marcar(
    (await pagina.locator('.sessao').count()) === 3,
    'os três trabalhos aparecem na lista'
  );
  await pagina.screenshot({ path: 'capturas/captura-historico.png' });

  // Continua justamente o trabalho de 20 dezenas.
  const posicao = await pagina.evaluate((id) => {
    const botoes = [...document.querySelectorAll('[data-acao="continuar"]')];
    return botoes.findIndex((b) => b.dataset.id === id);
  }, antes.id);
  await pagina.locator('[data-acao="continuar"]').nth(posicao).click();

  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });
  await esperarSolucao();

  // A contagem de iterações precisa continuar de onde parou, não zerar.
  const iteracoesNaRetomada = await pagina.evaluate(() =>
    Number(document.getElementById('iteracoes').textContent.replace(/\D/g, ''))
  );
  marcar(
    iteracoesNaRetomada >= (antes.iteracoes ?? 0),
    'a retomada continua a contagem em vez de zerar',
    `parou em ${antes.iteracoes}, retomou em ${iteracoesNaRetomada}`
  );

  await pagina.waitForTimeout(3000);
  await encerrar();

  sessoes = await sessoesGravadas();
  marcar(
    sessoes.length === 3,
    'continuar atualiza o registro, não cria um segundo',
    `${sessoes.length} registros`
  );

  const depois = sessoes.find((s) => s.id === antes.id);
  marcar(!!depois, 'o registro continuado manteve a mesma identidade');
  marcar(
    depois.iteracoes > antes.iteracoes,
    'o trabalho continuado avançou',
    `${antes.iteracoes} → ${depois.iteracoes} iterações`
  );
  marcar(
    depois.melhor.length <= antes.melhor.length,
    'a solução só pode ter melhorado',
    `${antes.melhor.length} → ${depois.melhor.length} jogos`
  );
  marcar(
    depois.criadaEm === antes.criadaEm && depois.atualizadaEm > antes.atualizadaEm,
    'a data de criação é preservada e a de atualização avança'
  );

  // ─── ver as cartelas de um trabalho salvo ───
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  await pagina.locator('[data-acao="ver"]').first().click();
  await pagina.waitForSelector('#resultado.ativo', { timeout: 10000 });
  marcar(
    (await pagina.locator('#lista-cartelas .cartela').count()) > 0,
    'dá para ver as cartelas de um trabalho salvo sem retomá-lo'
  );

  // ─── 4. excluir um não leva os outros ───
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  pagina.once('dialog', (d) => d.accept());
  await pagina.locator('[data-acao="excluir"]').first().click();
  await pagina.waitForFunction(() => document.querySelectorAll('.sessao').length === 2, undefined, {
    timeout: 10000,
  });

  sessoes = await sessoesGravadas();
  marcar(sessoes.length === 2, 'excluir remove só o trabalho escolhido', `restaram ${sessoes.length}`);

  // ─── sobrevive a fechar e reabrir ───
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  marcar(
    (await pagina.locator('.sessao').count()) === 2,
    'o histórico sobrevive a fechar e reabrir o aplicativo'
  );

  // ─── quando o aparelho fica sem espaço, quem perde trabalho fica sabendo ───
  //
  // O histórico abre espaço descartando os mais antigos, e essa é a escolha
  // certa: perder o que se está fazendo agora seria pior. O que estava errado
  // era fazer isso calado. Um fechamento de 23 dezenas com jogos de 17 ocupa
  // meio megabyte, oito enchem o armazenamento de um iPhone, e o nono comia os
  // primeiros sem uma palavra — a pessoa só descobria ao ir procurar.
  const semEspaco = await pagina.evaluate(async () => {
    const h = await import('./historico.js');
    h.limpar();
    const recados = [];
    // O registro devolve como desfazer só o dele: o aviso que o aplicativo
    // registrou na partida continua de pé, e é o que a próxima verificação usa.
    const parar = h.quandoFaltarEspaco((r) => recados.push(r));
    // Cartelas grandes de propósito: é assim que se chega ao limite sem esperar
    // uma busca de verdade.
    const gordas = Array.from({ length: 11546 }, () =>
      Array.from({ length: 17 }, (_, i) => i + 1)
    );
    const config = { pool: Array.from({ length: 23 }, (_, i) => i + 1), cartela: 17 };
    let criadas = 0;
    for (let i = 0; i < 14 && !recados.length; i++) {
      h.criar(config, { melhor: gordas });
      criadas++;
    }
    const guardadas = h.quantidade();
    parar();
    h.limpar();
    return { criadas, guardadas, recados };
  });
  marcar(
    semEspaco.recados.length > 0,
    'o histórico avisa quando precisa descartar trabalhos por falta de espaço',
    `${semEspaco.criadas} gravados, ${semEspaco.guardadas} couberam, ${semEspaco.recados.length} aviso(s)`
  );
  marcar(
    semEspaco.recados.every((r) => r.descartadas > 0 && typeof r.guardou === 'boolean'),
    'e diz quantos saíram e se o novo entrou',
    JSON.stringify(semEspaco.recados[0] ?? null)
  );

  // O aviso chega até a tela: é o mesmo caminho, e é o que a pessoa vê.
  const naTela = await pagina.evaluate(async () => {
    const h = await import('./historico.js');
    h.limpar();
    const gordas = Array.from({ length: 11546 }, () =>
      Array.from({ length: 17 }, (_, i) => i + 1)
    );
    const config = { pool: Array.from({ length: 23 }, (_, i) => i + 1), cartela: 17 };
    const caixa = document.getElementById('aviso');
    for (let i = 0; i < 14 && caixa.hidden; i++) h.criar(config, { melhor: gordas });
    const texto = caixa.textContent;
    h.limpar();
    return { aparecido: !caixa.hidden, texto };
  });
  marcar(
    naTela.aparecido && /espaço/i.test(naTela.texto),
    'e o aviso chega à tela, em vez de morrer no módulo',
    naTela.texto.slice(0, 70)
  );

  /** O número que está num elemento da tela, sem a pontuação de milhar. */
  const numero = async (seletor) =>
    Number((await pagina.locator(seletor).textContent()).replace(/\D/g, ''));

  // ─── o sistema encerra a página, e o trabalho não se perde ───
  //
  // É o caso que o modo automático de horas existe para sobreviver: o iPhone
  // encerra a página por bateria, memória ou tempo em segundo plano, e o
  // aplicativo não tem chance nenhuma de anotar que parou. O que sobra é o que
  // ficou gravado — e é isso que precisa bastar.
  await pagina.evaluate(() => localStorage.clear());
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.waitForSelector('#lotinha.ativo');
  await pagina.click('#lot-pool .opcao[data-pool="18"]');
  await pagina.click('#lot-limpar');
  for (const n of [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 24, 25]) {
    await pagina.click(`#lot-grade .numero[data-n="${n}"]`);
  }
  // O estágio 0 roda em um segundo aqui: o que se testa é que ele acontece e
  // entrega, não quanto ele consegue achar com tempo de verdade.
  await pagina.evaluate(() => {
    const campo = document.getElementById('segundos-construtor');
    if (campo) campo.value = '1';
  });
  await pagina.click('#lot-iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 30000 });
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('melhor-cartelas').textContent.trim();
      return t !== '' && t !== '—';
    },
    undefined,
    { timeout: 30000 }
  );
  await pagina.waitForTimeout(1500);

  const gravado = await pagina.evaluate(() => {
    const bruto = JSON.parse(localStorage.getItem('sonho-lucido:historico') ?? '[]');
    return bruto[0] ?? null;
  });
  marcar(
    gravado?.emCurso === true,
    'enquanto o motor roda, fica gravado que há trabalho em andamento',
    `emCurso: ${gravado?.emCurso}`
  );
  marcar(
    Number(gravado?.motor?.iteracoes) > 0 && Number(gravado?.motor?.alvo_cartelas) > 0,
    'e o estado do motor é gravado junto, não só as cartelas',
    `${gravado?.motor?.iteracoes} iterações · meta ${gravado?.motor?.alvo_cartelas}`
  );

  // O encerramento pelo sistema: a página some sem despedida.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  await pagina.waitForSelector('#cartao-interrompido:not([hidden])', { timeout: 10000 });
  const resumo = (await pagina.locator('#resumo-interrompido').textContent()).replace(/\s+/g, ' ');
  marcar(
    /o motor estava trabalhando quando o aplicativo fechou/.test(resumo) &&
      /iterações/.test(resumo),
    'ao reabrir, o aplicativo reconhece o trabalho interrompido e mostra onde parou',
    resumo.slice(0, 90)
  );

  await pagina.click('#retomar-interrompido');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 30000 });
  await pagina.waitForFunction(
    () => Number(document.getElementById('iteracoes').textContent.replace(/\D/g, '')) > 0,
    undefined,
    { timeout: 30000 }
  );
  marcar(
    (await numero('#iteracoes')) >= Number(gravado.motor.iteracoes),
    'e retomar continua das iterações gravadas, em vez de recomeçar',
    `gravadas ${gravado.motor.iteracoes}, retomadas ${await numero('#iteracoes')}`
  );

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 20000 });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForTimeout(400);
  marcar(
    await pagina.locator('#cartao-interrompido').isHidden(),
    'e encerrar de propósito não deixa o aviso de interrupção para trás',
    'cartão escondido'
  );

  // ─── a sessão atravessa para outro aparelho ───
  //
  // A promessa inteira do arquivo: dez horas de motor num aparelho continuam
  // sendo dez horas no outro. O que se prova aqui é que o arquivo carrega a
  // sessão e não as cartelas — e que importar não encosta no que já existe.
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.waitForSelector('#lotinha.ativo');
  await pagina.click('#lot-pool .opcao[data-pool="20"]');
  await pagina.click('#lot-limpar');
  for (let n = 1; n <= 20; n++) await pagina.click(`#lot-grade .numero[data-n="${n}"]`);
  await pagina.click('#lot-jogo .opcao[data-jogo="17"]');
  // O estágio 0 roda em um segundo aqui: o que se testa é que ele acontece e
  // entrega, não quanto ele consegue achar com tempo de verdade.
  await pagina.evaluate(() => {
    const campo = document.getElementById('segundos-construtor');
    if (campo) campo.value = '1';
  });
  await pagina.click('#lot-iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 30000 });
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('melhor-cartelas').textContent.trim();
      return t !== '' && t !== '—';
    },
    undefined,
    { timeout: 30000 }
  );
  await pagina.waitForTimeout(2500);

  // A exportação não pausa nada: o motor segue rodando enquanto o arquivo sai.
  const arquivo = await pagina.evaluate(async () => {
    const capturado = { nome: null, texto: null };
    // Intercepta a entrega para pegar o arquivo sem depender de download nem de
    // compartilhamento — o que se está testando é o conteúdo, não o encanamento
    // do sistema operacional.
    const criarOriginal = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      capturado.blob = blob;
      return criarOriginal.call(URL, blob);
    };
    const cliqueOriginal = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      capturado.nome = this.download;
    };
    document.getElementById('exportar-sessao').click();
    for (let i = 0; i < 100 && !capturado.blob; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    HTMLAnchorElement.prototype.click = cliqueOriginal;
    URL.createObjectURL = criarOriginal;
    capturado.texto = capturado.blob ? await capturado.blob.text() : null;
    delete capturado.blob;
    return capturado;
  });

  marcar(
    typeof arquivo.texto === 'string' && arquivo.texto.length > 100,
    'exportar entrega um arquivo com o motor ainda rodando',
    `${arquivo.nome} · ${arquivo.texto ? Math.round(arquivo.texto.length / 1024) : 0} KB`
  );

  const dentro = JSON.parse(arquivo.texto);
  const m = dentro.sessao?.motor ?? {};
  marcar(
    dentro.aplicativo === 'sonho-lucido/sessao' &&
      Array.isArray(dentro.sessao?.melhor) &&
      dentro.sessao.melhor.length > 0 &&
      Array.isArray(dentro.sessao?.atual) &&
      dentro.sessao.atual.length > 0,
    'e o arquivo traz o recorde e a solução em curso, não só as cartelas',
    `${dentro.sessao?.melhor?.length} no recorde, ${dentro.sessao?.atual?.length} em curso`
  );
  marcar(
    m.iteracoes > 0 && m.alvo_cartelas > 0 && (m.pesos_dos_operadores ?? []).length > 1,
    'e traz o trabalho do motor: iterações, meta perseguida e pesos aprendidos',
    `${m.iteracoes} iterações · meta ${m.alvo_cartelas} · ${
      (m.pesos_dos_operadores ?? []).length
    } pesos`
  );

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 20000 });

  // O outro aparelho: histórico zerado, nada em comum além do arquivo.
  await pagina.evaluate(() => localStorage.clear());
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  const antesDeImportar = await pagina.locator('.sessao').count();

  await pagina.setInputFiles('#arquivo-sessao', {
    name: arquivo.nome,
    mimeType: 'application/json',
    buffer: Buffer.from(arquivo.texto),
  });
  await pagina.waitForSelector('#confirmar-importacao', { timeout: 10000 });
  const previa = (await pagina.locator('#previa-importacao').textContent()).replace(/\s+/g, ' ');
  marcar(
    /iterações/.test(previa) && /cartelas de 17 dezenas/.test(previa),
    'a tela descreve a sessão antes de abrir, e espera confirmação',
    previa.slice(0, 90)
  );

  await pagina.click('#confirmar-importacao');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 30000 });
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('iteracoes').textContent.replace(/\D/g, '');
      return t !== '' && Number(t) > 0;
    },
    undefined,
    { timeout: 30000 }
  );
  const aoRetomar = await numero('#iteracoes');
  marcar(
    aoRetomar >= m.iteracoes,
    'e o motor retoma com as iterações da sessão, em vez de recomeçar do zero',
    `gravadas ${m.iteracoes}, retomadas ${aoRetomar}`
  );
  marcar(
    (await numero('#melhor-cartelas')) <= dentro.sessao.melhor.length,
    'e o recorde importado é o ponto de partida, não um recomeço',
    `${await numero('#melhor-cartelas')} contra ${dentro.sessao.melhor.length} no arquivo`
  );

  // Depois de importar há o estágio 0 antes da busca: esperar pelo número
  // subindo, e não por um relógio fixo, é o que torna este teste independente de
  // quanto o construtor demora.
  await pagina.waitForFunction(
    (antes) => Number(document.getElementById('iteracoes').textContent.replace(/\D/g, '')) > antes,
    aoRetomar,
    { timeout: 30000 }
  );
  marcar(true, 'e o trabalho novo soma ao que veio no arquivo', `${aoRetomar} → ${await numero('#iteracoes')}`);

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 20000 });
  await pagina.click('.aba[data-painel="historico"]');
  marcar(
    (await pagina.locator('.sessao').count()) === antesDeImportar + 1,
    'a sessão importada entra como trabalho novo, sem encostar no que já existia',
    `${antesDeImportar} antes, ${await pagina.locator('.sessao').count()} depois`
  );

  // Um arquivo estragado não pode desmontar nada.
  await pagina.setInputFiles('#arquivo-sessao', {
    name: 'quebrado.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"aplicativo":"sonho-lucido/sessao","formato":1,"sessao":{}}'),
  });
  await pagina.waitForTimeout(400);
  const recusa = (await pagina.locator('#previa-importacao').textContent()).replace(/\s+/g, ' ');
  marcar(
    /não pôde ser aberta/.test(recusa) && /Nada neste aparelho foi alterado/.test(recusa),
    'um arquivo sem sessão dentro é recusado dizendo o que houve, sem mexer em nada',
    recusa.slice(0, 80)
  );

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 140));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
