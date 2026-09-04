#!/usr/bin/env python3
"""Os números que a documentação cita, recalculados do catálogo publicado.

Existe para que `docs/fechamentos.md` e o `README.md` não envelheçam em silêncio.
Cada passada do motor muda quantas entradas estão no mínimo provado, e um número
errado num documento é pior do que número nenhum: quem lê acredita.

    python3 ferramentas/numeros-do-catalogo.py
"""
import json
import subprocess
from collections import Counter
d = json.load(open('catalogo/indice.json'))
E = [dict(zip(['v','k','t','piso','jogos','provado','metodo','soma'], x)) for x in d['entradas']]
met = d['metodos']
prov = [e for e in E if e['provado'] == 1]
fechada = [e for e in prov if e['k'] + 15 - e['v'] >= e['t']]
formula = [e for e in prov if e['k'] == 15 and e['t'] == 15 and e not in fechada]
resto = [e for e in prov if e not in fechada and e not in formula]
por_metodo = Counter(met[e['metodo']] for e in resto)
linhas = subprocess.run(
    ['bash','-c','cat publicar/*.js publicar/*.css publicar/*.html | wc -l'],
    capture_output=True, text=True).stdout.strip()
print(f"entradas            {len(E)}")
print(f"com bilhetes        {sum(1 for e in E if e['soma'] != 0)}")
print(f"sem bilhetes        {sum(1 for e in E if e['soma'] == 0)}")
print(f"mínimo provado      {len(prov)}")
print(f"  aritmética fechada {len(fechada)}")
print(f"  fórmula C(v,15)    {len(formula)}")
for nome, n in sorted(por_metodo.items()):
    print(f"  {nome:<18} {n}")
print(f"conferidos sem cota {len(fechada) + len(formula)}")
print(f"linhas do cliente   {linhas}")
