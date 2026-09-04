#!/usr/bin/env bash
# Monta o site publicável em `publicar/`.
#
# Não há etapa de compilação: o cliente é JavaScript de módulo, sem dependência
# nenhuma, e o catálogo já está pronto no repositório. O que este script faz é
# juntar as duas coisas e carimbar a versão.
#
# O carimbo é derivado do conteúdo — soma dos arquivos que vão ao ar. Qualquer
# byte diferente muda o carimbo, o cache do navegador muda de nome junto, e quem
# já usava recebe a versão nova. É também o número que aparece no rodapé, para
# conferir se o que está na mão da pessoa é o que acabou de ser publicado.
set -euo pipefail
cd "$(dirname "$0")"

DESTINO=${1:-publicar}

rm -rf "$DESTINO"
mkdir -p "$DESTINO/catalogo"

# O cliente. Arquivos de teste não vão ao ar.
for arquivo in app/*; do
  case "$arquivo" in
    *testar-*) continue ;;
  esac
  cp "$arquivo" "$DESTINO/"
done

cp catalogo/indice.json catalogo/precos.json catalogo/acaso.json "$DESTINO/catalogo/"
cp -r catalogo/f "$DESTINO/catalogo/"

# O carimbo: soma de verificação do conteúdo inteiro, em ordem estável.
#
# O `cd` não é enfeite. `sha256sum` imprime o caminho ao lado do resumo, então
# somar `site/fechamentos/app.js` dá um número diferente de somar
# `publicar/app.js` — e o carimbo, que existe para identificar o **conteúdo**,
# passaria a depender de onde o site foi montado. O mesmo conteúdo tem de sair
# com o mesmo carimbo em qualquer destino.
carimbo=$(
  cd "$DESTINO" &&
    find . -type f -print0 |
    LC_ALL=C sort -z |
    xargs -0 sha256sum |
    sha256sum |
    cut -c1-12
)
sed -i.bak "s/^const CARIMBO = '[^']*';/const CARIMBO = '$carimbo';/" "$DESTINO/sw.js"
rm -f "$DESTINO/sw.js.bak"

# A lista do uso sem internet tem de cobrir a casca inteira. Um arquivo fora
# dela funciona na primeira visita e some na segunda — o pior tipo de defeito,
# porque não aparece em teste nenhum feito com rede.
faltando=0
for arquivo in "$DESTINO"/*; do
  [ -f "$arquivo" ] || continue
  nome=$(basename "$arquivo")
  case "$nome" in
    *.png | sw.js) continue ;;
  esac
  if ! grep -q "'$nome'" "$DESTINO/sw.js"; then
    echo "FALTA na lista do sw.js: $nome" >&2
    faltando=1
  fi
done
[ "$faltando" -eq 0 ] || exit 1

# O cliente inteiro cabe em menos de 1.500 linhas somando JavaScript, HTML e
# CSS. Não é meta estética: é o teto que mantém o cliente uma coisa que uma
# pessoa lê inteira numa tarde. Passar dele quer dizer que alguma decisão foi
# empurrada para cá em vez de resolvida no catálogo.
linhas=$(cat "$DESTINO"/*.js "$DESTINO"/*.css "$DESTINO"/*.html | wc -l)
if [ "$linhas" -ge 1500 ]; then
  echo "o cliente passou de 1.500 linhas: $linhas" >&2
  exit 1
fi

fechamentos=$(find "$DESTINO/catalogo/f" -name '*.json' | wc -l)
peso=$(du -sk "$DESTINO" | cut -f1)
casca=$(cat "$DESTINO"/*.js "$DESTINO"/*.css "$DESTINO"/*.html "$DESTINO"/catalogo/*.json |
  gzip -9 | wc -c)

echo "carimbo $carimbo"
echo "$linhas linhas de cliente (teto: 1.500)"
echo "$fechamentos fechamentos · ${peso} KiB no total"
echo "peso inicial (casca + índice, comprimido): $((casca / 1024)) KiB"
echo "pronto em $DESTINO/"
