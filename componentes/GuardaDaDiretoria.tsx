'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * A diretoria (4.0.0) só tem a tela de aprovação. Se abrir outro endereço do
 * Performance (um link antigo, o endereço digitado), volta para ela.
 *
 * Fica no navegador, e não no layout do servidor, de propósito: lá seria
 * preciso passar o caminho por um cabeçalho alterado no middleware, e isso fez
 * a tela recarregar sem parar. Os dados não dependem disto: a diretoria não lê
 * as tabelas, só as funções da aprovação (migração 98).
 */
export default function GuardaDaDiretoria() {
  const caminho = usePathname();
  const router = useRouter();
  useEffect(() => {
    // As telas da CEO: a Aprovação e o Cruzeiro.
    if (caminho && !caminho.startsWith('/cota/aprovacao') && !caminho.startsWith('/cota/cruzeiro')) router.replace('/cota/aprovacao');
  }, [caminho, router]);
  return null;
}
