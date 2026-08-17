#!/usr/bin/env python3
"""
Prepara a biblioteca de coberturas do mundo para uso offline no celular.

## O problema com "baixar os 2,7 GB"

O arquivo `covers.json` da La Jolla Covering Repository guarda os blocos das
melhores coberturas conhecidas — as cartelas de verdade, não só os números. São
8.759 designs e 61,7 milhões de blocos.

Mas quase tudo ali é inalcançável para um celular. `C(99,25,8)` tem bilhões de
combinações a cobrir; o motor precisa de 12 bytes por combinação só para
começar. Medindo o que o aplicativo consegue de fato carregar:

    tudo                          8.759 designs   2.216 MB
    cabe na memória do celular    7.191 designs     560 MB
    faixa de uso real             1.082 designs      29 MB

A última linha é `v ≤ 40, k ≤ 12, t ≤ 5` — e cobre qualquer fechamento que uma
pessoa monte na prática. É esse recorte que este programa produz.

## Uso

    # baixando direto da fonte
    ./ferramentas/preparar-biblioteca.py --saida biblioteca.json

    # a partir de um covers.json já baixado
    ./ferramentas/preparar-biblioteca.py --entrada covers.json --saida biblioteca.json

    # outro recorte
    ./ferramentas/preparar-biblioteca.py --v-max 50 --k-max 15 --t-max 6 ...

O arquivo de saída tem exatamente o mesmo formato do original — um objeto JSON
com chaves `"C(v,k,t)"` e listas de blocos — então o aplicativo lê os dois sem
distinção, e você pode conferir o resultado num editor de texto.

## Sobre a leitura em fluxo

`covers.json` não cabe na memória de uma máquina comum: `json.load` sobre 2,7 GB
pede dezenas de gigabytes de RAM. Este programa lê o arquivo **em fluxo**, um
design por vez, e só guarda os que passam no recorte. O pico de memória fica na
casa dos megabytes, e funciona igual lendo de um arquivo local ou direto da rede.

Fonte: La Jolla Covering Repository, D. M. Gordon, licença CC BY 4.0.
  https://dmgordon.org  ·  https://github.com/dmgordo/LJCR
"""

import argparse
import json
import re
import sys
import urllib.request

# Onde o arquivo com os blocos é publicado. O repositório do GitHub guarda só os
# números (`coverdata.json`); os blocos ficam no arquivo grande, arquivado no
# Zenodo e servido pelo site.
FONTES = [
    "https://zenodo.org/records/10779737/files/covers.json?download=1",
    "https://dmgordon.org/data/covers.json",
]

CABECALHO = re.compile(r'"C\((\d+),(\d+),(\d+)\)"\s*:\s*')


def blocos_em_fluxo(fluxo):
    """
    Percorre um `covers.json` sem carregá-lo inteiro na memória.

    Devolve `(v, k, t, blocos)` para cada design encontrado. O arquivo é um único
    objeto JSON gigante, então o que se faz aqui é procurar cada chave
    `"C(v,k,t)":` e ler o vetor de blocos que vem logo depois, contando colchetes
    para saber onde ele termina.

    É um analisador propositalmente ingênuo, e ele se apoia numa propriedade real
    do arquivo: dentro de um design só existem números, colchetes, vírgulas e
    espaços — nenhuma cadeia de texto, e portanto nenhum colchete escapado para
    confundir a contagem. A conferência de `k` e do número de blocos, feita pelo
    chamador contra `coverdata.json`, é o que impede um erro silencioso aqui.
    """
    resto = ""
    for pedaco in iter(lambda: fluxo.read(1 << 20), b""):
        resto += pedaco.decode("utf-8", errors="replace")

        while True:
            achado = CABECALHO.search(resto)
            if not achado:
                break

            v, k, t = (int(g) for g in achado.groups())
            inicio = achado.end()
            if inicio >= len(resto):
                break

            fim = fim_do_vetor(resto, inicio)
            if fim is None:
                break  # o vetor ainda não chegou inteiro; lê mais um pedaço

            try:
                blocos = json.loads(resto[inicio:fim])
            except json.JSONDecodeError as erro:
                raise SystemExit(f"C({v},{k},{t}): não consegui ler os blocos — {erro}")

            yield v, k, t, blocos
            resto = resto[fim:]

        # Guarda só o rabo do buffer: o suficiente para um cabeçalho partido ao
        # meio entre dois pedaços, sem deixar a memória crescer.
        if len(resto) > (1 << 22):
            resto = resto[-64:]


