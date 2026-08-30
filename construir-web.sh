#!/usr/bin/env bash
#
# Compila o motor para WebAssembly e monta o site em `site/`.
#
# O resultado é totalmente estático: dá para abrir com qualquer servidor de
# arquivos, e é isso que o GitHub Pages publica.
#
#   ./construir-web.sh
#   python3 -m http.server -d site 8000     # para testar localmente

set -euo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$raiz"

destino="site"

# A biblioteca e a ferramenta `wasm-bindgen` conversam por um formato interno
# que ainda muda entre versões. Quando divergem, o erro que aparece fala de
# "schema version" e não diz o que fazer. Melhor conferir aqui e explicar.
esperada=$(grep -oP 'wasm-bindgen = "=\K[0-9.]+' crates/motor-web/Cargo.toml)
instalada=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || echo "ausente")

if [ "$esperada" != "$instalada" ]; then
    echo "erro: o projeto usa wasm-bindgen $esperada, mas a ferramenta instalada é $instalada."
    echo "      corrija com:  cargo install wasm-bindgen-cli --version $esperada --force"
    exit 1
fi

echo "==> compilando motor-web para wasm32-unknown-unknown"
cargo build --release --target wasm32-unknown-unknown -p motor-web

# O segundo módulo é do Construtor Matemático Exato, e é separado de propósito:
# aquele aplicativo não empresta matemática de nenhum outro, e um módulo só
# tornaria a independência uma promessa em vez de um fato. Quem abre a Lotinha
# não baixa o motor exato, e quem abre o exato não baixa o da Lotinha.
echo "==> compilando motor-exato-web para wasm32-unknown-unknown"
cargo build --release --target wasm32-unknown-unknown -p motor-exato-web

# Recomeça do zero. Sem isto, arquivos de uma construção anterior que já não
# fazem parte do projeto continuariam sendo publicados junto.
rm -rf "$destino"
mkdir -p "$destino"

echo "==> gerando as ligações JavaScript"
wasm-bindgen \
    --target web \
    --no-typescript \
    --out-dir "$destino/wasm" \
    target/wasm32-unknown-unknown/release/motor_web.wasm

wasm-bindgen \
    --target web \
    --no-typescript \
    --out-dir "$destino/wasm-exato" \
    target/wasm32-unknown-unknown/release/motor_exato_web.wasm

echo "==> copiando a interface"
cp -r web/. "$destino/"

# Ferramentas de desenvolvimento não vão ao ar: o gerador de ícones (os PNGs
# que ele produz são versionados) e o teste de navegador.
rm -f "$destino/gerar-icones.py" "$destino"/testar*.mjs

# Carimba o service worker com um resumo do conteúdo do site.
#
# É isto que faz uma publicação nova de fato chegar ao aparelho do usuário. O
# navegador só atualiza um service worker quando os bytes daquele arquivo
# mudam; com um número de versão escrito à mão, basta esquecer de trocá-lo uma
# vez para congelar o aplicativo de todo mundo na versão antiga — foi
# exatamente o que aconteceu.
#
# Derivando o carimbo do conteúdo, a regra passa a ser automática nos dois
# sentidos: se algum arquivo mudou, o carimbo muda; se nada mudou, ele
# permanece igual e o navegador não reinstala à toa.
# Monta a lista de arquivos que o service worker guarda para funcionar sem
# internet, a partir do que existe de fato no site.
#
# Escrita à mão, a lista sai de sincronia no dia em que alguém acrescenta um
# arquivo — e um módulo faltando derruba o aplicativo inteiro offline, porque
# uma importação que falha impede o módulo que a fez de carregar.
echo "==> montando a lista de arquivos para uso sem internet"
arquivos=$(
    cd "$destino" && find . -type f ! -name sw.js ! -name .nojekyll \
        | sed 's|^\./|./|' | sort \
        | awk '{printf "%s\"%s\"", (NR>1 ? "," : ""), $0}'
)
sed -i "s|__ARQUIVOS_DA_CONSTRUCAO__|[$arquivos]|" "$destino/sw.js"
echo "    $(echo "$arquivos" | tr ',' '\n' | wc -l) arquivos guardados para uso offline"

echo "==> carimbando o service worker"
# O `sw.js` já construído fica fora do resumo por necessidade — ele contém o
# próprio carimbo, e incluí-lo criaria uma dependência circular. Mas o modelo
# em `web/sw.js` entra: ele tem apenas os marcadores, não o valor final.
#
# Sem essa segunda parcela, uma correção que mexesse só no service worker
# produziria um carimbo idêntico ao anterior. A correção chegaria ao aparelho
# — o navegador compara os bytes do arquivo, não o carimbo — mas o número
# mostrado na tela continuaria o antigo, e quem o usasse para conferir se a
# correção chegou seria enganado. Foi o que aconteceu.
carimbo=$(
    {
        find "$destino" -type f ! -name sw.js -exec sha256sum {} +
        sha256sum web/sw.js
    } | awk '{print $1}' | sort | sha256sum | cut -c1-12
)
sed -i "s/__CARIMBO_DA_CONSTRUCAO__/$carimbo/" "$destino/sw.js"
echo "    versão desta construção: $carimbo"

# O GitHub Pages roda Jekyll por padrão, que ignora arquivos e pastas iniciadas
# por underline e pode mexer no que não deve. Este arquivo desliga isso.
touch "$destino/.nojekyll"

tamanho=$(du -h "$destino/wasm/motor_web_bg.wasm" | cut -f1)
tamanho_exato=$(du -h "$destino/wasm-exato/motor_exato_web_bg.wasm" | cut -f1)
echo
echo "==> pronto: $destino/ (Lotinha $tamanho, Exato $tamanho_exato)"
echo "    teste local: python3 -m http.server -d $destino 8000"
