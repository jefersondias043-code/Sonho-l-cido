/*
 * Teste do histórico do Construtor Exato e do arquivo de fechamento.
 *
 * Roda em node puro, sem navegador e sem WebAssembly. O que se cobra aqui é a
 * promessa central do pedido:
 *
 *   **abrir um fechamento salvo devolve exatamente a quantidade de cartelas que
 *   estava registrada, e retoma daquele estado.**
 *
 * Um histórico que perde trabalho é pior do que não ter histórico: quem não tem
 * sabe que precisa anotar. Por isso a validação é cobrada dos dois lados — o que
 * entra no armazenamento e o que entra pelo arquivo — e sobretudo no ponto em
 * que a ficha e o estado do motor poderiam discordar.
 *
 *   node web/testar-historico-exato.mjs
 */

/*
 * Um `localStorage` de mentira, com o mesmo contrato do de verdade: guarda
 * texto, e estoura quando não cabe mais. É o estouro que interessa — a reação a
 * ele é metade do módulo.
 */
class Armazem {
  constructor(limite = Infinity) {
    this.mapa = new Map();
    this.limite = limite;
  }
  getItem(chave) {
    return this.mapa.has(chave) ? this.mapa.get(chave) : null;
  }
  setItem(chave, valor) {
    const texto = String(valor);
    if (texto.length > this.limite) {
      const erro = new Error('QuotaExceededError');
      erro.name = 'QuotaExceededError';
      throw erro;
    }
    this.mapa.set(chave, texto);
  }
  removeItem(chave) {
    this.mapa.delete(chave);
  }
}

globalThis.localStorage = new Armazem();

const historico = await import('./historico-exato.js');
const arquivo = await import('./sessao-exato.js');

