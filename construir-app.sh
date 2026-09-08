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

# O cliente inteiro cabe em menos de 2.700 linhas somando JavaScript, HTML e CSS.
#
# Vale dizer o que este número é hoje, porque ele já não é o que era. Ele nasceu
# em 1.500, como limite de projeto: o cliente tinha uma porta de entrada só, e o
# número era um jeito curto de dizer "aqui não se resolve nada, então aqui não
# cresce". Passou a 1.700 com a segunda porta — a pessoa nomeando o fechamento
# em vez de partir do dinheiro —, a 2.250 com a área de análise (as cartelas, a
# conferência, a simulação e a conta do dinheiro), a 2.400 com a comparação
# contra o chute, a 2.500 quando o que entra de fora — endereço, armazenamento
# do aparelho, resultado guardado — passou a ser conferido antes de virar tela,
# a 2.600 quando o prêmio passou a decompor cada cartela nas apostas simples que
# ela é, e a 2.700 quando a carteira deixou de ser só uma lista: o fechamento que
# a pessoa guardou volta para a tela com um toque, e a tela passou a dizer de
# onde ele veio.
#
# A regra que ele guardava continua de pé, e é esta: **o cliente não resolve
# fechamento nenhum**. Procurar quais bilhetes usar é trabalho do motor em Rust,
# fora do aparelho. O que o cliente faz é escolher uma linha de um catálogo
# pronto e contar acertos de bilhetes que já existem — `and` e popcount, mil
# sorteios contra as 3.608 cartelas do maior fechamento em 85 ms.
#
# Mas quem **cobra** essa regra não é este número, e nunca foi: é
# `app/testar-conferir.mjs`, varrendo os fechamentos publicados sorteio a
# sorteio contra o que o catálogo promete. O número aqui é um marcador de
# crescimento — serve para que crescer seja uma decisão, e não um descuido.
# Subi-lo é legítimo quando o aplicativo passa a oferecer algo que não oferecia;
# não é legítimo quando uma decisão que devia ter ficado no catálogo vazou para
# cá. Da última vez, o que entrou foi a conta que decompõe uma cartela de mais
# de 15 dezenas nas apostas simples que ela **é** — a lotérica cobra por todas e
# paga por todas, e o aplicativo pagava por uma — e a linha do topo que diz a
# quem chega pelo link o que é isto, antes de a tela pedir dinheiro.
linhas=$(cat "$PARCIAL"/*.js "$PARCIAL"/*.css "$PARCIAL"/*.html | wc -l)
if [ "$linhas" -ge 2700 ]; then
  echo "o cliente passou de 2.700 linhas: $linhas" >&2
  exit 1
fi

fechamentos=$(find "$PARCIAL/catalogo/f" -name '*.json' | wc -l)
peso=$(du -sk "$PARCIAL" | cut -f1)
casca=$(cat "$PARCIAL"/*.js "$PARCIAL"/*.css "$PARCIAL"/*.html "$PARCIAL"/catalogo/*.json |
  gzip -9 | wc -c)

echo "carimbo $carimbo"
echo "$linhas linhas de cliente (teto: 2.700)"
echo "$fechamentos fechamentos · ${peso} KiB no total"
echo "peso inicial (casca + índice, comprimido): $((casca / 1024)) KiB"
# Tudo passou: só agora a pasta publicável passa a existir.
rm -rf "$DESTINO"
mv "$PARCIAL" "$DESTINO"
echo "pronto em $DESTINO/"
