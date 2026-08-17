#!/usr/bin/env python3
"""
Gera os ícones do aplicativo.

O desenho é o **plano de Fano**: sete pontos, sete linhas, cada par de pontos
aparecendo em exatamente uma linha. É o menor covering design que existe,
C(7,3,2) = 7 — e é literalmente o primeiro caso que o motor resolve e prova.

Um símbolo que também é um teorema.

    python3 web/gerar-icones.py
"""

import math
from PIL import Image, ImageDraw

FUNDO = (11, 16, 32)
LINHA = (122, 162, 255)
PONTO = (255, 199, 90)

# As sete retas do plano de Fano, por índice de ponto.
# Pontos 0-2: vértices | 3-5: meios dos lados | 6: centro.
RETAS = [
    (0, 3, 1),  # lado de cima
    (1, 4, 2),  # lado da direita
    (2, 5, 0),  # lado da esquerda
    (0, 6, 4),  # mediana de um vértice ao lado oposto
    (1, 6, 5),
    (2, 6, 3),
    (3, 4, 5),  # a circunferência inscrita, a sétima "reta"
]


def posicoes(tamanho):
    """Coordenadas dos sete pontos, centradas na imagem."""
    centro = tamanho / 2
    raio = tamanho * 0.33

    vertices = [
        (centro + raio * math.cos(math.radians(angulo)),
         centro + raio * math.sin(math.radians(angulo)))
        for angulo in (-90, 30, 150)
    ]

    def meio(a, b):
        return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)

    return [
        vertices[0],
        vertices[1],
        vertices[2],
        meio(vertices[0], vertices[1]),
        meio(vertices[1], vertices[2]),
        meio(vertices[2], vertices[0]),
        (centro, centro),
    ]


def desenhar(tamanho):
    # Desenha em escala 4x e reduz no final: é o jeito de obter bordas suaves
    # sem depender de antisserrilhamento nativo, que o Pillow não faz em linhas.
    escala = 4
    grande = tamanho * escala
    imagem = Image.new("RGB", (grande, grande), FUNDO)
    pincel = ImageDraw.Draw(imagem)

    pontos = posicoes(grande)
    espessura = max(2, int(grande * 0.012))

    # As seis retas de fato retas.
    for reta in RETAS[:-1]:
        a, _, c = reta
        pincel.line([pontos[a], pontos[c]], fill=LINHA, width=espessura)

    # A sétima reta é o círculo que passa pelos três pontos médios.
    centro = grande / 2
    raio_circulo = math.dist(pontos[3], (centro, centro))
    pincel.ellipse(
        [centro - raio_circulo, centro - raio_circulo,
         centro + raio_circulo, centro + raio_circulo],
        outline=LINHA,
        width=espessura,
    )

    # Os pontos por cima das linhas.
    raio_ponto = grande * 0.035
    for x, y in pontos:
        pincel.ellipse(
            [x - raio_ponto, y - raio_ponto, x + raio_ponto, y + raio_ponto],
            fill=PONTO,
        )

    return imagem.resize((tamanho, tamanho), Image.LANCZOS)


if __name__ == "__main__":
    import pathlib

    destino = pathlib.Path(__file__).parent
    for tamanho in (180, 512):
        caminho = destino / f"icone-{tamanho}.png"
        desenhar(tamanho).save(caminho, optimize=True)
        print(f"gerado {caminho.name}")
