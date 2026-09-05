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

# Monta ao lado e só troca no fim, se tudo passar. Sem isto, uma construção
# reprovada — o cliente estourando o teto de linhas, por exemplo — já tinha
# copiado tudo antes de reprovar, e deixava em `publicar/` bytes com cara de
# publicáveis que nenhuma conferência aprovou. As suítes de navegador servem
# essa pasta, e passariam sobre eles.
PARCIAL="$DESTINO.parcial"
trap 'rm -rf "$PARCIAL"' EXIT

rm -rf "$PARCIAL"
mkdir -p "$PARCIAL/catalogo"

# O cliente. Arquivos de teste não vão ao ar.
for arquivo in app/*; do
  case "$arquivo" in
    *testar-*) continue ;;
  esac
  cp "$arquivo" "$PARCIAL/"
done

cp catalogo/indice.json catalogo/precos.json catalogo/acaso.json "$PARCIAL/catalogo/"
cp -r catalogo/f "$PARCIAL/catalogo/"

# O carimbo: soma de verificação do conteúdo inteiro, em ordem estável.
#
# O `cd` não é enfeite. `sha256sum` imprime o caminho ao lado do resumo, então
# somar `site/fechamentos/app.js` dá um número diferente de somar
# `publicar/app.js` — e o carimbo, que existe para identificar o **conteúdo**,
# passaria a depender de onde o site foi montado. O mesmo conteúdo tem de sair
# com o mesmo carimbo em qualquer destino.
carimbo=$(
  cd "$PARCIAL" &&
    find . -type f -print0 |
    LC_ALL=C sort -z |
    xargs -0 sha256sum |
    sha256sum |
    cut -c1-12
)
sed -i.bak "s/^const CARIMBO = '[^']*';/const CARIMBO = '$carimbo';/" "$PARCIAL/sw.js"
rm -f "$PARCIAL/sw.js.bak"

# A lista do uso sem internet tem de cobrir a casca inteira. Um arquivo fora
# dela funciona na primeira visita e some na segunda — o pior tipo de defeito,
# porque não aparece em teste nenhum feito com rede.
faltando=0
for arquivo in "$PARCIAL"/*; do
  [ -f "$arquivo" ] || continue
  nome=$(basename "$arquivo")
  case "$nome" in
    *.png | sw.js) continue ;;
  esac
  if ! grep -q "'$nome'" "$PARCIAL/sw.js"; then
    echo "FALTA na lista do sw.js: $nome" >&2
    faltando=1
  fi
done
[ "$faltando" -eq 0 ] || exit 1

# O cliente inteiro cabe em menos de 1.650 linhas somando JavaScript, HTML e
# CSS. Não é meta estética: é o teto que mantém o cliente uma coisa que uma
# pessoa lê inteira numa tarde. Passar dele quer dizer que alguma decisão foi
# empurrada para cá em vez de resolvida no catálogo.
#
# O teto foi 1.500 até o aplicativo passar a ter dois modos. O modo manual —
# quem já sabe o fechamento que quer e monta direto, sem partir do dinheiro —
# é uma segunda porta de entrada inteira: lista de fechamentos, ajuste do
# pool, plano fixo. Isso não é decisão empurrada para o cliente; é um jeito de
# usar que o catálogo não tem como resolver sozinho, porque a escolha é do
# usuário. As 159 linhas a mais são essa porta, e o teto voltou a apertar.
linhas=$(cat "$PARCIAL"/*.js "$PARCIAL"/*.css "$PARCIAL"/*.html | wc -l)
if [ "$linhas" -ge 1650 ]; then
  echo "o cliente passou de 1.650 linhas: $linhas" >&2
  exit 1
fi

fechamentos=$(find "$PARCIAL/catalogo/f" -name '*.json' | wc -l)
peso=$(du -sk "$PARCIAL" | cut -f1)
casca=$(cat "$PARCIAL"/*.js "$PARCIAL"/*.css "$PARCIAL"/*.html "$PARCIAL"/catalogo/*.json |
  gzip -9 | wc -c)

echo "carimbo $carimbo"
echo "$linhas linhas de cliente (teto: 1.650)"
echo "$fechamentos fechamentos · ${peso} KiB no total"
echo "peso inicial (casca + índice, comprimido): $((casca / 1024)) KiB"
# Tudo passou: só agora a pasta publicável passa a existir.
rm -rf "$DESTINO"
mv "$PARCIAL" "$DESTINO"
echo "pronto em $DESTINO/"
