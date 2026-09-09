/*
 * O armazenamento que os históricos compartilham.
 *
 * Existe por um defeito de perda de dados, e não por simetria.
 *
 * Cada histórico tinha o seu `gravar`, e os dois eram cópia um do outro:
 * quando o navegador recusava por falta de espaço, cada um descartava as
 * **próprias** sessões, em laço, cortando um quarto de cada vez até caber. A
 * lógica é correta olhando um deles sozinho, e errada olhando os dois.
 *
 * `localStorage` tem cota **por origem**, não por chave. Encher o histórico do
 * Construtor Exato fazia a Lotinha começar a falhar ao salvar — e a Lotinha
 * então jogava fora trabalho **dela**, o que não libera um único byte do que o
 * outro ocupou. No pior caso ela descia até uma sessão, avisando "faltou
 * espaço", com a causa intacta na outra chave.
 *
 * Aqui os depósitos se conhecem. Quem não consegue gravar apara o próprio
 * primeiro — é o dono do problema, e o trabalho mais velho dele é o candidato
 * natural. Só depois pede espaço aos vizinhos, e quem cede avisa os próprios
 * ouvintes: perder trabalho em silêncio para caber o trabalho de outra tela
 * seria trocar um defeito por outro pior.
 */

/** Os depósitos registrados, por chave. */
const depositos = new Map();

/**
 * Registra um histórico.
 *
 * `ler` fica com quem registrou porque cada histórico tem o seu formato de
 * sessão; o que este módulo administra é o **espaço**, que é o que eles de
 * fato disputam.
 */
export function registrar({ chave, limite, ler, aoAparar }) {
  depositos.set(chave, { chave, limite, ler, aoAparar });
}

/** Tenta escrever, e diz se conseguiu. */
function tentar(chave, lista) {
  try {
    localStorage.setItem(chave, JSON.stringify(lista));
    return true;
  } catch {
    return false;
  }
}

/**
 * Pede espaço aos outros depósitos, do maior para o menor.
 *
 * Do maior primeiro porque é onde há mais a ganhar por sessão descartada — e
 * porque quem encheu a origem é quem deve pagar a conta, não quem chegou
 * depois.
 */
function pedirEspacoAosVizinhos(chaveQuePede) {
  const vizinhos = [...depositos.values()]
    .filter((d) => d.chave !== chaveQuePede)
    .map((d) => ({ d, tamanho: localStorage.getItem(d.chave)?.length ?? 0 }))
    .sort((a, b) => b.tamanho - a.tamanho);

  for (const { d, tamanho } of vizinhos) {
    if (tamanho === 0) continue;
    const lista = d.ler();
    if (lista.length <= 1) continue;
    const menor = lista.slice(0, Math.max(1, Math.floor(lista.length * 0.75)));
    if (tentar(d.chave, menor)) {
      // O vizinho perdeu trabalho para caber o nosso. Ele precisa saber, e
      // quem está olhando também.
      d.aoAparar(lista.length - menor.length);
      return true;
    }
  }
  return false;
}

/**
 * Grava, abrindo espaço onde ele estiver.
 *
 * Devolve `{ gravou, descartadas }` — `descartadas` conta só as sessões
 * **deste** depósito que ficaram de fora, que é o que interessa a quem chamou.
 */
export function gravar(chave, sessoes) {
  const deposito = depositos.get(chave);
  const limite = deposito?.limite ?? sessoes.length;
  const pedidas = Math.min(sessoes.length, limite);
  let paraGravar = sessoes.slice(0, limite);

  // Primeira linha: aparar o próprio. Quem quer gravar é o dono do problema, e
  // o trabalho mais velho dele é o candidato natural.
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    if (tentar(chave, paraGravar)) {
      return { gravou: true, descartadas: pedidas - paraGravar.length };
    }
    if (paraGravar.length <= 1) break;
    paraGravar = paraGravar.slice(0, Math.max(1, Math.floor(paraGravar.length * 0.75)));
  }

  // Segunda linha: os vizinhos. Antes disto, um histórico cheio no Exato
  // condenava a Lotinha a descartar trabalho dela sem liberar um byte.
  for (let rodada = 0; rodada < 4; rodada += 1) {
    if (!pedirEspacoAosVizinhos(chave)) break;
    if (tentar(chave, paraGravar)) {
      return { gravou: true, descartadas: pedidas - paraGravar.length };
    }
  }

  // Última tentativa com o conjunto inteiro: se os vizinhos abriram espaço de
  // sobra, não há razão para ficar com o que foi aparado no caminho.
  const cheio = sessoes.slice(0, limite);
  if (paraGravar.length < cheio.length && tentar(chave, cheio)) {
    return { gravou: true, descartadas: 0 };
  }

  return { gravou: false, descartadas: pedidas };
}
