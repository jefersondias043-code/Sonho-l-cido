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
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';

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
const contexto = await navegador.newContext({
  ...devices['iPhone 13'],
  // Exportar um fechamento entrega um arquivo, e sem isto o Playwright o recusa.
  acceptDownloads: true,
});
const pagina = await contexto.newPage();

const errosDeConsole = [];
pagina.on('console', (m) => m.type() === 'error' && errosDeConsole.push(m.text()));
pagina.on('pageerror', (e) => errosDeConsole.push(String(e)));
// Excluir e apagar tudo pedem confirmação. Aceitar é o caminho que o teste quer.
pagina.on('dialog', (caixa) => caixa.accept());

const texto = (sel) => pagina.textContent(sel).then((t) => (t ?? '').replace(/\s+/g, ' ').trim());
const numero = async (sel) => Number((await texto(sel)).replace(/\D/g, ''));

/** Define o universo e marca exatamente estes números na grade. */
/*
 * O pedido inteiro, guardado aqui.
 *
 * O Construtor Exato tinha uma tela só sua, com uma grade própria e quatro
 * fileiras de opção próprias. Ela saiu: os cinco números moram agora nos
 * mesmos controles que a ferramenta já usava para tudo. Como um deles depende
 * do outro — o sorteio decide que pools existem, o pool decide que jogos
 * existem, o jogo decide que garantias existem —, o pedido é guardado inteiro e
 * aplicado sempre na mesma ordem. Aplicar peça por peça, na ordem em que os
 * testes pedem, deixaria a tela num estado que ela nunca teria sozinha.
 */
const pedidoDaTela = {
  universo: 25,
  numeros: Array.from({ length: 18 }, (_, i) => i + 1),
  jogo: 17,
  sorteio: 15,
  garantia: 15,
  premiadas: 1,
};

async function aplicarOPedido() {
  const p = pedidoDaTela;
  // Montar o pedido é coisa da primeira aba, e uma corrida anterior deixou a
  // tela na aba da busca. Sem voltar, os campos existem e estão invisíveis.
  await pagina.click('#aba-lotinha');
  await pagina.evaluate(() => {
    const d = document.getElementById('lot-avancado');
    if (d) d.open = true;
  });
  await pagina.fill('#lot-universo', String(p.universo));
  await pagina.waitForTimeout(120);
  await pagina.fill('#lot-sorteio', String(p.sorteio));
  await pagina.waitForTimeout(120);

  await pagina.click(`#lot-pool .opcao[data-pool="${p.numeros.length}"]`);
  await pagina.waitForTimeout(80);

  // A grade guarda a seleção anterior; limpar antes é o que faz o pedido ser o
  // que está escrito, e não a soma dele com o do teste passado.
  await pagina.click('#lot-limpar');
  for (const n of p.numeros) {
    await pagina.click(`#lot-grade .numero[data-n="${n}"]`);
  }

  await pagina.click(`#lot-jogo .opcao[data-jogo="${p.jogo}"]`);
  await pagina.waitForTimeout(80);
  await pagina.click(`#lot-garantia .opcao[data-garantia="${p.garantia}"]`);
  await pagina.waitForTimeout(80);
  /*
   * As premiadas são clicadas **sempre**, inclusive quando são uma.
   *
   * Estava `if (p.premiadas > 1)`, e o 1 é o padrão: pedir uma depois de um
   * teste que pediu duas não desfazia nada, e a tela seguia com duas. O teste
   * seguinte resolvia 20 dezenas com jogos de 17 e duas cartelas premiadas
   * acreditando estar resolvendo com uma — um problema muito maior, com outro
   * piso, que não fecha nos segundos que ele esperava. O sintoma aparecia num
   * teste que não tinha nada a ver com premiadas.
   */
  await pagina.click(`#lot-premiadas .opcao[data-premiadas="${p.premiadas}"]`);
  await pagina.waitForTimeout(80);
}

/*
 * As dezenas e o universo, anotados — e só.
 *
 * Aplicar aqui não daria certo: o sorteio ainda é o do teste anterior, e é ele
 * que decide quais pools a tela oferece. Marcar nove dezenas com o sorteio em
 * 15 pediria um pool de 9 numa fileira que começa em 15. O pedido só faz
 * sentido inteiro, e é `regras` — sempre a próxima chamada — que o aplica.
 */
async function marcarNumeros(universo, numeros) {
  pedidoDaTela.universo = universo;
  pedidoDaTela.numeros = numeros;
  // Um pedido novo zera as premiadas: elas não atravessam de um teste ao outro,
  // e o botão delas nem sempre existe no pedido seguinte.
  pedidoDaTela.premiadas = 1;
}

async function regras(jogo, sorteio, garantia, premiadas = 1) {
  Object.assign(pedidoDaTela, { jogo, sorteio, garantia, premiadas });
  await aplicarOPedido();
}

/*
 * Manda resolver, sempre pelo motor exato.
 *
 * `#lot-iniciar` roteia: banco, fórmula, motor exato. Onde o banco responde —
 * a Lotinha canônica, que vários casos daqui usam — o motor exato nunca
 * entraria, e é ele que esta suíte existe para cobrar. `#lot-provar` é a porta
 * que o chama de propósito, e ela nasce escondida até haver pedido montado.
 */
async function resolver() {
  await pagina.click('#lot-iniciar');
  // Onde nada pronto responde, o motor exato já assumiu sozinho e os cartões
  // dele estão na tela: pedir de novo começaria uma segunda corrida por cima da
  // primeira. Onde o banco ou a fórmula responderam, é este botão que o chama.
  try {
    await pagina.waitForSelector('#grupo-exato:not([hidden])', { timeout: 2500 });
    return;
  } catch {
    /* o banco respondeu: a prova é pedida à mão */
  }
  // Nos casos leves a busca estocástica já partiu e levou a tela junto; o botão
  // da prova ficou na primeira aba, que é onde o pedido se monta.
  await pagina.click('#aba-lotinha');
  await pagina.waitForSelector('#lot-provar:not([hidden])', { timeout: 30000 });
  await pagina.click('#lot-provar');
  await pagina.waitForSelector('#grupo-exato:not([hidden])', { timeout: 30000 });
}

