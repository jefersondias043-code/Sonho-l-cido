#!/usr/bin/env bash
#
# Testes da construção do site.
#
# Verificam duas propriedades das quais tudo o mais depende, e que só se
# manifestam entre uma construção e outra — nenhum teste de navegador as
# alcança:
#
#   1. O carimbo da versão muda quando qualquer arquivo muda, inclusive quando
#      só o service worker muda. Sem isso, o número que a tela mostra deixa de
#      identificar a construção, e quem o usa para conferir se uma correção
#      chegou é enganado.
#
#   2. A lista de arquivos guardados para uso sem internet cobre tudo que o
#      site tem. Um módulo faltando derruba o aplicativo inteiro offline.
#
#   ./testar-construcao.sh

set -uo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$raiz"

passaram=0
falharam=0

marcar() {
    if [ "$1" = "sim" ]; then
        echo "  ✓ $2${3:+ — $3}"
        passaram=$((passaram + 1))
    else
        echo "  ✗ $2${3:+ — $3}"
        falharam=$((falharam + 1))
    fi
}

carimbo_atual() {
    grep -oP "CARIMBO = '\K[^']+" site/sw.js
}

echo "Testes da construção do site"
echo

./construir-web.sh >/dev/null 2>&1 || { echo "  ✗ a construção falhou"; exit 1; }
inicial=$(carimbo_atual)

[ -n "$inicial" ] && [ "$inicial" != "__CARIMBO_DA_CONSTRUCAO__" ]
marcar "$([ $? -eq 0 ] && echo sim || echo nao)" "a construção carimba o service worker" "$inicial"

# ─── o carimbo é estável quando nada muda ───
./construir-web.sh >/dev/null 2>&1
repetido=$(carimbo_atual)
marcar "$([ "$repetido" = "$inicial" ] && echo sim || echo nao)" \
    "construir de novo sem mudar nada mantém o carimbo" \
    "$repetido"

# ─── o carimbo reage a uma mudança só no service worker ───
#
# Este é o caso que já falhou: o resumo excluía o `sw.js` construído para
# evitar circularidade, e acabou excluindo também qualquer alteração feita
# nele. Uma correção de cache saía com o carimbo da versão anterior.
cp web/sw.js /tmp/sw-guardado.js
printf '\n// marcador temporário do teste de construção\n' >> web/sw.js
./construir-web.sh >/dev/null 2>&1
apos_sw=$(carimbo_atual)
cp /tmp/sw-guardado.js web/sw.js
rm -f /tmp/sw-guardado.js

marcar "$([ "$apos_sw" != "$inicial" ] && echo sim || echo nao)" \
    "mudar só o service worker muda o carimbo" \
    "$inicial → $apos_sw"

# ─── e volta ao valor original quando a mudança é desfeita ───
./construir-web.sh >/dev/null 2>&1
restaurado=$(carimbo_atual)
marcar "$([ "$restaurado" = "$inicial" ] && echo sim || echo nao)" \
    "desfazer a mudança devolve o carimbo original" \
    "$restaurado"

# ─── a lista offline cobre todo o site ───
faltando=""
while IFS= read -r arquivo; do
    if ! grep -q "\"$arquivo\"" site/sw.js; then
        faltando="$faltando $arquivo"
    fi
done < <(cd site && find . -type f ! -name sw.js ! -name .nojekyll | sort)

marcar "$([ -z "$faltando" ] && echo sim || echo nao)" \
    "todo arquivo do site está na lista de uso sem internet" \
    "${faltando:-$(cd site && find . -type f ! -name sw.js ! -name .nojekyll | wc -l) arquivos}"

# ─── nada de ferramenta de desenvolvimento vai ao ar ───
vazou=$(find site -name '*.mjs' -o -name '*.py' | tr '\n' ' ')
marcar "$([ -z "$vazou" ] && echo sim || echo nao)" \
    "nenhuma ferramenta de desenvolvimento foi publicada" \
    "${vazou:-nada vazou}"

echo
echo "$passaram de $((passaram + falharam)) verificações passaram."
[ "$falharam" -eq 0 ]
