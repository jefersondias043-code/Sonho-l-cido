import { readFileSync } from 'node:fs';
const nome = process.argv[2] ?? '25-15-13';
const [v, k, t] = nome.split('-').map(Number);
const arq = JSON.parse(readFileSync(`catalogo/f/${nome}.json`));
const m = arq.bilhetes.map((p) => parseInt(p, 36));
console.log(`${nome}: ${m.length} bilhetes`);

function contar(n) { let c = 0; for (let x = n; x; x &= x - 1) c++; return c; }

function simples() {
  const teto = 1 << v; let x = (1 << 15) - 1; let pior = 15; let n = 0;
  while (x < teto) {
    let melhor = 0;
    for (let i = 0; i < m.length; i++) { const a = contar(m[i] & x); if (a > melhor) melhor = a; if (melhor === 15) break; }
    if (melhor < pior) pior = melhor;
    n++;
    const me = x & -x, s = x + me; x = s | ((((x ^ s) >>> 2) / me) | 0);
  }
  return [n, pior];
}

function comCache() {
  const teto = 1 << v; let x = (1 << 15) - 1; let pior = 15; let n = 0; let ultimo = 0; let passos = 0;
  while (x < teto) {
    // primeiro o bilhete que cobriu o sorteio anterior
    let melhor = contar(m[ultimo] & x); passos++;
    if (melhor < t) {
      for (let i = 0; i < m.length; i++) {
        const a = contar(m[i] & x); passos++;
        if (a > melhor) { melhor = a; if (a >= t) { ultimo = i; break; } }
      }
    }
    if (melhor < pior) pior = melhor;
    n++;
    const me = x & -x, s = x + me; x = s | ((((x ^ s) >>> 2) / me) | 0);
  }
  return [n, pior, passos];
}

let i = Date.now(); const a = simples(); const ta = Date.now() - i;
i = Date.now(); const b = comCache(); const tb = Date.now() - i;
console.log('simples', a, ta + 'ms');
console.log('com cache', b.slice(0,2), tb + 'ms', 'passos/sorteio', (b[2]/b[0]).toFixed(1));
