'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { NOMES_PAPEL, type Operador, type PapelUsuario, type Perfil } from '@/lib/tipos';

/**
 * Liberação de acesso. O usuário se cadastra pelo Supabase (ou é convidado no
 * painel do Supabase) e nasce como "operador" sem vínculo — só enxerga algo
 * depois que alguém aqui define o papel e, no caso de operador, o vínculo.
 */
export default function PainelUsuarios({
  perfis, operadores,
}: {
  perfis: Perfil[];
  operadores: Operador[];
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function atualizar(id: string, campos: Partial<Perfil>) {
    setOcupado(id);
    setErro(null);
    const db = criarClienteNavegador();
    const { error } = await db.from('perfis').update(campos).eq('id', id);
    if (error) setErro(error.message);
    setOcupado(null);
    router.refresh();
  }

  const seletor = `rounded-md border border-slate-300 bg-white px-2 py-1 text-sm
                   outline-none focus:border-marca-600 disabled:opacity-50`;

  return (
    <Cartao titulo={`Acessos (${perfis.length})`}>
      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}

      {perfis.length === 0 ? (
        <Vazio>
          Nenhum usuário ainda. Convide as pessoas pelo painel do Supabase
          (Authentication → Users) e elas aparecerão aqui para você definir o papel.
        </Vazio>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>E-mail</Th>
              <Th className="w-48">Papel</Th>
              <Th className="w-52">Operador vinculado</Th>
              <Th className="w-24 text-center">Ativo</Th>
            </tr>
          </thead>
          <tbody>
            {perfis.map((p) => (
              <tr key={p.id} className={ocupado === p.id ? 'opacity-50' : ''}>
                <Td>
                  {/* Salva ao sair do campo. O nome vem do e-mail no primeiro acesso,
                      então quase sempre precisa de um ajuste. */}
                  <input
                    defaultValue={p.nome} disabled={ocupado === p.id}
                    onBlur={(e) => {
                      const nome = e.target.value.trim();
                      if (nome && nome !== p.nome) atualizar(p.id, { nome });
                      else e.target.value = p.nome;
                    }}
                    className="w-full rounded-md border border-transparent px-2 py-1 text-sm
                               font-medium text-slate-900 hover:border-slate-300
                               focus:border-marca-600 focus:outline-none"
                  />
                </Td>
                <Td className="text-slate-500">{p.email}</Td>
                <Td>
                  <select
                    value={p.papel} disabled={ocupado === p.id} className={seletor}
                    onChange={(e) => atualizar(p.id, { papel: e.target.value as PapelUsuario })}
                  >
                    {(Object.keys(NOMES_PAPEL) as PapelUsuario[]).map((papel) => (
                      <option key={papel} value={papel}>{NOMES_PAPEL[papel]}</option>
                    ))}
                  </select>
                </Td>
                <Td>
                  {p.papel === 'operador' ? (
                    <select
                      value={p.operador_id ?? ''} disabled={ocupado === p.id} className={seletor}
                      onChange={(e) => atualizar(p.id, { operador_id: e.target.value || null })}
                    >
                      <option value="">— sem vínculo —</option>
                      {operadores.map((o) => (
                        <option key={o.id} value={o.id}>{o.nome}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-slate-400">vê o time inteiro</span>
                  )}
                </Td>
                <Td className="text-center">
                  <input
                    type="checkbox" checked={p.ativo} disabled={ocupado === p.id}
                    onChange={(e) => atualizar(p.id, { ativo: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-400 text-marca-600"
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Um operador <strong>sem vínculo</strong> entra no sistema e não vê nenhuma monitoria —
        é o estado seguro por padrão. Só a <strong>Qualidade (admin)</strong> lança e edita
        monitorias; gestor tem leitura do time inteiro.
      </p>
    </Cartao>
  );
}
