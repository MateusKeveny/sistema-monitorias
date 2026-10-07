'use client';

import { useEffect } from 'react';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import type { Sistema } from '@/lib/sistema';

/**
 * Conta uma abertura do painel (migração 52). Fica no layout, que não remonta
 * ao trocar de tela: cada carregamento da página conta uma vez.
 *
 * Vai do navegador direto ao banco, de propósito: pelo servidor seria mais uma
 * chamada dentro do limite de CPU do Worker. Falha em silêncio — o registro
 * nunca pode atrapalhar o uso.
 */
export default function RegistrarAcesso({ sistema }: { sistema: Sistema }) {
  useEffect(() => {
    criarClienteNavegador().rpc('registrar_acesso', { p_sistema: sistema })
      .then(() => undefined, () => undefined);
  }, [sistema]);
  return null;
}