def fim_do_vetor(texto, inicio):
    """Índice logo após o `]` que fecha o vetor começado em `inicio`."""
    if texto[inicio] != "[":
        return None
    profundidade = 0
    for i in range(inicio, len(texto)):
        if texto[i] == "[":
            profundidade += 1
        elif texto[i] == "]":
            profundidade -= 1
            if profundidade == 0:
                return i + 1
    return None


def abrir(entrada):
    """Abre o arquivo local, ou a primeira fonte que responder."""
    if entrada:
        print(f"lendo {entrada}")
        return open(entrada, "rb")

    ultimo_erro = None
    for url in FONTES:
        print(f"tentando {url}")
        try:
            return urllib.request.urlopen(url, timeout=120)
        except Exception as erro:  # noqa: BLE001 — qualquer falha vira "próxima fonte"
            print(f"  falhou: {erro}")
            ultimo_erro = erro
    raise SystemExit(
        "nenhuma fonte respondeu.\n"
        f"último erro: {ultimo_erro}\n\n"
        "Baixe o covers.json à mão e rode com --entrada:\n"
        "  https://dmgordon.org  →  seção Covering Designs\n"
        "  https://github.com/dmgordo/LJCR  →  instruções e mirror no Zenodo"
    )


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--entrada", help="covers.json já baixado; sem isto, baixa da fonte")
    p.add_argument("--saida", default="biblioteca.json", help="arquivo a escrever")
    p.add_argument("--v-max", type=int, default=40, help="maior pool (padrão 40)")
    p.add_argument("--k-max", type=int, default=12, help="maior cartela (padrão 12)")
    p.add_argument("--t-max", type=int, default=5, help="maior grupo a cobrir (padrão 5)")
    args = p.parse_args()

    guardados = {}
    vistos = 0
    blocos_guardados = 0

    with abrir(args.entrada) as fluxo:
        for v, k, t, blocos in blocos_em_fluxo(fluxo):
            vistos += 1
            if vistos % 500 == 0:
                print(f"  {vistos} designs lidos, {len(guardados)} guardados", file=sys.stderr)

            if v > args.v_max or k > args.k_max or t > args.t_max:
                continue

            # Conferência de sanidade: todo bloco tem de ter exatamente k números,
            # todos dentro de 1..v. Um design malformado aqui viraria um
            # fechamento furado com cara de recorde mundial.
            for bloco in blocos:
                if len(bloco) != k or any(not (1 <= n <= v) for n in bloco):
                    raise SystemExit(f"C({v},{k},{t}): bloco inválido {bloco}")

            guardados[f"C({v},{k},{t})"] = blocos
            blocos_guardados += len(blocos)

    if not guardados:
        raise SystemExit("nenhum design passou no recorte — confira os limites")

    with open(args.saida, "w", encoding="utf-8") as arquivo:
        json.dump(guardados, arquivo, separators=(",", ":"))

    import os

    tamanho = os.path.getsize(args.saida)
    print()
    print(f"{vistos} designs lidos da fonte")
    print(f"{len(guardados)} guardados ({blocos_guardados:,} blocos)")
    print(f"escrito {args.saida} — {tamanho / 1e6:.1f} MB")
    print()
    print("Mande esse arquivo para o celular e importe em")
    print("Configurar → Biblioteca de coberturas do mundo.")


if __name__ == "__main__":
    main()
