import LinkDoNext from 'next/link';
import type { ComponentProps } from 'react';

/**
 * Link com prefetch desligado por padrão.
 *
 * O `next/link` puro pré-carrega todo link que aparece na tela. Numa página
 * estática isso é barato; aqui não é: toda página do sistema é `force-dynamic`
 * e atrás de login, então cada prefetch é uma renderização inteira no servidor,
 * com consulta ao Supabase junto. A lista de monitorias tem um link por linha,
 * e o menu tem cinco — abrir a lista disparava dezenas de renderizações de
 * páginas que ninguém pediu.
 *
 * Foi o que derrubou o sistema em 01/09/2026: o Worker tem 10 ms de CPU por
 * invocação, e a rajada de prefetches estourava o limite levando junto a página
 * de verdade, que devolvia erro 1102 para quem estava usando.
 *
 * Não se perde nada em velocidade: prefetch de página dinâmica não guarda o
 * conteúdo, só adianta trabalho que seria refeito na navegação de qualquer
 * forma. Onde o adiantamento valer a pena, basta passar `prefetch` explícito.
 */
export default function Link({
  prefetch = false, ...resto
}: ComponentProps<typeof LinkDoNext>) {
  return <LinkDoNext prefetch={prefetch} {...resto} />;
}
