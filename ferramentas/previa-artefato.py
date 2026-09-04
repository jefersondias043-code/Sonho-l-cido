#!/usr/bin/env python3
"""
Empacota o aplicativo inteiro num arquivo HTML só, para dar de ver.

Serve para uma coisa: abrir o aplicativo num lugar onde não há servidor de
arquivos — uma prévia enviada por link, um anexo, um pendrive. O que sai daqui
**não** é o que vai ao ar: o que vai ao ar é `publicar/`, com os módulos
separados, o catálogo em arquivos que o navegador guarda um a um, e o service
worker fazendo a segunda visita funcionar sem rede. Aqui tudo isso vira um
arquivo de dois megabytes que carrega de uma vez.

Como o cliente é JavaScript de módulo e um arquivo só não tem de onde importar,
os cinco módulos são costurados num só: tiram-se os `import` e os `export`, e as
chamadas com prefixo de espaço de nomes (`catalogo.emDezenas`) viram chamadas
diretas. Um único nome colidia entre módulos — `baixar` — e é renomeado antes.

O catálogo entra embutido e `fetch` é desviado para ele.

    python3 ferramentas/previa-artefato.py [saida.html]
"""

import json
import pathlib
import re
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
APP = RAIZ / "app"
CATALOGO = RAIZ / "catalogo"

# Ordem de dependência: quem é usado vem antes de quem usa.
MODULOS = ["catalogo.js", "conferir.js", "volante.js", "estrategia.js", "app.js"]
ESPACOS = ("catalogo", "conferir", "volante")


def costurar() -> str:
    partes = []
    for nome in MODULOS:
        fonte = (APP / nome).read_text()
        if nome == "catalogo.js":
            # `baixar` existe nos dois módulos, com sentidos diferentes: aqui é
            # trazer do catálogo, em volante.js é oferecer um arquivo para
            # salvar. Juntos, um sobrescreveria o outro em silêncio.
            fonte = re.sub(r"\bbaixar\b", "baixarDoCatalogo", fonte)
        fonte = re.sub(r"^import\s[^;]*;\s*$", "", fonte, flags=re.MULTILINE)
        fonte = re.sub(r"^export\s+(?=(function|const|class|async))", "", fonte, flags=re.MULTILINE)
        partes.append(f"// ═══ {nome} " + "═" * (60 - len(nome)) + f"\n\n{fonte}")

    costurado = "\n\n".join(partes)
    return re.sub(rf"\b({'|'.join(ESPACOS)})\.(?=[a-zA-Z])", "", costurado)


def embutir_catalogo() -> dict:
    arquivos = {
        "indice.json": json.loads((CATALOGO / "indice.json").read_text()),
        "precos.json": json.loads((CATALOGO / "precos.json").read_text()),
        "acaso.json": json.loads((CATALOGO / "acaso.json").read_text()),
    }
    for fechamento in sorted((CATALOGO / "f").glob("*.json")):
        arquivos[f"f/{fechamento.name}"] = json.loads(fechamento.read_text())
    return arquivos


def main() -> None:
    saida = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else RAIZ / "previa.html")

    html = (APP / "index.html").read_text()
    corpo = html[html.index("<body>") + len("<body>") : html.index("</body>")]
    corpo = corpo.replace('<script type="module" src="app.js"></script>', "")

    estilo = (APP / "estilo.css").read_text()
    icone = (APP / "icone.svg").read_text()
    catalogo = json.dumps(embutir_catalogo(), separators=(",", ":"), ensure_ascii=False)

    # O carimbo da prévia é o do site construído, quando houver — assim o rodapé
    # diz de qual versão esta prévia saiu.
    sw = RAIZ / "publicar" / "sw.js"
    carimbo = "prévia"
    if sw.exists():
        achado = re.search(r"CARIMBO = '([^']+)'", sw.read_text())
        carimbo = achado.group(1) if achado else carimbo

    saida.write_text(
        f"""<title>Sonho Lúcido — fechamentos da Lotofácil</title>
<style>
{estilo}
/* A prévia não tem service worker; o rodapé diz de onde ela saiu. */
.previa {{ max-width: var(--coluna); margin: 0 auto; padding: 0 1rem;
  font-size: 0.85rem; color: var(--tinta-fraca); }}
</style>

<div class="previa">Prévia de um arquivo só — o aplicativo publicado tem
service worker, e funciona sem internet a partir da segunda visita.</div>
{corpo}

<script>
// O catálogo inteiro, embutido. `fetch` é desviado para ele; qualquer outro
// endereço continua indo para a rede, e falhando com elegância como sempre.
const CATALOGO_EMBUTIDO = {catalogo};
const DA_REDE = window.fetch.bind(window);
window.fetch = (alvo, opcoes) => {{
  const chave = String(alvo).replace(/^.*catalogo\\//, '');
  if (chave in CATALOGO_EMBUTIDO) {{
    return Promise.resolve(new Response(JSON.stringify(CATALOGO_EMBUTIDO[chave]),
      {{ headers: {{ 'content-type': 'application/json' }} }}));
  }}
  if (String(alvo).endsWith('sw.js')) {{
    return Promise.resolve(new Response("const CARIMBO = '{carimbo}';"));
  }}
  return DA_REDE(alvo, opcoes);
}};
</script>

<script type="module">
{costurar()}
</script>

<link rel="icon" href="data:image/svg+xml;utf8,{icone.replace('"', "'").replace('#', '%23')}">
""",
        encoding="utf-8",
    )
    print(f"{saida} — {saida.stat().st_size / 1024 / 1024:.1f} MiB")


if __name__ == "__main__":
    main()
