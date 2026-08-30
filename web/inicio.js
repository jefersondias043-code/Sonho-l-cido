/*
 * A página inicial da plataforma.
 *
 * Ela não tem lógica de aplicativo: dois links e o carimbo da versão. O carimbo
 * está aqui pelo mesmo motivo que está nas outras telas — é como se confere, de
 * fora, se uma correção publicada chegou a este aparelho.
 *
 * Registrar o service worker aqui também importa: quem abre a plataforma e
 * escolhe um aplicativo já sai com os dois guardados para uso sem internet, em
 * vez de depender de ter entrado no aplicativo certo primeiro.
 */

const destino = document.getElementById('versao');

function mostrarVersao(versao) {
  if (destino) destino.textContent = versao ? `versão ${versao}` : '';
}

/**
 * Pergunta ao service worker em que versão ele está.
 *
 * Espera por `ready` de propósito: numa primeira visita ainda não existe
 * controlador, e perguntar naquele instante seria falar com ninguém — o número
 * simplesmente nunca apareceria.
 */
async function perguntarVersao() {
  try {
    const registro = await navigator.serviceWorker.ready;
    (navigator.serviceWorker.controller ?? registro.active)?.postMessage({ tipo: 'versao' });
  } catch {
    /* sem service worker: a versão fica em branco, e nada mais é afetado */
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', ({ data }) => {
    if (data?.tipo === 'versao') mostrarVersao(data.versao);
  });

  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((registro) => {
      registro.update().catch(() => {});
      perguntarVersao();
    })
    .catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', perguntarVersao);
}