/** A altura do cartão de resultado, que é o que empurra o resto para baixo. */
async function alturaDoResultado() {
  const caixa = await pagina.locator('#ex-resultado-cartao').boundingBox();
  return Math.round(caixa.height);
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
  // ─── 1. a tela abre ───
  //
  // Havia aqui um teste do lançador com os três aplicativos. O lançador saiu
  // junto com eles: a raiz **é** a ferramenta agora, e não um menu para
  // escolher entre três que faziam a mesma coisa.
  await pagina.goto(`http://localhost:${PORTA}/`, { waitUntil: 'networkidle' });
  // Esperar pelo HTML não basta: a grade e as fileiras são montadas pelo módulo
  // depois. Esperar por um número na grade é esperar pelo aplicativo pronto.
  await pagina.waitForSelector('#lot-grade .numero', { timeout: 20000 });
  marcar(true, 'a ferramenta abre');

  // ─── 3. o caso pequeno, onde a prova fecha ───
  //
  // Nove números, cartelas de 3, saem 2 e garante 2: é C(9,3,2), o sistema de
  // Steiner de ordem 9, com mínimo 12.
  await marcarNumeros(25, [3, 5, 7, 9, 11, 13, 15, 17, 19]);
  await regras(3, 2, 2);
  await pagina.selectOption('#ex-esforco', '1');
  await resolver();

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
  //
  // A lista completa fica fechada até alguém pedir, e esta verificação quer
  // varrer o fechamento inteiro — então ela pede.
  await pagina.click('#ex-ver-cartelas');
  await pagina.waitForTimeout(300);
  const primeira = await texto('#ex-previa .cartela:first-child');
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
  await resolver();

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
  // A frase mudou junto com a matemática: fora do covering design a cota de
  // Turán no avesso passou a valer, e é ela que dá o piso deste caso. Cobrar a
  // frase antiga seria cobrar que o aplicativo continue dizendo o que deixou de
  // ser verdade.
  marcar(
    /Schönheim não vale/.test(piso) && /avesso/.test(piso),
    'e explica qual cota vale fora do covering design, e por quê',
    piso.slice(-110)
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
  // O botão de parar é conferido **dentro** do laço. Com o piso certo este caso
  // fecha em décimos de segundo, e perguntar depois da corrida mediria o
  // instante errado: mede-se que ele esteve à mão enquanto havia o que parar.
  let pararEsteveAMao = false;
  for (let i = 0; i < 40; i += 1) {
    const agora = await texto('#ex-construcao');
    if (agora) leituras.add(agora);
    const cartelas = await numero('#ex-cartelas-agora');
    const teto = await numero('#ex-teto');
    if (teto > 0 && cartelas > teto) passouDoTeto = true;
    if (!(await pagina.locator('#ex-parar').isHidden())) pararEsteveAMao = true;
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
  marcar(pararEsteveAMao, 'e o botão de parar esteve à mão enquanto ela rodava');

  // Ela roda até mandarem parar — quando ainda há o que parar.
  //
  // Este bloco foi escrito quando esta configuração não terminava nunca: o piso
  // de garantia parcial vinha da cota de contagem, dava 2 onde o mínimo é 6, e
  // como a escalada usa o piso de teto o motor perseguia um alvo que a
  // matemática proíbe. Com a cota de Turán no avesso o piso ficou certo e o
  // caso fecha em décimos de segundo, no mínimo provado. Insistir no clique
  // seria cobrar que o aplicativo continue não terminando.
  // O clique é uma corrida contra a escalada: entre perguntar se o botão está à
  // mão e tocá-lo, ela pode ter fechado e o botão sumido. Sumir é o resultado
  // certo, então não tocar também é.
  await pagina
    .click('#ex-parar', { timeout: 1500 })
    .catch(() => {});
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
  await resolver();
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
  await resolver();
  await pagina.waitForFunction(
    () => Number(document.getElementById('ex-cartelas-agora').textContent.replace(/\D/g, '')) > 0,
    undefined,
    { timeout: 90000 }
  );
  /*
   * Esperar pelo texto, e não pelo relógio.
   *
   * Eram cinco segundos cravados, e eles bastavam quando a tela do Exato era a
   * única coisa rodando. Na ferramenta unificada o caminho até aqui passa pelo
   * banco — que responde primeiro — e por um motor de busca que sobe e é
   * desmontado quando a prova é pedida: os primeiros segundos do motor de
   * Turán deixaram de ser os primeiros segundos da página. O que se cobra
   * continua sendo o mesmo, e agora sem depender de quanto o resto demorou.
   */
  await pagina.waitForFunction(
    () => /Garantia cumprida com [\d.]+ cartelas/.test(
      document.getElementById('ex-construcao')?.textContent ?? ''
    ),
    undefined,
    { timeout: 90000 }
  );

  // Vinte dezenas com jogos de 17 é garantia cheia, então quem trabalha aqui é
  // o motor de Turán — e ele entrega um fechamento nos primeiros segundos em vez
  // de ficar reorganizando no piso. O que a tela precisa dizer é o que decide se
  // vale continuar esperando: qual é o número agora, qual é o piso, e que parar
  // devolve o que já vale.
  const durante = await texto('#ex-construcao');
  marcar(
    /Garantia cumprida com [\d.]+ cartelas/.test(durante),
    'com garantia cheia, o fechamento aparece em segundos e a tela diz o número',
    durante.slice(0, 60)
  );
  marcar(
    /parar devolve o melhor até aqui|Pode parar/.test(durante),
    'e diz que parar não perde o trabalho, para a espera ser uma escolha',
    durante.slice(-70)
  );

  await pagina.click('#ex-parar');
  await esperarResultado(120000);
  const guardado = await pagina.evaluate(() => {
    const bruto = localStorage.getItem('sonho-lucido:exato:historico');
    const lista = bruto ? JSON.parse(bruto) : [];
    const desta = lista.find((s) => s.pedido?.v === 20 && s.pedido?.t === 15);
    return desta
      ? { cartelas: desta.cartelasContadas, temEstado: Boolean(desta.escalada) }
      : null;
  });
  marcar(
    Boolean(guardado?.temEstado) && guardado.cartelas > 0,
    'o trabalho fica guardado no aparelho quando ela para, com o estado do motor junto',
    `${guardado?.cartelas} cartelas guardadas`
  );

  // A altura do cartão de resultado com um fechamento grande. Serve de
  // comparação para o caso pequeno, mais abaixo.
  const cartelasGrandes = await numero('#ex-encontrado');
  const alturaComMuitas = await alturaDoResultado();

  /*
   * A oferta de retomar deixou de ser um aviso embaixo do pedido.
   *
   * O Construtor Exato tinha o seu: `#ex-continuar` aparecia sob os parâmetros
   * quando os cinco números batiam com algum fechamento guardado. A ferramenta
   * já tinha o dela, e melhor — o cartão de trabalho interrompido, que aparece
   * na partida sem depender de a pessoa remontar o pedido —, e agora ele
   * conhece os dois motores. Manter os dois seria manter duas ofertas para a
   * mesma coisa, discordando uma da outra sempre que uma delas fosse esquecida.
   *
   * O que se cobra aqui é a promessa inteira: fechar o aplicativo no meio de
   * uma escalada e reabri-lo devolve o trabalho, com o número de cartelas que
   * estava lá.
   */
  // O trabalho parado com o botão é trabalho **encerrado**, e o histórico o
  // registra assim: ele aparece na lista, com Continuar à mão. Trabalho
  // *interrompido* é outra coisa — a página que some com o motor rodando — e é
  // do cartão da partida, verificado logo abaixo.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('#lot-grade .numero');
  await pagina.waitForTimeout(600);

  // O histórico guarda a linha, e ela é do motor exato: as duas origens
  // convivem numa lista só, ordenadas pelo último toque.
  await pagina.click('#aba-historico');
  await pagina.waitForTimeout(300);
  const linhasDoExato = await pagina
    .locator('#lista-historico [data-acao="ex-continuar"]')
    .count();
  marcar(
    linhasDoExato >= 1,
    'o trabalho parado fica no histórico único, ao lado dos da busca',
    `${linhasDoExato} linha(s) do motor exato`
  );
  marcar(
    (await pagina.locator('#lista-historico [data-acao="ex-abrir"]').count()) > 0
      && (await pagina.locator('#lista-historico [data-acao="ex-exportar"]').count()) > 0,
    'e a linha dele oferece abrir, continuar, checar e exportar'
  );


  // ─── 7a. a página some com o motor rodando ───
  //
  // A escalada grava o retrato do motor a cada quatro segundos justamente para
  // isto: fechar o aplicativo no meio não pode custar o trabalho já feito. O
  // cartão da partida é onde ele volta, e ele conhece os dois motores — cada um
  // guarda numa chave própria, e um cartão que só olhasse uma delas deixaria
  // metade do trabalho guardado para ninguém.
  //
  // Um pool grande de propósito: precisa continuar rodando na hora da recarga.
  await pagina.click('#aba-lotinha');
  await marcarNumeros(25, Array.from({ length: 22 }, (_, i) => i + 1));
  await regras(17, 15, 13);
  await resolver();
  await pagina.waitForFunction(
    () => !document.getElementById('ex-construcao-cartao').hidden,
    undefined,
    { timeout: 60000 }
  );
  // Sem parar: a página some enquanto ele trabalha, que é o caso real.
  await pagina.waitForTimeout(5000);
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('#lot-grade .numero');
  await pagina.waitForTimeout(1500);
  const cartaoDeVolta = await pagina.evaluate(() => {
    const c = document.getElementById('cartao-interrompido');
    return {
      aberto: c ? !c.hidden : false,
      motor: c?.dataset?.motor ?? '',
      texto: document.getElementById('resumo-interrompido')?.textContent ?? '',
    };
  });
  marcar(
    cartaoDeVolta.aberto && cartaoDeVolta.motor === 'exato',
    'reabrir o aplicativo devolve a escalada que ficou pela metade',
    `motor "${cartaoDeVolta.motor}", cartão ${cartaoDeVolta.aberto ? 'aberto' : 'fechado'}`
  );
  marcar(
    /motor exato/.test(cartaoDeVolta.texto) && /cartelas/.test(cartaoDeVolta.texto),
    'e diz de qual motor ela é, e quantas cartelas tinha',
    cartaoDeVolta.texto.replace(/\s+/g, ' ').slice(0, 90)
  );
  // O cartão mora na aba Histórico, que é onde os trabalhos salvos vivem.
  await pagina.click('#aba-historico');
  await pagina.click('#dispensar-interrompido');
  await pagina.waitForTimeout(200);
  marcar(
    (await pagina.locator('#cartao-interrompido').isHidden())
      && (await pagina.locator('#lista-historico [data-acao="ex-continuar"]').count()) > 0,
    'e "agora não" fecha a oferta sem apagar o trabalho'
  );

  // ─── 7a2. mexer no pedido no meio da corrida não pode voltar depois ───
  //
  // Trocar um dos cinco números limpa o fechamento da tela **e para o motor**.
  // E parar o motor faz ele terminar, e terminar avisa quem o chamou — que
  // repunha tudo o que o limpar tinha tirado.
  //
  // Medido antes da correção: 22 dezenas com jogos de 17 garantindo 13, motor
  // rodando, garantia trocada para 12. A tela ficava dizendo "ao menos 12
  // acertos" ao lado de "R$ 8,00 · 8 jogos" — o fechamento da garantia 13 —, e
  // a aba Checar oferecia esse fechamento para conferir e dividir. O pior tipo
  // de defeito que este aplicativo pode ter: duas afirmações verdadeiras sobre
  // pedidos diferentes, lado a lado, sem nada dizendo qual é qual.
  await pagina.click('#aba-lotinha');
  await marcarNumeros(25, Array.from({ length: 22 }, (_, i) => i + 1));
  await regras(17, 15, 13);
  await pagina.click('#lot-iniciar');
  await pagina.waitForSelector('#grupo-exato:not([hidden])', { timeout: 30000 });
  await pagina.waitForFunction(
    () => Number(document.getElementById('ex-cartelas-agora').textContent.replace(/\D/g, '')) > 0,
    undefined,
    { timeout: 60000 }
  );

  // A troca acontece com o motor vivo, que é o caso que importa.
  await pagina.click('#aba-lotinha');
  await pagina.click('#lot-garantia .opcao[data-garantia="12"]');
  await pagina.waitForTimeout(6000);

  const depoisDaTroca = await pagina.evaluate(() => ({
    checar: !document.getElementById('lot-checar').hidden,
    conferir: !document.getElementById('lot-conferir').hidden,
    economia: (document.getElementById('lot-economia')?.textContent ?? '').replace(/\s+/g, ' '),
    explicacao: (document.getElementById('lot-explicacao')?.textContent ?? '').replace(/\s+/g, ' '),
  }));
  marcar(
    !depoisDaTroca.checar && !depoisDaTroca.conferir,
    'trocar o pedido com o motor rodando não deixa o resultado antigo voltar',
    `checar ${depoisDaTroca.checar}, conferir ${depoisDaTroca.conferir}`
  );
  marcar(
    /ao menos 12/.test(depoisDaTroca.explicacao)
      && /piso conhecido|no mínimo/.test(depoisDaTroca.economia),
    'e a tela fala de um pedido só: o novo',
    depoisDaTroca.economia.slice(0, 80)
  );
  await pagina.click('#aba-checar');
  await pagina.waitForTimeout(400);
  marcar(
    (await pagina.$$eval('#chk-fechamento option', (o) => o.map((x) => x.value))).every(
      (v) => v !== 'lotinha'
    ),
    'e a aba Checar não oferece o fechamento do pedido que saiu de cena'
  );
  await pagina.click('#aba-lotinha');

  // ─── 7a3. checar um trabalho do histórico usa a régua dele ───
  //
  // O trabalho guardado passava pelo caminho do "fechamento carregado", que é
  // o da tela — e o seletor, a ficha e a **configuração** entregue ao
  // conferidor descrevem esse. Medido antes da correção, com a sessão de 22
  // dezenas guardada acima e a tela em outro pedido: a ficha dizia "jogos de
  // 17" numa linha e "dezenas por cartela" outra coisa duas linhas abaixo, e o
  // conferidor julgava o fechamento contra o universo e o sorteio da tela.
  //
  // Não era etiqueta errada: era régua errada.
  await pagina.click('#aba-lotinha');
  await marcarNumeros(25, Array.from({ length: 20 }, (_, i) => i + 1));
  await regras(17, 15, 15);
  await pagina.click('#aba-historico');
  await pagina.waitForTimeout(400);
  await pagina.click('#lista-historico [data-acao="ex-checar"]');
  await pagina.waitForTimeout(800);

  const fichaDoHistorico = await pagina.evaluate(() => ({
    rotulo: (document.querySelector('#chk-fechamento option:checked')?.textContent ?? '').trim(),
    ficha: (document.getElementById('chk-ficha')?.textContent ?? '').replace(/\s+/g, ' '),
  }));
  // A sessão guardada é a de 22 dezenas com jogos de 17 garantindo 13; a tela
  // está em 20 dezenas com jogos de 17 garantindo 15. O que a ficha diz tem de
  // ser o da sessão.
  marcar(
    /22 números/.test(fichaDoHistorico.rotulo) && /garante 13/.test(fichaDoHistorico.rotulo),
    'checar um trabalho do histórico o rotula com os números dele, não com os da tela',
    fichaDoHistorico.rotulo
  );
  // A tela está num pool de 20; a sessão, num de 22. "Dezenas usadas" acima de
  // 20 só pode ter vindo da sessão. (Sem espaço no padrão: `textContent` cola o
  // rótulo no valor, e foi assim que esta asserção falhou da primeira vez.)
  const usadas = Number(
    (fichaDoHistorico.ficha.match(/Dezenas usadas\s*(\d+)/) ?? [])[1] ?? 0
  );
  marcar(
    usadas > 20,
    'e a ficha inteira fala do mesmo fechamento, sem se contradizer',
    `dezenas usadas ${usadas}, com a tela num pool de 20`
  );
  await pagina.click('#aba-lotinha');

  // ─── 7b. os três estágios, cada um ligado à mão ───
  //
  // Numa configuração **pequena** em que o piso é comprovadamente inatingível:
  // 13 dezenas, jogos de 4, sorteios de 4, garantindo 2. São 715 sorteios a
  // cobrir, e o percurso inteiro — subir, esgotar o piso, construção avançada,
  // otimização — cabe em segundos.
  //
  // Antes isto rodava em 20 dezenas com jogos de 17: cinco minutos de relógio
  // para exercitar três botões. O tamanho não acrescentava nada ao que se
  // cobra aqui, que é o comportamento da tela; a qualidade do que o motor
  // constrói é medida onde ela se mede de verdade, contra os melhores
  // fechamentos publicados, em `crates/motor-exato/tests/qualidade.rs`.
  //
  // E o piso é lido da tela, não escrito à mão: o teste cobra a relação entre
  // os números — não passa do piso sozinha, passa quando mandam, nunca desce
  // abaixo dele — em vez de decorar um valor que muda se a fórmula melhorar.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('#lot-grade .numero');
  await marcarNumeros(13, Array.from({ length: 13 }, (_, i) => i + 1));
  await regras(4, 4, 2);
  await resolver();

  // O comando já está à mão, e o motor mal começou.
  //
  // Esta é a regressão do defeito que deixava a tela sem saída. A construção
  // avançada só era oferecida depois de a reorganização atravessar cinco mil
  // rodadas **seguidas** sem um ganho sequer; em 25 dezenas com jogos de 17 o
  // motor faz cinco rodadas por segundo, e qualquer melhora isolada zerava a
  // contagem. O botão não chegava nunca, justamente nas configurações grandes,
  // que são as que mais precisam dele.
  //
  // A verificação é pelo rótulo, e não pelo relógio: o rótulo só ganha o aviso
  // "o piso não está bastando" quando o motor esgota a paciência, que era a
  // única condição em que o botão aparecia antes. Vê-lo sem o aviso prova que
  // ele deixou de depender dela.
  await pagina.waitForSelector('#ex-avancar:not([hidden])', { timeout: 60000 });
  const rotuloCedo = await texto('#ex-avancar');
  marcar(
    rotuloCedo === 'Ativar construção avançada',
    'a construção avançada fica à mão antes de o motor dizer que o piso se esgotou',
    `${await numero('#ex-cartelas-agora')} cartelas · "${rotuloCedo}"`
  );

  const pisoDaEscalada = await numero('#ex-teto');
  marcar(pisoDaEscalada > 0, 'e o piso está na tela, para o resto ser comparado a ele', `piso ${pisoDaEscalada}`);

  // E não passa do piso enquanto ninguém mandar.
  await pagina.waitForTimeout(4000);
  marcar(
    (await numero('#ex-cartelas-agora')) <= pisoDaEscalada &&
      !(await pagina.locator('#ex-avancar').isHidden()),
    'e não passa do piso sozinha, por mais que ela continue trabalhando',
    `${await numero('#ex-cartelas-agora')} cartelas depois de 4 s esperando`
  );

  // O que o motor sabe vira conselho, e não porta: esgotada a paciência no
  // piso, o rótulo muda e a nota recomenda — mas o botão já estava lá.
  await pagina.waitForFunction(
    () => /não está bastando/.test(document.getElementById('ex-avancar')?.textContent ?? ''),
    undefined,
    { timeout: 60000 }
  );
  // E a barra para de parecer progresso quando deixou de ser progresso: cheia
  // e azul a 87% ela lê-se como "faltam 13%", e ali não falta nada — nenhuma
  // disposição daquele tamanho cobre tudo, e o motor acabou de demonstrar isso.
  marcar(
    await pagina.evaluate(() =>
      document.getElementById('ex-construcao-barra').classList.contains('parada')
    ),
    'e a barra deixa de parecer progresso, porque deixou de ser',
    await pagina.evaluate(() => document.getElementById('ex-construcao-barra').style.width)
  );

  marcar(
    /piso se esgotou/.test(await texto('#ex-comandos-nota')),
    'e quando o piso se esgota, a tela recomenda em vez de destrancar',
    (await texto('#ex-comandos-nota')).slice(0, 70)
  );

  await pagina.click('#ex-avancar');

  // ─── 7c. a otimização, também à mão, e valendo na hora ───
  //
  // O botão é tocado no **instante** em que aparece, que é o momento em que a
  // garantia acaba de ser cumprida e o resto do pipeline — verificação, prova —
  // ainda está correndo. Era exatamente aí que o toque não fazia nada: a tela
  // decidia pelo `rodando`, que segue verdadeiro durante aqueles estágios, e
  // levantava uma bandeira dentro do laço da escalada, que já tinha acabado.
  await pagina.waitForSelector('#ex-otimizar:not([hidden])', { timeout: 120000 });
  const rotuloOtimizar = await texto('#ex-otimizar');
  const cartelasAvancadas = Number(rotuloOtimizar.replace(/\D/g, ''));
  marcar(
    cartelasAvancadas > pisoDaEscalada,
    'cumprida a garantia acima do piso, a tela oferece apertar o número',
    rotuloOtimizar
  );

  await pagina.click('#ex-otimizar');
  await pagina.waitForFunction(
    () => /Otimizando/.test(document.getElementById('ex-construcao').textContent),
    undefined,
    { timeout: 60000 }
  );
  marcar(
    /Garantia cumprida com/.test(await texto('#ex-construcao')),
    'tocada no instante em que aparece, a otimização entra mesmo assim',
    (await texto('#ex-construcao')).slice(0, 90)
  );

  await pagina.waitForTimeout(8000);
  await pagina.click('#ex-parar');
  await esperarResultado(120000);
  const apertado = await numero('#ex-encontrado');
  marcar(
    apertado <= cartelasAvancadas && apertado >= pisoDaEscalada,
    'apertar reduz o número de cartelas, e nunca abaixo do piso',
    `${cartelasAvancadas} → ${apertado}, piso ${pisoDaEscalada}`
  );
  marcar(
    /Confere\./.test(await texto('#ex-verificacao')),
    'e o que sobra continua cumprindo a garantia — apertar nunca estraga o que já valia',
    (await texto('#ex-verificacao')).slice(0, 60)
  );

  const vereditoAvancado = await texto('#ex-frase');
  marcar(
    !/[Mm]ínimo exato/.test(vereditoAvancado) && vereditoAvancado.includes(String(pisoDaEscalada)),
    'e o resultado nunca é chamado de mínimo: mostra os dois números',
    vereditoAvancado
  );

  // ─── 7d. o motor de Turán, no caminho de garantia cheia ───
  //
  // O bloco acima corre com garantia parcial, que **não** tem a representação
  // complementar — e por isso exercita os três estágios manuais e os dois
  // botões, que continuam valendo ali.
  //
  // Aqui é o outro caminho, e ele não tem estágios. Com garantia cheia a
  // cartela precisa conter o sorteio inteiro, o problema vira um sistema de
  // Turán, e o motor entrega um fechamento no primeiro lote e vai baixando o
  // número. Não há o que ligar: o que se cobra é que o número apareça, que ele
  // não suba, que a garantia se cumpra, e que parar devolva o que valia.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('#lot-grade .numero');
  await marcarNumeros(11, Array.from({ length: 11 }, (_, i) => i + 1));
  await regras(8, 5, 5);
  await resolver();

  await pagina.waitForFunction(
    () => /Garantia cumprida|Fechou em 100%/.test(
      document.getElementById('ex-construcao')?.textContent ?? ''
    ),
    undefined,
    { timeout: 120000 }
  );
  const pisoDeTuran = await numero('#ex-teto');
  const primeiro = await numero('#ex-cartelas-agora');
  marcar(
    primeiro > 0,
    'com garantia cheia, o fechamento aparece sem ninguém ligar nada',
    `${primeiro} cartelas, piso ${pisoDeTuran}`
  );

  // E os botões dos três estágios não aparecem: não há estágio nenhum a ligar.
  marcar(
    (await pagina.locator('#ex-avancar').isHidden())
      && (await pagina.locator('#ex-otimizar').isHidden()),
    'e nenhum botão de estágio aparece, porque não há estágio a ligar'
  );

  await pagina.waitForTimeout(8000);
  await pagina.click('#ex-parar');
  await esperarResultado(180000);
  const porTuran = await numero('#ex-encontrado');
  marcar(
    porTuran <= primeiro && porTuran >= pisoDeTuran,
    'parar devolve um número que nunca subiu nem desceu abaixo do piso',
    `${primeiro} → ${porTuran}, piso ${pisoDeTuran}`
  );
  marcar(
    /Confere\./.test(await texto('#ex-verificacao')),
    'e o que ele entrega cobre todos os sorteios, conferido um a um',
    (await texto('#ex-verificacao')).slice(0, 60)
  );

  // ─── 7e. retomar não pode devolver o motor antigo ───
  //
  // O defeito que este bloco existe para não deixar voltar, e que só apareceu no
  // aparelho: a tela passa o trabalho guardado junto **mesmo quando alguém toca
  // em Resolver**, e retomar copiava a fase gravada por cima da que o motor novo
  // tinha escolhido. Resultado: toda configuração já trabalhada rodava o motor
  // velho, com o carimbo da versão nova na tela.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('#lot-grade .numero');
  await marcarNumeros(11, Array.from({ length: 11 }, (_, i) => i + 1));
  await regras(8, 5, 5);
  // O trabalho desta configuração está guardado — foi 7d que o guardou — e o
  // que se cobra aqui é o oposto de retomá-lo: mandar resolver de novo tem de
  // dar o motor novo, e não a fase gravada por cima dele.
  const guardadoAntes = await pagina.evaluate(() =>
    Object.keys(localStorage).some((c) => c.includes('exato'))
  );
  marcar(guardadoAntes, 'há trabalho guardado desta configuração no aparelho');

  await resolver();
  await pagina.waitForFunction(
    () => /Garantia cumprida|Fechou em 100%/.test(
      document.getElementById('ex-construcao')?.textContent ?? ''
    ),
    undefined,
    { timeout: 120000 }
  );
  marcar(
    (await pagina.locator('#ex-avancar').isHidden())
      && (await pagina.locator('#ex-otimizar').isHidden()),
    'e resolver de novo continua no motor novo, sem os botões dos estágios',
    (await texto('#ex-construcao')).slice(0, 60)
  );

  await pagina.click('#ex-parar');
  await esperarResultado(180000);
  marcar(
    /Confere\./.test(await texto('#ex-verificacao')),
    'e o que ele entrega ao retomar cobre tudo',
    (await texto('#ex-verificacao')).slice(0, 50)
  );

  // ─── 10. o histórico: guardar, abrir, exportar, importar ───
  //
  // A promessa do pedido, e a única que importa aqui: **abrir um fechamento
  // salvo devolve exatamente a quantidade de cartelas que estava registrada, e
  // retoma daquele estado.**
  /*
   * Quantas cartelas o motor acabou de entregar, lidas da tela.
   *
   * Estava escrito 16 à mão, do caso que a suíte resolvia antes desta seção. O
   * caso mudou junto com a unificação, e um número decorado teria mandado a
   * seção inteira falhar por estar certa. O que se cobra é a relação — a linha
   * do histórico diz o mesmo que o resultado disse — e não um valor.
   */
  const cartelasDoResultado = await numero('#ex-encontrado');

  await pagina.click('#aba-historico');
  const linhas = await pagina.locator('#lista-historico .sessao').count();
  marcar(
    linhas >= 1,
    'o fechamento resolvido aparece no histórico, sem ninguém pedir',
    `${linhas} no histórico`
  );

  const cartelasNaLinha = await pagina
    .locator('#lista-historico .sessao .sessao-quantia')
    .first()
    .textContent();
  marcar(
    Number(cartelasNaLinha.replace(/\D/g, '')) === cartelasDoResultado,
    'e a linha diz quantas cartelas ele tem — o mesmo número do resultado',
    `${cartelasNaLinha} na linha, ${cartelasDoResultado} no resultado`
  );
  marcar(
    /11 números · jogos de 8 · garante 5/.test(await texto('#lista-historico .sessao-config')),
    'com as regras que o produziram, em português',
    (await texto('#lista-historico .sessao-config')).slice(0, 70)
  );

  // Exportar: o arquivo tem de sair, e tem de trazer o fechamento inteiro.
  const [entregue] = await Promise.all([
    pagina.waitForEvent('download', { timeout: 20000 }),
    pagina.click('#lista-historico [data-acao="ex-exportar"]'),
  ]);
  const caminhoDoArquivo = join(tmpdir(), entregue.suggestedFilename());
  await entregue.saveAs(caminhoDoArquivo);
  const exportado = JSON.parse(await readFile(caminhoDoArquivo, 'utf8'));
  marcar(
    exportado.aplicativo === 'sonho-lucido/exato' &&
      exportado.fechamento.cartelas.length === cartelasDoResultado &&
      typeof exportado.fechamento.escalada === 'string' &&
      exportado.fechamento.escalada.length > 0,
    'exportar entrega um arquivo com as cartelas e o estado do motor dentro',
    `${entregue.suggestedFilename()} · ${exportado.fechamento.cartelas.length} cartelas`
  );

  // Fechar e reabrir o aplicativo: o histórico é o que não pode se perder.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('#lot-grade .numero');
  await pagina.click('#aba-historico');
  marcar(
    (await pagina.locator('#lista-historico .sessao').count()) === linhas,
    'fechar e reabrir o aplicativo não perde nada do histórico'
  );

  // Importar o mesmo arquivo de volta: a prévia diz o que tem dentro antes de
  // guardar, e o que entra é o que estava lá.
  await pagina.setInputFiles('#arquivo-sessao', caminhoDoArquivo);
  await pagina.waitForSelector('#previa-importacao:not([hidden])', { timeout: 15000 });
  marcar(
    new RegExp(`${cartelasDoResultado} cartelas`).test(await texto('#previa-importacao')),
    'importar mostra o que o arquivo traz antes de guardá-lo',
    (await texto('#previa-importacao')).slice(0, 80)
  );
  await pagina.click('#confirmar-importacao');
  marcar(
    (await pagina.locator('#lista-historico .sessao').count()) === linhas + 1,
    'e guardar acrescenta o fechamento importado ao histórico'
  );

  // Um arquivo que não serve é recusado com a frase que explica o quê, e nada
  // entra no histórico por causa dele.
  const arquivoRuim = join(tmpdir(), 'fechamento-remendado.json');
  const remendado = JSON.parse(await readFile(caminhoDoArquivo, 'utf8'));
  remendado.fechamento.cartelas = remendado.fechamento.cartelas.slice(0, 9);
  await writeFile(arquivoRuim, JSON.stringify(remendado));
  await pagina.setInputFiles('#arquivo-sessao', arquivoRuim);
  await pagina.waitForFunction(
    () => /não pôde ser aberta/.test(document.getElementById('previa-importacao').textContent),
    undefined,
    { timeout: 15000 }
  );
  // A caixa de importação é uma só agora: ela mostra a recusa, e o que não pode
  // existir é o botão que confirmaria — antes eram dois cartões, e o teste
  // cobrava que o segundo estivesse escondido.
  marcar(
    new RegExp(`${cartelasDoResultado} cartelas`).test(await texto('#previa-importacao')) &&
      /9/.test(await texto('#previa-importacao')) &&
      (await pagina.locator('#confirmar-importacao').count()) === 0,
    'um arquivo cujo estado discorda da ficha é recusado, com os dois números e sem botão',
    (await texto('#previa-importacao')).slice(0, 120)
  );

  // ─── 11. abrir só para olhar, sem pôr o motor para trabalhar ───
  //
  // "Continuar" era o único jeito de abrir um fechamento, e ele sempre retoma a
  // escalada. Quem quisesse apenas rever as cartelas ou conferir um resultado
  // punha o aparelho a calcular — e num fechamento que não fecha, a calcular
  // para sempre, já que a escalada só para quando mandam.
  marcar(
    (await pagina.locator('#lista-historico [data-acao="ex-abrir"]').count()) > 0 &&
      (await pagina.locator('#lista-historico [data-acao="ex-continuar"]').count()) > 0,
    'a linha do histórico separa abrir de continuar',
    await pagina.$$eval('#lista-historico .sessao-acoes button', (b) =>
      b.map((x) => x.textContent.trim()).join(' | ')
    )
  );

  const relogioDoAbrir = Date.now();
  await pagina.click('#lista-historico [data-acao="ex-abrir"]');
  await esperarResultado(60000);
  const abriuEm = Date.now() - relogioDoAbrir;
  marcar(
    (await numero('#ex-encontrado')) === cartelasDoResultado && abriuEm < 20000,
    'abrir devolve o fechamento guardado na hora, sem refazer nada',
    `${await numero('#ex-encontrado')} cartelas em ${abriuEm} ms`
  );
  marcar(
    await pagina.locator('#ex-parar').isHidden(),
    'e o motor não é acionado: não há o que parar'
  );
  await pagina.waitForTimeout(2500);
  marcar(
    (await pagina.locator('#ex-parar').isHidden()) &&
      /não foi acionado/.test(await texto('#ex-prova')),
    'nem passa a trabalhar sozinho depois',
    (await texto('#ex-prova')).slice(0, 70)
  );
  marcar(
    (await pagina.locator('#ex-previa .cartela').count()) === 3,
    'e a amostra de cartelas fica à mão, que é para isso que se abre'
  );

  // ─── 11b. as três vistas das cartelas contam a mesma coisa ───
  //
  // A tela desenha posições traduzidas pelos números marcados; o Copiar monta o
  // texto por outro caminho; o arquivo exportado guarda posições e a lista de
  // números para quem o receber traduzir. São três traduções independentes da
  // mesma coleção, e um erro em qualquer uma entrega à pessoa cartelas que ela
  // não tem — sem que nada quebre, e sem que nada avise.
  // A lista foi fechada mais acima; abre de novo para ler o que ela desenhou.
  if (await pagina.locator('#ex-cartelas').isHidden()) {
    await pagina.click('#ex-ver-cartelas');
    await pagina.waitForTimeout(400);
  }
  const daTela = await pagina.$$eval('#ex-cartelas .cartela span:last-child', (celulas) =>
    celulas.map((x) => x.textContent.trim().split(/\s+/).map(Number))
  );
  const doArquivo = exportado.fechamento.cartelas.map((c) =>
    c.map((posicao) => exportado.fechamento.numeros[posicao - 1])
  );
  const emOrdem = (listas) =>
    listas
      .map((c) => [...c].sort((a, b) => a - b).join(' '))
      .sort()
      .join(' | ');
  marcar(
    daTela.length === cartelasDoResultado && emOrdem(daTela) === emOrdem(doArquivo),
    'as cartelas na tela e as do arquivo exportado são a mesma coleção',
    `${daTela.length} de cada lado`
  );

  const marcados = new Set(exportado.fechamento.numeros);
  marcar(
    daTela.every((cartela) => cartela.every((n) => marcados.has(n))),
    'e nenhuma cartela usa um número que não foi marcado na grade',
    `números usados: ${[...new Set(daTela.flat())].sort((a, b) => a - b).join(' ')}`
  );
  await pagina.click('#ex-ver-cartelas');
  await pagina.waitForTimeout(200);


  // ─── 12. continuar de onde parou, com a mesma quantidade de cartelas ───
  await pagina.click('#aba-historico');
  const relogio = Date.now();
  await pagina.click('#lista-historico [data-acao="ex-continuar"]');
  await esperarResultado(180000);
  /*
   * Continuar continua: nunca recomeça, e nunca piora.
   *
   * Estava escrito "devolve exatamente a mesma quantidade", e isso valia porque
   * o caso desta seção já estava no mínimo provado — não havia para onde
   * melhorar. Neste, não: a escalada retomada acha 16 onde tinha parado em 18,
   * e cobrar igualdade seria cobrar que continuar não continuasse. O que a
   * promessa diz de verdade é que o trabalho guardado é o ponto de partida, e é
   * isso que se mede — nunca acima do que já havia, nunca abaixo do piso.
   */
  const aoRetomar = await numero('#ex-encontrado');
  const pisoAoRetomar = await numero('#ex-provado');
  marcar(
    aoRetomar > 0 && aoRetomar <= cartelasDoResultado && aoRetomar >= pisoAoRetomar,
    'continuar retoma do fechamento guardado, sem recomeçar e sem piorar',
    `${cartelasDoResultado} guardadas → ${aoRetomar}, piso ${pisoAoRetomar}`
  );
  marcar(
    new RegExp(`(Mínimo exato: ${aoRetomar}|Solução encontrada: ${aoRetomar})`).test(
      `${await texto('#ex-frase')} ${await texto('#ex-resultado-cartao')}`
    ),
    'e o veredito fala do número que está na tela, e não de outro',
    (await texto('#ex-frase')).slice(0, 60)
  );
  marcar(
    Date.now() - relogio < 60000,
    'sem refazer a determinação do mínimo, que o fechamento guardado já trazia',
    `${Math.round((Date.now() - relogio) / 100) / 10} s até o resultado`
  );

  // Excluir uma linha tira uma, e não todas.
  await pagina.click('#aba-historico');
  const antesDeExcluir = await pagina.locator('#lista-historico .sessao').count();
  await pagina.click('#lista-historico [data-acao="ex-excluir"]');
  await pagina.waitForTimeout(300);
  marcar(
    (await pagina.locator('#lista-historico .sessao').count()) === antesDeExcluir - 1,
    'excluir tira exatamente o fechamento pedido',
    `${antesDeExcluir} → ${await pagina.locator('#lista-historico .sessao').count()}`
  );

  // ─── 13. retomar uma escalada que ficou no meio ───
  //
  // O caso do pedido: um fechamento grande, interrompido, reaberto depois — e
  // retomado do ponto em que estava, sem recomeçar a montagem.
  await pagina.click('#aba-lotinha');
  await marcarNumeros(25, Array.from({ length: 20 }, (_, i) => i + 1));
  await regras(17, 15, 15);
  await pagina.selectOption('#ex-esforco', '1');
  await resolver();
  await pagina.waitForFunction(
    () => Number(document.getElementById('ex-cartelas-agora').textContent.replace(/\D/g, '')) > 30,
    undefined,
    { timeout: 120000 }
  );
  await pagina.click('#ex-parar');
  await esperarResultado(150000);
  const guardadas = await numero('#ex-encontrado');

  // A frase do resultado nunca pode falar de cartelas que a pessoa não tem.
  // Parar no meio dizia "Com 1537 cartelas..." para quem tinha 911 — o
  // aplicativo afirmando 626 cartelas inexistentes, e apresentando trabalho
  // interrompido como conclusão matemática.
  //
  // O primeiro número da frase é sempre o fechamento que existe: nas duas
  // formas que ela toma — "Com N cartelas…" quando parou no meio, e "Solução
  // encontrada: N · Mínimo comprovado: ≥ P" quando há um fechamento completo.
  const fraseDoParcial = await texto('#ex-frase');
  const numerosNaFrase = (fraseDoParcial.match(/[\d.]+/g) ?? []).map((n) =>
    Number(n.replace(/\./g, ''))
  );
  marcar(
    numerosNaFrase.length > 0 && numerosNaFrase[0] === guardadas,
    'a frase do resultado fala das cartelas que existem, e não do teto',
    `tem ${guardadas} · a frase diz ${numerosNaFrase[0]} — "${fraseDoParcial.slice(0, 60)}…"`
  );
  marcar(
    !/\d{4,}/.test(fraseDoParcial),
    'e escreve os números com separador de milhar, como o resto da tela'
  );

  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('#lot-grade .numero');
  await pagina.click('#aba-historico');
  await pagina.click('#lista-historico [data-acao="ex-continuar"]');
  await pagina.waitForFunction(
    () =>
      !document.getElementById('ex-construcao-cartao').hidden &&
      Number(document.getElementById('ex-cartelas-agora').textContent.replace(/\D/g, '')) > 0,
    undefined,
    { timeout: 120000 }
  );
  const retomadas = await numero('#ex-cartelas-agora');
  // O que se cobra é que retomar **aproveite** o trabalho guardado, e não que
  // devolva exatamente o mesmo número: com o motor de Turán, retomar já começa
  // a apertar, e voltar com menos cartelas é o resultado certo. O que não pode
  // acontecer é recomeçar do zero — e é isso que o piso desta faixa garante.
  marcar(
    retomadas > guardadas / 2,
    'uma escalada interrompida retoma do ponto em que estava, e não do zero',
    `parou com ${guardadas} cartelas, retomou com ${retomadas}`
  );
  marcar(
    (await numero('#ex-teto')) === 160,
    'e com o mesmo teto que estava salvo',
    `teto ${await numero('#ex-teto')}`
  );
  await pagina.click('#ex-parar');
  await esperarResultado(150000);

  // ─── 14. o que não é problema é recusado com o motivo ───
  //
  // `C(25,12) = 5.200.300` alvos, acima do teto de quatro milhões: a lista não
  // caberia na memória de um celular, e o motor diz isso antes de tentar
  // alocá-la. O pedido anterior deste bloco — jogos de 12 num sorteio de 15 —
  // deixou de ser expressável na tela: com o sorteio na modalidade, o menor
  // jogo é 15, que é o menor que uma banca vende.
  await marcarNumeros(25, Array.from({ length: 25 }, (_, i) => i + 1));
  await regras(15, 12, 11);
  await resolver();
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

  /* ─── acabado, a página conta uma história só ─── */

  /*
   * A tela chegava a exibir três números diferentes de cartelas ao mesmo tempo
   * — o quadro do estágio 5 com o que o otimizador perseguia, o texto abaixo
   * dele com outro, e o cartão de resultado com um terceiro — e o texto ficava
   * no gerúndio ("Otimizando: procurando…") com o motor já parado.
   */
  // Garantia cheia num tamanho que fecha depressa: o que se mede aqui é a
  // coerência da página no fim, não quanto o motor consegue.
  await marcarNumeros(25, Array.from({ length: 11 }, (_, i) => i + 1));
  await regras(8, 5, 5);
  await resolver();
  await esperarResultado();

  const contagem = await pagina.evaluate(() => ({
    noQuadro: Number(
      (document.getElementById('ex-cartelas-agora').textContent || '').replace(/\D/g, '')
    ),
    noResultado: Number(
      (document.getElementById('ex-encontrado').textContent || '').replace(/\D/g, '')
    ),
    texto: (document.getElementById('ex-construcao').textContent || '').trim(),
  }));

  marcar(
    contagem.noQuadro === contagem.noResultado,
    'acabado, o quadro e o resultado dizem o mesmo número de cartelas',
    `quadro ${contagem.noQuadro}, resultado ${contagem.noResultado}`
  );
  marcar(
    !/Otimizando|Procurando menor|Montando/i.test(contagem.texto),
    'e o texto não fica no gerúndio depois de o motor parar',
    contagem.texto.slice(0, 80)
  );

  /* ─── a barra de situação responde de qualquer altura da página ─── */

  /*
   * A página passa de cinco mil pixels depois de um resultado, e os controles
   * ficam longe dos números: quem rola para ver o progresso perde o Parar de
   * vista, e vice-versa. A barra é o que responde "está funcionando?" sem
   * obrigar ninguém a rolar de volta. A Lotinha já tinha uma; a tela que mais
   * precisava dela era a única sem.
   */
  await marcarNumeros(25, Array.from({ length: 11 }, (_, i) => i + 1));
  await regras(8, 5, 5);
  await resolver();
  await pagina.waitForFunction(
    () => !document.getElementById('ex-situacao').hidden,
    undefined,
    { timeout: 20000 }
  );
  const situacaoViva = await pagina.evaluate(() => {
    const b = document.getElementById('ex-situacao');
    return {
      texto: document.getElementById('ex-texto-situacao').textContent.trim(),
      trabalhando: b.classList.contains('trabalhando'),
      grudada: getComputedStyle(b).position,
    };
  });
  marcar(
    situacaoViva.trabalhando && situacaoViva.texto.length > 0,
    'a barra de situação aparece e diz o que está acontecendo',
    situacaoViva.texto
  );
  marcar(
    situacaoViva.grudada === 'sticky',
    'e acompanha a rolagem, para responder de qualquer altura da página',
    situacaoViva.grudada
  );

  const relogioAndou = await pagina.evaluate(async () => {
    const ler = () => document.getElementById('ex-relogio').textContent;
    const antes = ler();
    await new Promise((r) => setTimeout(r, 700));
    return { antes, depois: ler() };
  });
  marcar(
    relogioAndou.antes !== relogioAndou.depois,
    'e o relógio corre enquanto o motor trabalha',
    `${relogioAndou.antes} → ${relogioAndou.depois}`
  );

  await esperarResultado();
  const situacaoParada = await pagina.evaluate(() => ({
    texto: document.getElementById('ex-texto-situacao').textContent.trim(),
    trabalhando: document.getElementById('ex-situacao').classList.contains('trabalhando'),
  }));
  marcar(
    !situacaoParada.trabalhando && /parado/i.test(situacaoParada.texto),
    'e no fim ela diz que parou, em vez de continuar pulsando',
    situacaoParada.texto
  );

  /* ─── tocar em Resolver muda o que a pessoa vê ─── */

  /*
   * Medido antes da correção: depois do toque o `scrollY` não mudava um pixel,
   * o botão continuava escrito "Resolver" — só mais apagado — e o progresso
   * nascia mil pixels abaixo da dobra. A ação mais importante do aplicativo
   * não mudava nada visível, e quem não vê resposta toca de novo.
   */
  await marcarNumeros(25, Array.from({ length: 11 }, (_, i) => i + 1));
  await regras(8, 5, 5);
  const antesDoToque = await pagina.evaluate(() => window.scrollY);
  await resolver();
  await pagina.waitForFunction(
    () => !document.getElementById('ex-analise-cartao').hidden,
    undefined,
    { timeout: 20000 }
  );
  const rotuloEmCurso = await texto('#lot-iniciar');
  await pagina.waitForTimeout(700);
  const depoisDoToque = await pagina.evaluate(() => window.scrollY);

  marcar(
    /Procurando/i.test(rotuloEmCurso),
    'o botão diz que está procurando, em vez de continuar dizendo Resolver',
    rotuloEmCurso
  );
  marcar(
    depoisDoToque !== antesDoToque
      || (await pagina.locator('#ex-analise-cartao').isVisible()),
    'e a tela leva até onde o trabalho aparece',
    `scrollY ${antesDoToque} → ${depoisDoToque}`
  );

  await esperarResultado();
  marcar(
    !/Procurando/i.test(await texto('#lot-iniciar')),
    'e o rótulo volta ao normal quando acaba',
    await texto('#lot-iniciar')
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
