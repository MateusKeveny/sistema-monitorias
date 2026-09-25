'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td } from '@/componentes/ui';
import { NOMES_PAPEL, type Pessoa } from '@/lib/tipos';

/**
 * Quem aparece e quem conta na tela inicial do gestor.
 *
 * São duas decisões diferentes, e por isso duas colunas: alguém pode aparecer
 * na lista sem entrar na média — o gestor, que atende pouco e puxaria o C-SAT
 * da equipe para baixo — e alguém pode contar sem precisar aparecer.
 *
 * Nada aqui muda pontuação, média do cargo ou pagamento. É apresentação.
 */
export default function PainelExibicao({ pessoas }: { pessoas: Pessoa[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function alternar(p: Pessoa, campo: 'exibir_no_painel' | 'conta_nas_medias', valor: boolean) {
    setOcupado(p.id); setErro(null);
    const db = criarClienteNavegador();
    const { error } = await db.from('pessoas').update({ [campo]: valor }).eq('id', p.id);
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    router.refresh();
  }

  return (
    <Cartao titulo="Exibição e contagem">
      <p className="mb-4 text-sm text-slate-600">
        Controla apenas a <strong>tela inicial do gestor</strong>. Pontuação, extrato, média do
        cargo e valor a pagar não mudam — quem sair das listas continua com a cota dele intacta.
      </p>

      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}

      <Tabela>
        <thead>
          <tr>
            <Th>Pessoa</Th>
            <Th className="w-36">Papel</Th>
            <Th className="w-32 text-center">Aparece nas listas</Th>
            <Th className="w-32 text-center">Entra nas médias</Th>
          </tr>
        </thead>
        <tbody>
          {pessoas.map((p) => (
            <tr key={p.id} className={p.desligado_em ? 'opacity-60' : ''}>
              <Td className="font-medium text-slate-800">
                {p.nome}
                {p.desligado_em && (
                  <span className="ml-2 text-xs font-normal text-slate-500">desligado</span>
                )}
              </Td>
              <Td className="text-sm text-slate-600">{NOMES_PAPEL[p.papel]}</Td>
              <Td className="text-center">
                <input
                  type="checkbox" checked={p.exibir_no_painel ?? true} disabled={ocupado === p.id}
                  aria-label={`${p.nome} aparece nas listas`}
                  onChange={(e) => alternar(p, 'exibir_no_painel', e.target.checked)}
                />
              </Td>
              <Td className="text-center">
                <input
                  type="checkbox" checked={p.conta_nas_medias ?? true} disabled={ocupado === p.id}
                  aria-label={`${p.nome} entra nas médias`}
                  onChange={(e) => alternar(p, 'conta_nas_medias', e.target.checked)}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </Tabela>

      <p className="mt-4 text-xs text-slate-500">
        <strong>Aparece nas listas</strong> vale para C-SAT, volume, TME e pontuação de cota na
        tela inicial. <strong>Entra nas médias</strong> vale para a média de C-SAT, o TME médio e
        a média de volume mostrados ali. Quem está desligado continua no histórico e no extrato,
        independentemente destas marcas.
      </p>
    </Cartao>
  );
}
