#!/usr/bin/env python3
"""
Atualiza a tabela de referência mundial de coberturas.

Baixa o arquivo oficial da La Jolla Covering Repository e o reduz ao que o motor
precisa: para cada configuração C(v,k,t), o melhor resultado já produzido no
mundo e o melhor limite inferior já provado.

O arquivo original tem 6,2 MB porque guarda o histórico completo de cada
melhoria — quem submeteu, por qual método, em que data. Nada disso serve dentro
de um aplicativo de celular. O que sobra são dois números por linha, e o
resultado cabe em pouco mais de cem quilobytes.

    ./ferramentas/atualizar-referencia.py

O CSV gerado vai **versionado no repositório**. É de propósito: a construção não
pode depender de rede, e uma mudança nos números do mundo tem de aparecer como
diferença revisável, não acontecer sozinha entre duas construções.

Fonte: https://github.com/dmgordo/LJCR — D. M. Gordon, La Jolla Covering
Repository, licença CC BY 4.0.
"""

import json
import pathlib
import sys
import urllib.request

FONTE = "https://raw.githubusercontent.com/dmgordo/LJCR/main/coverings/coverdata.json"

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "crates" / "motor-core" / "dados" / "ljcr.csv"

# Acima disto o motor não consegue trabalhar: o pool é limitado a 128 elementos
# (`POOL_MAXIMO`, em problema.rs). Guardar linhas inalcançáveis só engordaria o
# WebAssembly. Hoje a tabela vai até v=99, então nada é descartado — o limite
# existe para o dia em que a fonte crescer.
V_MAXIMO = 128


def schonheim(v: int, k: int, t: int) -> int:
    """Réplica da cota de Schönheim, para conferir a fonte antes de aceitá-la."""
    if t == 0 or k == 0 or t > k or k > v:
        return 0
    if t == 1:
        return -(-v // k)
    return -(-(v * schonheim(v - 1, k - 1, t - 1)) // k)


def parametros(chave: str) -> tuple[int, int, int]:
    """`"C(21,5,2)"` → `(21, 5, 2)`."""
    dentro = chave[chave.index("(") + 1 : chave.index(")")]
    v, k, t = (int(x) for x in dentro.split(","))
    return v, k, t


def main() -> int:
    print(f"baixando {FONTE}")
    with urllib.request.urlopen(FONTE) as resposta:
        bruto = json.load(resposta)
    print(f"  {len(bruto)} configurações no arquivo de origem")

    linhas = []
    descartadas = 0
    for chave, entrada in bruto.items():
        v, k, t = parametros(chave)
        if v > V_MAXIMO:
            descartadas += 1
            continue

        melhor = int(entrada["size"])
        limite = int(entrada["low_bd"])

        # Três conferências antes de deixar um número entrar no motor. Um limite
        # inferior errado é o pior defeito possível aqui: faria o aplicativo
        # declarar "ótimo provado" em cima de uma solução que talvez não seja.
        if limite > melhor:
            raise SystemExit(f"{chave}: limite {limite} acima do melhor conhecido {melhor}")
        if limite < schonheim(v, k, t):
            raise SystemExit(f"{chave}: limite {limite} abaixo da cota de Schönheim")
        if melhor <= 0 or limite <= 0:
            raise SystemExit(f"{chave}: números não positivos")

        linhas.append((v, k, t, melhor, limite))

    linhas.sort()
    print(f"  {len(linhas)} guardadas, {descartadas} acima de v={V_MAXIMO}")

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    with DESTINO.open("w", encoding="utf-8") as arquivo:
        arquivo.write(
            "# Melhores coberturas conhecidas no mundo, e melhores limites inferiores\n"
            "# já provados, para o covering design C(v,k,t).\n"
            "#\n"
            "# Fonte: La Jolla Covering Repository, D. M. Gordon.\n"
            "#   https://github.com/dmgordo/LJCR\n"
            "# Licença: Creative Commons Attribution 4.0 (CC BY 4.0).\n"
            "#\n"
            "# Gerado por ferramentas/atualizar-referencia.py — não editar à mão.\n"
            "#\n"
            "# v,k,t,melhor_conhecido,limite_publicado\n"
        )
        for v, k, t, melhor, limite in linhas:
            arquivo.write(f"{v},{k},{t},{melhor},{limite}\n")

    tamanho = DESTINO.stat().st_size
    print(f"escrito {DESTINO.relative_to(RAIZ)} ({tamanho / 1024:.1f} KiB)")
    return 0


if __name__ == "__main__":
    sys.setrecursionlimit(10_000)
    sys.exit(main())
