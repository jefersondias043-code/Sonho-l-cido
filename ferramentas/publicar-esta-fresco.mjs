// `publicar/` está mais novo do que tudo o que entra nele?
//
// As suítes de navegador servem `publicar/`, não `app/`. Rodar uma delas sem
// reconstruir testa os bytes da versão anterior — e passa, porque a versão
// anterior também passava. O sintoma é o pior possível: verde.
//
// Aconteceu: uma rodada inteira de suítes conferiu um catálogo velho e disse
// que estava tudo bem. Em CI a ordem dos passos garante a construção antes; na
// máquina de quem mexe, não garante nada.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;

// As suítes vivem ao lado do que testam e não entram na construção: mexer numa
// delas não torna `publicar/` velho.
const ENTRA_NA_CONSTRUCAO = (nome) => !nome.startsWith('testar-');

function maisNovo(pasta) {
  let quando = 0;
  let qual = null;
  for (const item of readdirSync(pasta, { withFileTypes: true })) {
    if (!item.isDirectory() && !ENTRA_NA_CONSTRUCAO(item.name)) continue;
    const caminho = join(pasta, item.name);
    const [t, c] = item.isDirectory() ? maisNovo(caminho) : [statSync(caminho).mtimeMs, caminho];
    if (t > quando) [quando, qual] = [t, c];
  }
  return [quando, qual];
}

/// Sai com erro se `publicar/` for mais velho do que `app/` ou `catalogo/`.
export function exigirConstrucaoFresca() {
  const [construido] = maisNovo(join(RAIZ, 'publicar'));
  for (const fonte of ['app', 'catalogo']) {
    const [alterado, qual] = maisNovo(join(RAIZ, fonte));
    if (alterado > construido) {
      console.error(
        `publicar/ está mais velho que ${qual.slice(RAIZ.length)} — rode ./construir-app.sh.\n`
        + 'Sem isto o teste passa contra os bytes da versão anterior, e o verde não quer dizer nada.',
      );
      process.exit(1);
    }
  }
}
