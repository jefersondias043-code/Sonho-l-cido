// O resultado oficial da Lotofácil, com cache de 24 horas.
//
// Uma origem, um cache, e nenhuma chave no cliente. O aplicativo pergunta aqui
// e recebe `{concurso, dezenas, data}` — nada além disso sai daqui, porque nada
// além disso é preciso para conferir um bilhete.
//
// Sem esta função o aplicativo continua conferindo: o cliente guarda o último
// concurso conhecido e aceita as 15 dezenas digitadas à mão.

const ORIGEM = 'https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil';

// Duas perguntas diferentes saem por esta mesma porta, e elas não envelhecem
// no mesmo passo.
//
// Um concurso **nomeado** — `?concurso=3210` — nunca mais muda: as dezenas
// dele foram sorteadas e acabou. Um dia de cache é pouco, e não faz mal.
//
// O **último** muda a cada sorteio: de segunda a sábado, por volta das 20h. Com
// um dia de cache, quem abrisse o aplicativo depois do sorteio de hoje receberia
// as dezenas de ontem — e o aplicativo as conferiria contra os bilhetes sem
// desconfiar de nada, porque o concurso vem rotulado e o rótulo estaria certo
// para as dezenas erradas. Não é um número feio na tela: é uma conferência que
// diz que você não ganhou. Dez minutos.
const UM_DIA = 86400;
const DEZ_MINUTOS = 600;

export default {
  async fetch(pedido) {
    const concurso = new URL(pedido.url).searchParams.get('concurso');
    if (concurso && !/^\d{1,6}$/.test(concurso)) {
      return json({ erro: 'concurso inválido' }, 400);
    }

    try {
      const oficial = await fetch(concurso ? `${ORIGEM}/${concurso}` : ORIGEM, {
        signal: AbortSignal.timeout(4000),
        headers: { accept: 'application/json' },
      });
      if (!oficial.ok) throw new Error(String(oficial.status));

      const bruto = await oficial.json();
      // O `Set` não é asseio: uma dezena repetida passaria pelo filtro, faria a
      // contagem chegar a 15 e entraria na tela como sorteio válido. Melhor
      // recusar e deixar a pessoa digitar do que conferir contra um sorteio que
      // não houve.
      const dezenas = [...new Set(
        (bruto.listaDezenas ?? bruto.dezenasSorteadasOrdemSorteio ?? [])
          .map(Number)
          .filter((d) => Number.isInteger(d) && d >= 1 && d <= 25),
      )].sort((a, b) => a - b);

      if (dezenas.length !== 15 || !Number.isInteger(bruto.numero) || bruto.numero <= 0) {
        throw new Error('resposta da origem fora do formato');
      }

      return json(
        { concurso: bruto.numero, dezenas, data: bruto.dataApuracao ?? null },
        200,
        `public, max-age=${concurso ? UM_DIA : DEZ_MINUTOS}`,
      );
    } catch {
      // Sem inventar resultado. Quem chamou tem caminho alternativo — o último
      // concurso guardado no aparelho, ou as dezenas digitadas.
      return json({ erro: 'resultado indisponível agora' }, 503);
    }
  },
};

const json = (corpo, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache },
  });
