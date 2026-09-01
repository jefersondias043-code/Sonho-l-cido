/*
 * A página inicial da plataforma.
 *
 * Ela não tem lógica de aplicativo: três links, o carimbo da versão e o caminho
 * para as Configurações. O carimbo está aqui pelo mesmo motivo que está nas
 * outras telas — é como se confere, de fora, se uma correção publicada chegou a
 * este aparelho. Quem quiser a resposta inteira, com o que está publicado do
 * outro lado, toca em Configurações.
 *
 * Registrar o service worker aqui também importa: quem abre a plataforma e
 * escolhe um aplicativo já sai com os três guardados para uso sem internet, em
 * vez de depender de ter entrado no aplicativo certo primeiro.
 *
 * O registro em si mora em `atualizacao.js`, junto com o da tela de
 * Configurações. Eram duas cópias da mesma coisa, e a segunda tinha ficado sem
 * a recarga automática — quem estivesse nesta página quando uma versão nova
 * assumisse continuaria vendo a antiga sem saber.
 */

import { registrar } from './atualizacao.js';

const destino = document.getElementById('versao');

registrar({
  aoSaberAVersao: (versao) => {
    if (destino) destino.textContent = versao ? `versão ${versao}` : '';
  },
});
