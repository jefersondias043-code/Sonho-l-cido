#!/usr/bin/env python3
"""Os números que a documentação cita, recalculados do catálogo publicado.

Existe para que `docs/fechamentos.md` não envelheça em silêncio. Cada passada do
motor muda quantas entradas estão no mínimo provado, quantos bilhetes custa cada
resposta e quanto se paga por ela — e um número errado num documento é pior do
que número nenhum: quem lê acredita.

    python3 ferramentas/numeros-do-catalogo.py            # só mostra
    python3 ferramentas/numeros-do-catalogo.py --gravar   # e grava no documento

Com `--gravar` as três tabelas do documento são reescritas entre as marcas, e os
números que ficam soltos na prosa — quantas entradas, quantas provadas, quantas
linhas o cliente tem — são cobrados: se algum não aparecer mais no texto, a
ferramenta falha dizendo qual. É o que roda em CI. Se o documento e o catálogo
divergirem, o `git diff` denuncia antes de alguém publicar a promessa errada.
"""
import json
import re
import subprocess
import sys
from collections import Counter

DOC = 'docs/fechamentos.md'
SORTEIO = 15


def marca(nome):
    return (f'<!-- {nome}: gerada por ferramentas/numeros-do-catalogo.py -->',
            f'<!-- fim de {nome} -->')


# ── o que o catálogo diz de si mesmo ────────────────────────────────────────

d = json.load(open('catalogo/indice.json'))
campos = ['v', 'k', 't', 'piso', 'jogos', 'provado', 'metodo', 'soma']
E = [dict(zip(campos, x)) for x in d['entradas']]
met = d['metodos']

com_bilhetes = sum(1 for e in E if e['soma'] != 0)
sem_bilhetes = len(E) - com_bilhetes

# A organização das 330 pela identidade do complemento: `t' = t + a − 15`, com
# `a = v − k`. É estrutural — não depende do que o motor achou —, e por isso
# separa quem resolve cada caso antes de qualquer busca.
familia = Counter()
for e in E:
    a, tl = e['v'] - e['k'], e['t'] + (e['v'] - e['k']) - SORTEIO
    if tl <= 0:
        familia['t<=0'] += 1
    elif tl == a and e['k'] == SORTEIO:
        familia['formula'] += 1
    elif tl == a:
        familia['turan'] += 1
    else:
        familia['motor'] += 1

# De onde vem cada mínimo provado. As duas primeiras famílias o conferidor
# independente refaz sozinho; as outras se apoiam numa cota do `motor-core`.
prov = [e for e in E if e['provado'] == 1]
fechada = [e for e in prov if e['k'] + SORTEIO - e['v'] >= e['t']]
formula = [e for e in prov if e['k'] == SORTEIO and e['t'] == SORTEIO and e not in fechada]
resto = [e for e in prov if e not in fechada and e not in formula]
por_metodo = Counter(met[e['metodo']] for e in resto)
sem_cota = len(fechada) + len(formula)

linhas = int(subprocess.run(
    ['bash', '-c', 'cat publicar/*.js publicar/*.css publicar/*.html | wc -l'],
    capture_output=True, text=True).stdout.strip())
# O mesmo recorte e a mesma divisão que `construir-app.sh` imprime: um número
# quase igual seria pior do que nenhum, porque pareceria conferir.
peso = int(subprocess.run(
    ['bash', '-c', 'cat publicar/*.js publicar/*.css publicar/*.html '
                   'publicar/catalogo/*.json | gzip -9 | wc -c'],
    capture_output=True, text=True).stdout.strip()) // 1024

print(f'entradas             {len(E)}')
print(f'com bilhetes         {com_bilhetes}')
print(f'sem bilhetes         {sem_bilhetes}')
print(f'mínimo provado       {len(prov)}')
print(f'  aritmética fechada {len(fechada)}')
print(f'  fórmula C(v,15)    {len(formula)}')
for nome, n in sorted(por_metodo.items()):
    print(f'  {nome:<18} {n}')
print(f'conferidos sem cota  {sem_cota}')
print(f'linhas do cliente    {linhas}')
print(f'peso inicial         {peso} KiB')

# ── o que o dinheiro compra, pela mesma função que decide na tela ───────────
#
# Não é uma reimplementação: chama `app/estrategia.js`, a função que o
# aplicativo chama. Uma tabela feita por outro caminho poderia estar certa e
# mesmo assim não descrever o que a pessoa recebe.

