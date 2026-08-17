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

echo "==> copiando a interface"
cp -r web/. "$destino/"

# Ferramentas de desenvolvimento não vão ao ar: o gerador de ícones (os PNGs
# que ele produz são versionados) e o teste de navegador.
rm -f "$destino/gerar-icones.py" "$destino/testar.mjs"

# O GitHub Pages roda Jekyll por padrão, que ignora arquivos e pastas iniciadas
# por underline e pode mexer no que não deve. Este arquivo desliga isso.
touch "$destino/.nojekyll"

tamanho=$(du -h "$destino/wasm/motor_web_bg.wasm" | cut -f1)
echo
echo "==> pronto: $destino/ ($tamanho de WebAssembly)"
echo "    teste local: python3 -m http.server -d $destino 8000"
