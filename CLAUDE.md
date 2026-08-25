# Como fechar uma tarefa neste projeto

## Sempre terminar dizendo se está no ar, e com qual carimbo

Toda tarefa termina com duas informações, sem exceção e sem o usuário precisar
pedir:

1. **Se o aplicativo já está publicado e pronto para usar.** Não "foi enviado",
   não "está subindo" — se ainda estiver em publicação, dizer isso com essas
   palavras e voltar quando terminar.
2. **O carimbo da versão final.** É o que o usuário confere no rodapé do
   aplicativo para saber se o que está na mão dele é o que acabou de ser feito.

O carimbo é o valor de `CARIMBO` em `sw.js`. Ele é derivado do conteúdo, então o
do `site/` local **não** é o mesmo do publicado: o CI recompila o Rust e o `.wasm`
não sai byte a byte igual entre máquinas. **O carimbo que vale é o do que está no
ar.**

Como obter:

```bash
git fetch origin gh-pages
git log -1 --format=%s FETCH_HEAD          # "Publicação de <commit>"
git show FETCH_HEAD:sw.js | grep -o "'[a-f0-9]\{12\}'" | head -1
```

## Conferir nos bytes publicados, não só na árvore local

Antes de declarar que está no ar:

```bash
git archive FETCH_HEAD | tar -x -C /tmp/pub
diff -rq site /tmp/pub          # só sw.js e o .wasm podem diferir
```

E rodar as suítes contra esses bytes, trocando `site/` pelo publicado e
restaurando depois. Já aconteceu de um binário velho em `target/` dar resultado
falso — conferir o artefato de verdade é o que pega isso.

## Depois de o contêiner reverter o clone

Acontece nesta sessão. O que sobrevive é o que foi enviado ao `origin`:

```bash
git fetch origin main && git reset --hard FETCH_HEAD
```

E **recompilar antes de usar qualquer coisa em `target/`** — os binários de lá
sobrevivem à reversão e passam a ser de outro código.

## Depois de qualquer edição em lote no `web/app.js`

```bash
sed 's/^import .*//' web/app.js > /tmp/app-check.mjs && node --check /tmp/app-check.mjs
```

Um recorte que come uma chave deixa a página inteira sem carregar, e o sintoma —
"os botões não funcionam" — não aponta para a causa.