ESTRATEGIA = r"""
import { readFileSync } from 'node:fs';
const m = await import('./app/estrategia.js');
const precos = JSON.parse(readFileSync('catalogo/precos.json'));
const b = JSON.parse(readFileSync('catalogo/indice.json'));
const indice = { universo: b.universo, entradas: b.entradas.map(
  ([v,k,t,piso,jogos,provado,metodo,soma]) =>
    ({v,k,t,piso,jogos,provado:provado===1,metodo:b.metodos[metodo],soma})) };
const dinheiro = (c) => (c/100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
for (const reais of [5, 25, 100, 400, 1500, 15000]) {
  const c = reais * 100;
  const v = m.melhorPool(indice, precos, c);
  const p = m.melhorEstrategia(indice, precos, { orcamento: c, dezenas: v });
  if (p.motivo !== 'ok') continue;
  const e = p.escolha;
  console.log(`| ${dinheiro(c)} | ${e.v} | **${e.t} acertos** | ${e.jogos} ${e.jogos === 1 ? 'jogo' : 'jogos'} de ${e.k} dezenas | `
    + `${dinheiro(e.custo)} | ${e.provado ? 'mínimo provado' : 'piso ' + e.piso} |`);
}
"""

r = subprocess.run(['node', '--input-type=module', '-e', ESTRATEGIA],
                   capture_output=True, text=True)
if r.returncode != 0:
    raise SystemExit(r.stderr.strip() or 'node falhou sem dizer por quê')

TABELAS = {
    'a tabela do dinheiro': '\n'.join([
        '| orçamento | dezenas | garantia | fechamento | custo | |',
        '|---:|---:|---|---|---:|---|',
        r.stdout.rstrip(),
    ]),
    'a tabela das famílias': '\n'.join([
        '| situação | quantos casos | quem resolve |',
        '|---|---:|---|',
        f"| `t' ≤ 0` | {familia['t<=0']} | aritmética: um bilhete qualquer já garante, e é mínimo provado |",
        f"| `t' = a` e `k = 15` | {familia['formula']} | fórmula: são todos os `C(v,15)` bilhetes, mínimo provado |",
        f"| `t' = a` | {familia['turan']} | sistema de Turán por construção fechada, depois o motor |",
        f"| `0 < t' < a` | {familia['motor']} | o motor, partindo do melhor que houver |",
    ]),
    'a tabela das provas': '\n'.join([
        '| de onde vem o mínimo | quantas | quem confere |',
        '|---|---:|---|',
        '| aritmética fechada — um bilhete de `k` num pool de `v` cruza `k + 15 − v` '
        f'com qualquer sorteio, e quando isso já alcança `t` o mínimo é 1 | {len(fechada)} '
        '| `conferir-tudo` refaz o argumento |',
        '| fórmula — `k = 15` com `t = 15` exige que o bilhete **seja** o sorteio, logo '
        f'todos os `C(v,15)` | {len(formula)} | `conferir-tudo` refaz o argumento |',
    ] + [
        f'| {nome} | {n} | a cota vem de `motor-core`, validada lá contra números publicados |'
        for nome, n in sorted(por_metodo.items(), key=lambda x: -x[1])
    ]),
}

for nome, tabela in TABELAS.items():
    print()
    print(tabela)

# ── e os números que ficam soltos na prosa ─────────────────────────────────
#
# Esses não dá para gerar sem reescrever a frase inteira, e reescrever frase é
# como um documento perde a voz. Então em vez de gerar, cobra-se: cada um tem de
# aparecer no texto, e some se alguém mexer no catálogo sem mexer aqui.

NA_PROSA = {
    'entradas no total': f'**{len(E)} combinações no total**',
    'quantas estão no mínimo provado': f'**{len(prov)} das {len(E)} no mínimo provado**',
    'quantas têm bilhetes': f'{com_bilhetes} com bilhetes',
    'quantas o conferidor refaz sozinho': f'Nos {sem_cota} primeiros',
    'quantas se apoiam numa cota': f'{len(prov) - sem_cota} restantes',
    'as entradas sem bilhetes': f'## As {sem_bilhetes} entradas sem bilhetes',
    'linhas do cliente': f'**{linhas:,} linhas**'.replace(',', '.'),
    'peso inicial': f'**{peso} KiB comprimidos**',
}

texto = open(DOC).read()
for nome, tabela in TABELAS.items():
    abre, fecha = marca(nome)
    i, f = texto.find(abre), texto.find(fecha)
    if i < 0 or f < 0:
        raise SystemExit(f'{DOC} não tem as marcas de {nome}')
    texto = texto[:i] + abre + '\n' + tabela + '\n' + texto[f:]

# A prosa quebra linha onde couber, e uma frase quebrada no meio do número
# continua sendo a mesma frase. Compara-se com os espaços achatados.
corrido = re.sub(r'\s+', ' ', texto)
faltando = [f'{nome}: esperava {trecho!r}'
            for nome, trecho in NA_PROSA.items()
            if re.sub(r'\s+', ' ', trecho) not in corrido]

if '--gravar' in sys.argv:
    antes = open(DOC).read()
    if texto != antes:
        open(DOC, 'w').write(texto)
        print(f'\n{DOC}: tabelas atualizadas')
    else:
        print(f'\n{DOC}: já estava igual ao catálogo')

if faltando:
    print(f'\n{DOC} — números que a prosa deveria citar e não cita:', file=sys.stderr)
    for f in faltando:
        print(f'  {f}', file=sys.stderr)
    raise SystemExit(1)