const passos = [];
function marcar(certo, descricao, detalhe = '') {
  passos.push({ certo, descricao });
  console.log(`${certo ? '  ✓' : '  ✗'} ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
}

/**
 * Um estado do motor com a forma que o Rust grava.
 *
 * As cartelas são **máscaras de bits**, como o motor as guarda: o bit `i`
 * ligado quer dizer "contém a posição `i+1`". Uma cartela de `k` posições entre
 * `v` é uma máscara com `k` bits ligados, e é assim que ela tem de ser aqui —
 * um número qualquer decodifica para uma cartela que o aplicativo nunca
 * produziria, e o teste passaria a cobrar outra coisa.
 */
function estadoDoMotor({ v = 18, k = 17, j = 15, t = 15, r = 1, teto = 16, quantas = 16 } = {}) {
  const todos = (1 << v) - 1;
  const blocos = Array.from({ length: quantas }, (_, i) => {
    // Tira `v - k` posições diferentes a cada cartela: máscaras distintas, com
    // exatamente `k` bits, dentro do pool.
    let mascara = todos;
    for (let f = 0; f < v - k; f += 1) mascara &= ~(1 << ((i + f * 7) % v));
    return mascara >>> 0;
  });
  return JSON.stringify({
    v, k, j, t, r, teto,
    cartelas: blocos,
    melhor: blocos,
    fase: 'subindo',
    trabalho: 123456,
    rodadas: 42,
    sem_ganho: 0,
    semente: 987654321,
    curva: [[1, 0.06], [8, 0.5], [16, 1]],
    passo_da_curva: 1,
  });
}

/** Uma sessão inteira, do jeito que a tela a monta. */
function sessaoDeTeste(ajustes = {}) {
  const pedido = ajustes.pedido ?? { v: 18, k: 17, j: 15, t: 15, r: 1 };
  const quantas = ajustes.quantas ?? 16;
  return {
    pedido,
    numeros: Array.from({ length: pedido.v }, (_, i) => i + 1),
    universo: 25,
    esforco: 4,
    piso: 16,
    origem: 'cota de contagem',
    fechado: true,
    cartelasContadas: quantas,
    escalada: ajustes.escalada ?? estadoDoMotor({ ...pedido, quantas }),
    curva: [[1, 0.06], [16, 1]],
    cobertura: 1,
    fase: 'fechada',
    verificado: true,
    descobertos: 0,
    emCurso: false,
    ...ajustes.extra,
  };
}

console.log('Teste do histórico do Construtor Exato\n');

/* ─── 1. guardar, listar, atualizar, remover ─── */

historico.limpar();
const a = historico.criar(sessaoDeTeste());
marcar(
  historico.quantidade() === 1 && historico.contarCartelas(historico.obter(a.id)) === 16,
  'um fechamento guardado volta com a mesma quantidade de cartelas',
  `${historico.contarCartelas(historico.obter(a.id))} cartelas`
);

const b = historico.criar(sessaoDeTeste({ pedido: { v: 20, k: 17, j: 15, t: 15, r: 1 }, quantas: 160 }));
marcar(
  historico.quantidade() === 2 && historico.listar()[0].id === b.id,
  'o mais recente aparece primeiro na lista'
);

historico.atualizar(a.id, { cobertura: 0.5 });
marcar(
  historico.obter(a.id).cobertura === 0.5 && historico.listar()[0].id === a.id,
  'atualizar mexe no conteúdo e traz o trabalho para o topo'
);

marcar(
  historico.obter(a.id).criadaEm === a.criadaEm && historico.obter(a.id).id === a.id,
  'e nunca troca a identidade nem a data de criação'
);

marcar(
  historico.paraOPedido({ v: 20, k: 17, j: 15, t: 15, r: 1 })?.id === b.id &&
    historico.paraOPedido({ v: 21, k: 17, j: 15, t: 15, r: 1 }) === null,
  'a busca por pedido acha o fechamento certo e recusa o que não existe'
);

marcar(historico.remover(a.id) && historico.quantidade() === 1, 'remover tira só o pedido');

/* ─── 2. o que não pode entrar ─── */

const ruins = [
  ['sem identidade', { ...sessaoDeTeste(), id: '' }],
  ['sem os cinco números', { ...sessaoDeTeste(), id: 'x', pedido: null }],
  ['com garantia maior que o jogo', {
    ...sessaoDeTeste(), id: 'x', pedido: { v: 18, k: 3, j: 15, t: 15, r: 1 },
  }],
  ['sem os números da grade', { ...sessaoDeTeste(), id: 'x', numeros: [] }],
  ['sem o estado do motor', { ...sessaoDeTeste(), id: 'x', escalada: '' }],
  ['com cartela do tamanho errado, gravada por uma versão antiga', {
    ...sessaoDeTeste(), id: 'x', cartelas: [[1, 2, 3]],
  }],
  ['com cartela apontando fora do pool', {
    ...sessaoDeTeste(), id: 'x',
    cartelas: [Array.from({ length: 17 }, (_, i) => i + 40)],
  }],
];
marcar(
  ruins.every(([, s]) => !historico.ehSessaoValida(s)),
  'uma sessão estragada é recusada na porta, e não lá adiante',
  `${ruins.length} formas conferidas`
);
marcar(historico.ehSessaoValida({ ...sessaoDeTeste(), id: 'x' }), 'e uma boa passa');

/* ─── 3. o teto de sessões ─── */

historico.limpar();
for (let i = 0; i < historico.LIMITE_DE_SESSOES + 5; i += 1) historico.criar(sessaoDeTeste());
marcar(
  historico.quantidade() === historico.LIMITE_DE_SESSOES,
  'o histórico para no teto anunciado em vez de crescer sem fim',
  `${historico.quantidade()} de ${historico.LIMITE_DE_SESSOES}`
);

/* ─── 4. faltar espaço avisa, em vez de apagar calado ─── */

historico.limpar();
globalThis.localStorage = new Armazem(4000);
const avisos = [];
const desligar = historico.quandoFaltarEspaco((aviso) => avisos.push(aviso));
for (let i = 0; i < 6; i += 1) historico.criar(sessaoDeTeste());
desligar();
marcar(
  avisos.length > 0 && avisos.some((x) => x.descartadas > 0),
  'quando o aparelho enche, o módulo avisa quantos trabalhos precisaram sair',
  `${avisos.length} avisos, ${avisos.reduce((s, x) => s + x.descartadas, 0)} descartados`
);
marcar(
  historico.quantidade() >= 1,
  'e o trabalho que está sendo feito agora sobrevive',
  `${historico.quantidade()} guardados`
);

globalThis.localStorage = new Armazem();
historico.limpar();

/* ─── 5. a migração do trabalho único ─── */

globalThis.localStorage.setItem(
  'sonho-lucido:exato:escalada',
  JSON.stringify({
    pedido: { v: 18, k: 17, j: 15, t: 15, r: 1 },
    escalada: estadoDoMotor({ quantas: 12 }),
    quando: Date.now(),
  })
);
const migrada = historico.migrarDoSlotUnico();
marcar(
  migrada !== null && historico.quantidade() === 1 && migrada.cartelas === 12,
  'o trabalho guardado pela versão anterior entra no histórico em vez de sumir',
  `${migrada?.cartelas} cartelas recuperadas`
);
marcar(
  globalThis.localStorage.getItem('sonho-lucido:exato:escalada') === null &&
    historico.migrarDoSlotUnico() === null,
  'e a chave antiga sai, para a migração não rodar duas vezes'
);

/* ─── 6. em curso ─── */

historico.limpar();
const viva = historico.criar(sessaoDeTeste({ extra: { emCurso: true } }));
marcar(
  historico.interrompida()?.id === viva.id,
  'um trabalho que ficou em curso é encontrável na abertura seguinte'
);
historico.encerrar(viva.id);
marcar(historico.interrompida() === null, 'e some da lista de interrompidos ao ser encerrado');

/* ─── 7. o arquivo: ida e volta ─── */

historico.limpar();
const original = historico.criar(sessaoDeTeste({ quantas: 16 }));
const cartelasDecodificadas = historico.cartelasDaSessao(original);
const pacote = arquivo.empacotar(original, {
  versao: 'abc123',
  cartelas: cartelasDecodificadas,
});
const texto = JSON.stringify(pacote);
const lido = arquivo.interpretar(texto);

marcar(lido.ok, 'um fechamento exportado volta a ser lido', lido.erro ?? '');
marcar(
  lido.resumo.cartelas === 16 && lido.resumo.teto === 16,
  'e o resumo diz a quantidade de cartelas antes de a pessoa decidir importar',
  `${lido.resumo.cartelas} cartelas, teto ${lido.resumo.teto}`
);

const devolta = arquivo.paraSessao(lido.pacote);
marcar(
  historico.contarCartelas(devolta) === historico.contarCartelas(original) &&
    devolta.escalada === original.escalada &&
    JSON.stringify(devolta.pedido) === JSON.stringify(original.pedido) &&
    JSON.stringify(devolta.numeros) === JSON.stringify(original.numeros),
  'a ida e volta pelo arquivo preserva as cartelas, os números e o estado do motor',
  `${historico.contarCartelas(devolta)} cartelas, estado de ${devolta.escalada.length} bytes`
);
marcar(
  devolta.emCurso === false,
  'um fechamento que chega de fora nunca se declara em curso'
);
marcar(
  /^sonho-lucido-exato-18-17-15-\d{4}-\d{2}-\d{2}\.json$/.test(arquivo.nomeDoArquivo(pacote)),
  'o nome do arquivo diz o que tem dentro',
  arquivo.nomeDoArquivo(pacote)
);

/* ─── 7b. as cartelas saem do estado, e não de uma cópia ─── */

marcar(
  cartelasDecodificadas.length === 16 &&
    cartelasDecodificadas.every((c) => c.length === 17),
  'as cartelas são decodificadas das máscaras do motor, sem cópia guardada',
  `${cartelasDecodificadas.length} cartelas de ${cartelasDecodificadas[0]?.length} posições`
);
marcar(
  cartelasDecodificadas.every((c) =>
    c.every((posicao, i) => posicao >= 1 && posicao <= 18 && (i === 0 || posicao > c[i - 1]))
  ),
  'e cada uma sai com as posições em ordem, dentro do pool',
  cartelasDecodificadas[0]?.join(' ')
);
marcar(
  JSON.stringify(historico.obter(original.id)).length < 3000 &&
    !('cartelas' in historico.obter(original.id)),
  'a sessão guardada não carrega a lista de cartelas',
  `${JSON.stringify(historico.obter(original.id)).length} bytes por sessão`
);

/* ─── 8. a invariante: a ficha e o estado contam a mesma história ─── */

const mentiroso = JSON.parse(texto);
mentiroso.fechamento.cartelas = mentiroso.fechamento.cartelas.slice(0, 10);
const recusado = arquivo.interpretar(JSON.stringify(mentiroso));
marcar(
  !recusado.ok && /16 cartelas/.test(recusado.erro) && /10/.test(recusado.erro),
  'um arquivo cujo estado discorda da ficha é recusado, com os dois números na mensagem',
  recusado.erro
);

const trocado = JSON.parse(texto);
trocado.fechamento.pedido = { ...trocado.fechamento.pedido, k: 16 };
trocado.fechamento.cartelas = trocado.fechamento.cartelas.map((c) => c.slice(0, 16));
const recusado2 = arquivo.interpretar(JSON.stringify(trocado));
marcar(
  !recusado2.ok && /k=16/.test(recusado2.erro) && /k=17/.test(recusado2.erro),
  'e um arquivo cujas regras foram trocadas por baixo também',
  recusado2.erro
);

const estourado = JSON.parse(texto);
estourado.fechamento.escalada = estadoDoMotor({ teto: 8, quantas: 16 });
const recusado3 = arquivo.interpretar(JSON.stringify(estourado));
marcar(
  !recusado3.ok && /teto/.test(recusado3.erro),
  'e um estado com mais cartelas do que o próprio teto, que este aplicativo nunca produziria',
  recusado3.erro
);

/* ─── 9. arquivos que não são deste aplicativo ─── */

const casos = [
  ['não é JSON', 'isto não é json {{{', /JSON válido/],
  ['é de outra ferramenta', JSON.stringify({ aplicativo: 'outra-coisa' }), /não foi gerado/],
  [
    'é da Lotinha',
    JSON.stringify({ aplicativo: 'sonho-lucido/sessao', formato: 1, sessao: {} }),
    /Lotinha/,
  ],
  [
    'é de uma versão mais nova',
    JSON.stringify({ aplicativo: arquivo.MARCA, formato: 99, fechamento: {} }),
    /versão mais nova/,
  ],
  [
    'não traz o estado do motor',
    JSON.stringify(
      arquivo.empacotar({ ...sessaoDeTeste(), escalada: '' }, {})
    ),
    /estado do motor/,
  ],
];
marcar(
  casos.every(([, entrada, esperado]) => {
    const r = arquivo.interpretar(entrada);
    return !r.ok && esperado.test(r.erro);
  }),
  'cada tipo de arquivo errado é recusado com a frase que explica o quê',
  `${casos.length} casos`
);
console.log(
  `      ${casos
    .map(([nome, entrada]) => `${nome}: "${arquivo.interpretar(entrada).erro.slice(0, 46)}…"`)
    .join('\n      ')}`
);

/* ─── 10. a descrição que a lista mostra ─── */

marcar(
  historico.descrever({ v: 18, k: 17, j: 15, t: 15, r: 1 }) ===
    '18 números · jogos de 17 · garante 15',
  'a descrição fala a língua da tela que produziu o fechamento',
  historico.descrever({ v: 18, k: 17, j: 15, t: 15, r: 1 })
);
marcar(
  historico.descrever({ v: 20, k: 17, j: 15, t: 13, r: 2 }) ===
    '20 números · jogos de 17 · saem 15 · garante 13 · 2 premiadas',
  'e só menciona o sorteio e as premiadas quando eles dizem alguma coisa',
  historico.descrever({ v: 20, k: 17, j: 15, t: 13, r: 2 })
);

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
