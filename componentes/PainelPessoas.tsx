'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { ENDERECO_PERFORMANCE } from '@/lib/sistema';
import { NOMES_PAPEL, type Pessoa } from '@/lib/tipos';

/**
 * Quem entra nas monitorias (Monitorias 6.2.0).
 *
 * Era um segundo cadastro de pessoas — nome, e-mail, papel, senha, ativa —
 * repetindo o do Performance e já desatualizado: oferecia "Administrador" ao
 * gestor (o banco recusa) e mandava criar acesso numa tela que não existe
 * mais. O cadastro fica só em Usuários e setores, no Performance; aqui sobra
 * a única decisão que é das monitorias: se a pessoa é avaliada.
 */
export default function PainelPessoas({ pessoas }: { pessoas: Pessoa[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Só quem está na operação: desligado, o perfil de teste ("usuário
  // fantasma") e a conta de administrador não são monitorados.
  const naOperacao = pessoas.filter((p) => p.ativo && !p.desligado_em
    && !(p as { perfil_de_teste?: boolean }).perfil_de_teste
    && (p.papel as string) !== 'administrador' && (p.papel as string) !== 'diretoria');
  const avaliadas = naOperacao.filter((p) => p.avaliado).length;

  async function marcar(p: Pessoa, avaliado: boolean) {
    setOcupado(p.id); setErro(null);
    const { error } = await criarClienteNavegador().from('pessoas').update({ avaliado }).eq('id', p.id);
    setOcupado(null);
    if (error) return setErro(error.message);
    router.refresh();
  }

  return (
    <Quadro
      titulo={`Quem é avaliado (${avaliadas} de ${naOperacao.length})`}
      acao={
        <a href={`${ENDERECO_PERFORMANCE}/cota/usuarios`} target="_blank" rel="noreferrer"
           className="text-xs font-medium text-marca-700 hover:underline dark:text-marca-400">
          Usuários e setores, no Performance →
        </a>
      }
    >
      <p className="mb-3 text-sm leading-relaxed text-slate-500">
        Marque quem entra nas monitorias: aparece no formulário, no ranking e na cobertura do ciclo.
        Cadastro, acesso, papel e setor ficam em <strong>Usuários e setores</strong>, no Performance.
      </p>

      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}

      {naOperacao.length === 0 ? (
        <Vazio>Ninguém na operação.</Vazio>
      ) : (
        <Tabela noQuadro>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th className="w-40">Papel</Th>
              <Th className="w-24 text-center">Avaliada</Th>
            </tr>
          </thead>
          <tbody>
            {naOperacao.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium text-slate-900">{p.nome}</Td>
                <Td className="text-sm text-slate-500">{p.auth_id ? NOMES_PAPEL[p.papel] : 'sem login'}</Td>
                <Td className="text-center">
                  <input
                    type="checkbox" checked={p.avaliado} disabled={ocupado !== null}
                    aria-label={`${p.nome} é avaliada`}
                    onChange={(e) => marcar(p, e.target.checked)}
                    className="h-4 w-4 rounded border-slate-400 text-marca-600"
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </Quadro>
  );
}
