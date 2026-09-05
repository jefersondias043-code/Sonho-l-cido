#!/usr/bin/env python3
"""Um conferidor que nunca reprova é pior do que conferidor nenhum.

`conferir-tudo` é o que bloqueia a publicação: se ele passa, o site vai ao ar
dizendo "está garantido". Rodá-lo sobre o catálogo bom prova que ele aceita o
que é bom — e não prova nada sobre o que ele faria com o que é ruim. Um laço de
cobertura quebrado, uma comparação invertida, um `return Ok` fora do lugar:
qualquer um deles passaria despercebido para sempre, porque o catálogo publicado
está certo e ele diria que sim.

Aqui o catálogo é estragado de propósito, um defeito de cada vez, e se cobra que
ele **reprove** cada um. Cada defeito é o menor possível e mexe numa coisa só,
para que reprovar signifique reprovar aquilo — e não outra coisa junto.

    python3 ferramentas/provar-o-conferidor.py [caminho-do-binario]
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BINARIO = Path(sys.argv[1] if len(sys.argv) > 1 else 'target/release/conferir-tudo')
ORIGEM = Path('catalogo')
CAMPOS = ['v', 'k', 't', 'piso', 'jogos', 'provado', 'metodo', 'soma']


def compacto(dado) -> str:
    """JSON sem espaço depois dos dois-pontos, como o gerador grava.

    Não é asseio: o conferidor não usa biblioteca de JSON — tem leitor próprio,
    de propósito, para não compartilhar nada com quem gerou o catálogo — e ele
    procura a sequência exata `"entradas":[`. Gravando com o espaço que o
    `json.dumps` põe por padrão, ele lê zero entradas e reprova por isso.

    Foi o que aconteceu na primeira versão deste arquivo: os oito defeitos eram
    reprovados, todos pelo mesmo motivo errado, e o teste parecia verde.
    """
    return json.dumps(dado, separators=(',', ':'), ensure_ascii=False)


def soma_de_verificacao(texto: str) -> int:
    """FNV-1a de 32 bits — a mesma do gerador, do índice e do cliente."""
    h = 0x811C9DC5
    for c in texto:
        h = ((h ^ ord(c)) * 0x01000193) & 0xFFFFFFFF
    return h


class Catalogo:
    """Uma cópia do catálogo, para estragar à vontade."""

    def __init__(self, raiz: Path):
        self.raiz = raiz
        self.indice = json.loads((raiz / 'indice.json').read_text())

    def linha(self, v, k, t):
        for e in self.indice['entradas']:
            if (e[0], e[1], e[2]) == (v, k, t):
                return e
        raise SystemExit(f'{v}-{k}-{t} não está no índice')

    def bilhetes(self, v, k, t):
        return json.loads((self.raiz / f'f/{v}-{k}-{t}.json').read_text())

    def gravar_bilhetes(self, arquivo):
        caminho = self.raiz / f"f/{arquivo['v']}-{arquivo['k']}-{arquivo['t']}.json"
        caminho.write_text(compacto(arquivo))

    def gravar(self):
        (self.raiz / 'indice.json').write_text(compacto(self.indice))


def sem_um_bilhete(c: Catalogo):
    """Falta um bilhete, e tudo o mais bate.

    Escolhido para que o índice continue coerente: a contagem e a soma são
    refeitas, e 41 ainda está acima do piso de 16. Sobra um defeito só —
    existe sorteio que ninguém atende —, e só a varredura pode achá-lo.
    """
    arq = c.bilhetes(20, 15, 13)
    arq['bilhetes'] = arq['bilhetes'][:-1]
    arq['jogos'] = len(arq['bilhetes'])
    arq['soma'] = soma_de_verificacao(','.join(arq['bilhetes']))
    c.gravar_bilhetes(arq)
    linha = c.linha(20, 15, 13)
    linha[CAMPOS.index('jogos')] = arq['jogos']
    linha[CAMPOS.index('soma')] = arq['soma']
    c.gravar()


def base36(n: int) -> str:
    """A codificação do catálogo. Escrever em hexadecimal aqui daria um bilhete
    com outro número de dezenas, e a reprovação viria da forma, não da falta."""
    digitos = '0123456789abcdefghijklmnopqrstuvwxyz'
    saida = ''
    while n:
        saida = digitos[n % 36] + saida
        n //= 36
    return saida or '0'


def com_bilhete_trocado(c: Catalogo):
    """Um bilhete vira outro — mesmo tamanho, dentro do pool, e não repetido.

    Tudo o que a forma pode conferir continua batendo: são 42 bilhetes de 15
    dezenas, todos distintos, todos dentro das 20 posições, com soma e contagem
    refeitas. O único defeito possível é de cobertura, e achá-lo exige varrer.
    """
    arq = c.bilhetes(20, 15, 13)
    havia = set(arq['bilhetes'])
    for deslocamento in range(6):
        candidato = base36(((1 << 15) - 1) << deslocamento)
        if candidato not in havia:
            arq['bilhetes'][0] = candidato
            break
    else:
        raise SystemExit('não achei um bilhete de troca fora do fechamento')
    arq['soma'] = soma_de_verificacao(','.join(arq['bilhetes']))
    c.gravar_bilhetes(arq)
    linha = c.linha(20, 15, 13)
    linha[CAMPOS.index('soma')] = arq['soma']
    c.gravar()


def com_soma_mentirosa(c: Catalogo):
    """O arquivo é bom; o índice diz outra soma."""
    linha = c.linha(20, 15, 13)
    linha[CAMPOS.index('soma')] ^= 1
    c.gravar()


def com_contagem_mentirosa(c: Catalogo):
    """O índice promete um bilhete a mais do que o arquivo tem."""
    linha = c.linha(20, 15, 13)
    linha[CAMPOS.index('jogos')] += 1
    c.gravar()


def abaixo_do_piso(c: Catalogo):
    """O índice anuncia menos bilhetes do que o piso provado permite."""
    linha = c.linha(20, 15, 13)
    linha[CAMPOS.index('piso')] = linha[CAMPOS.index('jogos')] + 1
    c.gravar()


def provado_sem_prova(c: Catalogo):
    """O selo de mínimo provado onde os dois limites não se encontram."""
    linha = c.linha(20, 15, 13)
    linha[CAMPOS.index('provado')] = 1
    c.gravar()


def sem_uma_entrada(c: Catalogo):
    """Uma das 330 sai do índice."""
    c.indice['entradas'] = [e for e in c.indice['entradas'] if (e[0], e[1], e[2]) != (20, 15, 13)]
    c.gravar()


def um_bilhete_a_mais_repetido(c: Catalogo):
    """O mesmo bilhete duas vezes — cobertura intacta, catálogo desonesto."""
    arq = c.bilhetes(20, 15, 13)
    arq['bilhetes'].append(arq['bilhetes'][0])
    arq['jogos'] = len(arq['bilhetes'])
    arq['soma'] = soma_de_verificacao(','.join(arq['bilhetes']))
    c.gravar_bilhetes(arq)
    linha = c.linha(20, 15, 13)
    linha[CAMPOS.index('jogos')] = arq['jogos']
    linha[CAMPOS.index('soma')] = arq['soma']
    c.gravar()


# Cada defeito com o motivo pelo qual tem de ser reprovado. Cobrar só o código
# de saída aceitaria "reprovou por outra coisa", que é como um teste destes fica
# verde sem testar nada — foi assim que a primeira versão daqui passou, com o
# índice ilegível reprovando os oito pelo mesmo engano.
DEFEITOS = [
    ('falta um bilhete, e só a varredura pode ver', sem_um_bilhete, 'não é coberto'),
    ('um bilhete trocado por outro, e de novo só a varredura vê',
     com_bilhete_trocado, 'não é coberto'),
    ('a soma do índice não é a do arquivo', com_soma_mentirosa, 'soma de verificação'),
    ('o índice conta um bilhete a mais', com_contagem_mentirosa, 'o índice diz'),
    ('o tamanho anunciado fica abaixo do piso', abaixo_do_piso, 'abaixo do piso'),
    ('mínimo provado onde os limites não se encontram', provado_sem_prova, 'marca provado'),
    ('uma das 330 sumiu do índice', sem_uma_entrada, 'aparece 0 vezes'),
    ('o mesmo bilhete duas vezes', um_bilhete_a_mais_repetido, 'bilhete repetido'),
]


def rodar(raiz: Path):
    return subprocess.run([str(BINARIO), str(raiz)], capture_output=True, text=True)


def main():
    if not BINARIO.exists():
        raise SystemExit(f'{BINARIO} não existe — compile com cargo build --release')

    falhas = []
    with tempfile.TemporaryDirectory() as tmp:
        bom = Path(tmp) / 'bom'
        shutil.copytree(ORIGEM, bom)
        saida = rodar(bom)
        if saida.returncode != 0:
            raise SystemExit(f'o catálogo bom foi reprovado — nada mais faz sentido:\n{saida.stdout}')
        print(f'{len(DEFEITOS) + 1} conferências')
        print('  o catálogo bom passa')

        for nome, estragar, motivo in DEFEITOS:
            with tempfile.TemporaryDirectory() as t2:
                ruim = Path(t2) / 'ruim'
                shutil.copytree(ORIGEM, ruim)
                estragar(Catalogo(ruim))
                saida = rodar(ruim)
                if saida.returncode == 0:
                    falhas.append(f'{nome} — PASSOU, e não devia')
                elif motivo not in saida.stdout:
                    dito = next((l for l in saida.stdout.splitlines() if 'REPROVA' in l), '(nada)')
                    falhas.append(f'{nome} — reprovou por outro motivo: {dito}')
                else:
                    print(f'  reprova: {nome}')

    if falhas:
        print('\nFALHAS:', file=sys.stderr)
        for f in falhas:
            print(f'  {f}', file=sys.stderr)
        raise SystemExit(1)
    print('o conferidor reprova o que tem de reprovar')


main()
