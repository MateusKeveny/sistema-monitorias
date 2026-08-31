'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td, Vazio } from '@/componentes/ui';

type Registro = { id: string; nome: string; email?: string | null; ativo: boolean };

/**
 * Edição dos cadastros simples (operadores, canais). Renomear é seguro: as
 * monitorias apontam para o id, nunca para o texto — trocar o nome aqui
 * atualiza tudo que já foi lançado, sem reprocessar nada.
 */
export default function PainelCadastro({
  titulo, subtitulo, tabela, registros, temEmail = false, dica, acessoPorOperador,
}: {
  titulo: string;
  subtitulo?: string;
  tabela: 'operadores' | 'canais';
  registros: Registro[];
  temEmail?: boolean;
  dica?: string;
  /**
   * id do operador -> e-mail de quem entra no sistema por ele.
   * Serve para mostrar, aqui, quem tem login — a pergunta que leva alguém a
   * procurar o mesmo nome na aba de Acessos e não encontrar.
   */
  acessoPorOperador?: Record<string, string>;
}) {
  const router = useRouter();
  const [rascunho, setRascunho] = useState<Record<string, { nome: string; email: string }>>(
    () => Object.fromEntries(registros.map((r) => [r.id, {
      nome: r.nome, email: r.email ?? '',
    }])));

  /**
   * Mantém o rascunho em dia com a lista que vem do servidor.
   *
   * O estado inicial só roda na primeira montagem. Sem isto, um registro
   * recém-criado chegava na lista sem entrada no rascunho e aparecia como
   * linha em branco, até a página ser recarregada à força. Edições em
   * andamento são preservadas: só entram os que faltam e saem os que sumiram.
   */
  useEffect(() => {
    setRascunho((atual) => {
      const proximo = { ...atual };
      let mudou = false;

      for (const r of registros) {
        if (!proximo[r.id]) {
          proximo[r.id] = { nome: r.nome, email: r.email ?? '' };
          mudou = true;
        }
      }
      for (const id of Object.keys(proximo)) {
        if (!registros.some((r) => r.id === id)) { delete proximo[id]; mudou = true; }
      }

      return mudou ? proximo : atual;
    });
  }, [registros]);
  const [novo, setNovo] = useState({ nome: '', email: '' });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const original = new Map(registros.map((r) => [r.id, r]));
  const alterados = registros.filter((r) => {
    const d = rascunho[r.id];
    return d && (d.nome.trim() !== r.nome || (temEmail && d.email.trim() !== (r.email ?? '')));
  });

  function mensagemDeErro(msg: string, nome: string) {
    if (/duplicate key|unique/i.test(msg)) return `Já existe um registro com o nome "${nome}".`;
    return msg;
  }

  async function salvar() {
    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();

    for (const r of alterados) {
      const d = rascunho[r.id];
      const nome = d.nome.trim();
      if (!nome) { setErro('O nome não pode ficar vazio.'); setOcupado(false); return; }

      const campos: Record<string, unknown> = { nome };
      if (temEmail) campos.email = d.email.trim() || null;

      const { error } = await db.from(tabela).update(campos).eq('id', r.id);
      if (error) { setErro(mensagemDeErro(error.message, nome)); setOcupado(false); return; }
    }

    setOcupado(false);
    setAviso(`${alterados.length} registro(s) atualizado(s).`);
    router.refresh();
  }

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const nome = novo.nome.trim();
    if (!nome) return;

    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const campos: Record<string, unknown> = { nome, ativo: true };
    if (temEmail) campos.email = novo.email.trim() || null;

    const { error } = await db.from(tabela).insert(campos);
    setOcupado(false);
    if (error) { setErro(mensagemDeErro(error.message, nome)); return; }

    setNovo({ nome: '', email: '' });
    setAviso(`"${nome}" cadastrado.`);
    router.refresh();
  }

  async function alternarAtivo(r: Registro) {
    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const { error } = await db.from(tabela).update({ ativo: !r.ativo }).eq('id', r.id);
    setOcupado(false);
    if (error) setErro(error.message);
    router.refresh();
  }

  const entrada = `w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                   focus:border-marca-600 disabled:bg-slate-50 disabled:text-slate-400`;

  return (
    <Cartao
      titulo={`${titulo} (${registros.length})`}
      acao={
        <button
          onClick={salvar} disabled={!alterados.length || ocupado}
          className="rounded-lg bg-marca-600 px-3 py-1.5 text-xs font-semibold text-white
                     hover:bg-marca-700 disabled:opacity-40"
        >
          {ocupado ? 'Salvando…' : alterados.length
            ? `Salvar ${alterados.length} alteração(ões)` : 'Salvar'}
        </button>
      }
    >
      {subtitulo && (
        <p className="mb-3 text-sm leading-relaxed text-slate-500">{subtitulo}</p>
      )}
      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}
      {aviso && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800
                      ring-1 ring-emerald-600/20">{aviso}</p>
      )}

      {registros.length === 0 ? (
        <Vazio>Nenhum registro cadastrado.</Vazio>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Nome</Th>
              {temEmail && <Th className="w-72">E-mail</Th>}
              {acessoPorOperador && <Th className="w-36">Entra no sistema</Th>}
              <Th className="w-24 text-center">Ativo</Th>
              <Th className="w-28" />
            </tr>
          </thead>
          <tbody>
            {registros.map((r) => {
              const d = rascunho[r.id];
              const mudou = d && (d.nome.trim() !== r.nome
                || (temEmail && d.email.trim() !== (r.email ?? '')));
              return (
                <tr key={r.id} className={r.ativo ? '' : 'opacity-50'}>
                  <Td>
                    <input
                      value={d?.nome ?? ''} disabled={ocupado} className={entrada}
                      onChange={(e) => setRascunho((s) => ({
                        ...s, [r.id]: { ...s[r.id], nome: e.target.value } }))}
                    />
                  </Td>
                  {temEmail && (
                    <Td>
                      <input
                        type="email" value={d?.email ?? ''} disabled={ocupado} className={entrada}
                        placeholder="opcional"
                        onChange={(e) => setRascunho((s) => ({
                          ...s, [r.id]: { ...s[r.id], email: e.target.value } }))}
                      />
                    </Td>
                  )}
                  {acessoPorOperador && (
                    <Td>
                      {acessoPorOperador[r.id] ? (
                        <span className="text-xs text-emerald-700">sim</span>
                      ) : (
                        <span className="text-xs text-slate-400">sem login</span>
                      )}
                    </Td>
                  )}
                  <Td className="text-center">
                    <input
                      type="checkbox" checked={r.ativo} disabled={ocupado}
                      onChange={() => alternarAtivo(r)}
                      className="h-4 w-4 rounded border-slate-400 text-marca-600"
                    />
                  </Td>
                  <Td>
                    {mudou && (
                      <button
                        type="button"
                        onClick={() => setRascunho((s) => ({
                          ...s, [r.id]: {
                            nome: original.get(r.id)!.nome,
                            email: original.get(r.id)!.email ?? '',
                          } }))}
                        className="text-xs text-slate-500 hover:underline"
                      >
                        desfazer
                      </button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Tabela>
      )}

      <form onSubmit={adicionar} className="mt-5 flex flex-wrap items-end gap-2 border-t
                                            border-slate-100 pt-4">
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Adicionar novo</span>
          <input
            value={novo.nome} disabled={ocupado} className={entrada}
            placeholder={temEmail ? 'Nome do operador' : 'Nome do canal'}
            onChange={(e) => setNovo((n) => ({ ...n, nome: e.target.value }))}
          />
        </label>
        {temEmail && (
          <label className="min-w-56 flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-600">E-mail (opcional)</span>
            <input
              type="email" value={novo.email} disabled={ocupado} className={entrada}
              onChange={(e) => setNovo((n) => ({ ...n, email: e.target.value }))}
            />
          </label>
        )}
        <button
          type="submit" disabled={!novo.nome.trim() || ocupado}
          className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                     font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Adicionar
        </button>
      </form>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        {dica ?? 'Renomear é seguro: as monitorias já lançadas apontam para o registro, '
          + 'não para o texto, então o novo nome aparece em todo o histórico.'}
        {' '}Para tirar alguém de circulação sem perder o histórico, desmarque
        <strong> Ativo</strong> — deixa de aparecer nas listas e continua nos relatórios.
      </p>
    </Cartao>
  );
}
