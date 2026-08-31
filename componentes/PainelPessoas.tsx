'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { NOMES_PAPEL, type PapelUsuario, type Pessoa } from '@/lib/tipos';

type Rascunho = { nome: string; email: string };

/**
 * Cadastro único de pessoas.
 *
 * Substitui os antigos painéis de Operadores e de Acessos, que repetiam nome e
 * e-mail e faziam parecer que cadastrar operador criava login. Aqui a pessoa
 * aparece uma vez, e duas colunas respondem as perguntas que antes exigiam
 * abrir duas telas: se ela é avaliada nas monitorias e se ela entra no sistema.
 *
 * Desmarcar **Ativo** encerra o acesso ao monitorias por inteiro, sem precisar
 * lembrar em quantos lugares a pessoa existe. Não mexe na conta do Supabase,
 * que é compartilhada com os outros sistemas da empresa.
 */
export default function PainelPessoas({ pessoas }: { pessoas: Pessoa[] }) {
  const router = useRouter();

  const [rascunho, setRascunho] = useState<Record<string, Rascunho>>(
    () => Object.fromEntries(pessoas.map((p) => [p.id, {
      nome: p.nome, email: p.email ?? '',
    }])));

  // O estado inicial só roda na primeira montagem; sem isto, uma pessoa
  // recém-cadastrada apareceria como linha em branco até recarregar à força.
  useEffect(() => {
    setRascunho((atual) => {
      const proximo = { ...atual };
      let mudou = false;
      for (const p of pessoas) {
        if (!proximo[p.id]) { proximo[p.id] = { nome: p.nome, email: p.email ?? '' }; mudou = true; }
      }
      for (const id of Object.keys(proximo)) {
        if (!pessoas.some((p) => p.id === id)) { delete proximo[id]; mudou = true; }
      }
      return mudou ? proximo : atual;
    });
  }, [pessoas]);

  const [nova, setNova] = useState({ nome: '', email: '' });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const original = new Map(pessoas.map((p) => [p.id, p]));
  const alterados = pessoas.filter((p) => {
    const d = rascunho[p.id];
    return d && (d.nome.trim() !== p.nome || d.email.trim() !== (p.email ?? ''));
  });

  const traduzir = (msg: string) =>
    /duplicate key|unique/i.test(msg)
      ? 'Já existe outra pessoa com esse nome ou e-mail.'
      : msg;

  async function atualizar(id: string, campos: Partial<Pessoa>, mensagem?: string) {
    setOcupado(id); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().from('pessoas').update(campos).eq('id', id);
    setOcupado(null);
    if (error) return setErro(traduzir(error.message));
    if (mensagem) setAviso(mensagem);
    router.refresh();
  }

  async function salvar() {
    if (alterados.some((p) => !rascunho[p.id].nome.trim())) {
      return setErro('O nome não pode ficar vazio.');
    }
    setOcupado('todos'); setErro(null); setAviso(null);
    const db = criarClienteNavegador();

    for (const p of alterados) {
      const d = rascunho[p.id];
      const { error } = await db.from('pessoas')
        .update({ nome: d.nome.trim(), email: d.email.trim() || null })
        .eq('id', p.id);
      if (error) { setErro(traduzir(error.message)); setOcupado(null); return; }
    }

    setOcupado(null);
    setAviso(`${alterados.length} pessoa(s) atualizada(s).`);
    router.refresh();
  }

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const nome = nova.nome.trim();
    if (!nome) return;

    setOcupado('nova'); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().from('pessoas').insert({
      nome, email: nova.email.trim() || null, avaliado: true, ativo: true,
    });
    setOcupado(null);
    if (error) return setErro(traduzir(error.message));

    setNova({ nome: '', email: '' });
    setAviso(`"${nome}" cadastrada. Para ela entrar no sistema, crie a conta no `
      + 'Supabase com o mesmo e-mail — o vínculo é feito sozinho.');
    router.refresh();
  }

  const entrada = `w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                   focus:border-marca-600 disabled:bg-slate-50`;
  const seletor = `rounded-md border border-slate-300 bg-superficie px-2 py-1 text-sm
                   outline-none focus:border-marca-600 disabled:opacity-50`;

  return (
    <Cartao
      titulo={`Pessoas (${pessoas.length})`}
      acao={
        <button
          onClick={salvar} disabled={!alterados.length || ocupado !== null}
          className="rounded-lg bg-marca-600 px-3 py-1.5 text-xs font-semibold text-white
                     hover:bg-marca-700 disabled:opacity-40"
        >
          {ocupado === 'todos' ? 'Salvando…' : alterados.length
            ? `Salvar ${alterados.length} alteração(ões)` : 'Salvar'}
        </button>
      }
    >
      <p className="mb-3 text-sm leading-relaxed text-slate-500">
        Uma linha por pessoa. <strong>Avaliada</strong> diz se ela entra nas monitorias;
        <strong> Login</strong> diz se ela tem conta no Supabase — quem só é avaliado não
        precisa de uma. Desmarcar <strong>Ativa</strong> encerra o acesso ao sistema.
      </p>

      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}
      {aviso && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800
                      ring-1 ring-emerald-600/20">{aviso}</p>
      )}

      {pessoas.length === 0 ? (
        <Vazio>Ninguém cadastrado.</Vazio>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th className="w-64">E-mail</Th>
              <Th className="w-40">Papel</Th>
              <Th className="w-24 text-center">Avaliada</Th>
              <Th className="w-24 text-center">Login</Th>
              <Th className="w-36">Senha</Th>
              <Th className="w-20 text-center">Ativa</Th>
              <Th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {pessoas.map((p) => {
              const d = rascunho[p.id];
              const travado = ocupado !== null;
              const mudou = d && (d.nome.trim() !== p.nome || d.email.trim() !== (p.email ?? ''));
              return (
                <tr key={p.id} className={p.ativo ? '' : 'opacity-50'}>
                  <Td>
                    <input
                      value={d?.nome ?? ''} disabled={travado} className={entrada}
                      onChange={(e) => setRascunho((s) => ({
                        ...s, [p.id]: { ...s[p.id], nome: e.target.value } }))}
                    />
                  </Td>
                  <Td>
                    <input
                      type="email" value={d?.email ?? ''} disabled={travado} className={entrada}
                      placeholder="opcional"
                      onChange={(e) => setRascunho((s) => ({
                        ...s, [p.id]: { ...s[p.id], email: e.target.value } }))}
                    />
                  </Td>
                  <Td>
                    {p.auth_id ? (
                      <select
                        value={p.papel} disabled={travado} className={seletor}
                        onChange={(e) => atualizar(p.id, { papel: e.target.value as PapelUsuario })}
                      >
                        {(Object.keys(NOMES_PAPEL) as PapelUsuario[]).map((papel) => (
                          <option key={papel} value={papel}>{NOMES_PAPEL[papel]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-400">sem login</span>
                    )}
                  </Td>
                  <Td className="text-center">
                    <input
                      type="checkbox" checked={p.avaliado} disabled={travado}
                      onChange={(e) => atualizar(p.id, { avaliado: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-400 text-marca-600"
                    />
                  </Td>
                  <Td className="text-center">
                    <span className={`text-xs ${p.auth_id ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {p.auth_id ? 'sim' : '—'}
                    </span>
                  </Td>
                  <Td>
                    {!p.auth_id ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : p.senha_definida ? (
                      <button
                        type="button" disabled={travado}
                        onClick={() => atualizar(p.id, { senha_definida: false },
                          `${p.nome} definirá nova senha no próximo acesso.`)}
                        className="text-xs text-slate-500 hover:text-rose-700 hover:underline"
                      >
                        definida · exigir troca
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-amber-700">trocará no 1º acesso</span>
                    )}
                  </Td>
                  <Td className="text-center">
                    <input
                      type="checkbox" checked={p.ativo} disabled={travado}
                      onChange={(e) => atualizar(p.id, { ativo: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-400 text-marca-600"
                    />
                  </Td>
                  <Td>
                    {mudou && (
                      <button
                        type="button" disabled={travado}
                        onClick={() => setRascunho((s) => ({
                          ...s, [p.id]: {
                            nome: original.get(p.id)!.nome,
                            email: original.get(p.id)!.email ?? '',
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

      <form onSubmit={adicionar} className="mt-5 flex flex-wrap items-end gap-2
                                            border-t border-slate-100 pt-4">
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Cadastrar pessoa</span>
          <input
            value={nova.nome} disabled={ocupado !== null} className={entrada}
            placeholder="Nome como aparece nos relatórios"
            onChange={(e) => setNova((n) => ({ ...n, nome: e.target.value }))}
          />
        </label>
        <label className="min-w-56 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">E-mail corporativo</span>
          <input
            type="email" value={nova.email} disabled={ocupado !== null} className={entrada}
            onChange={(e) => setNova((n) => ({ ...n, email: e.target.value }))}
          />
        </label>
        <button
          type="submit" disabled={!nova.nome.trim() || ocupado !== null}
          className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                     font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Cadastrar
        </button>
      </form>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Cadastrar aqui não cria login. Quando a conta for criada no Supabase com o mesmo
        e-mail, o vínculo acontece sozinho — e o papel passa a valer. Renomear é seguro: as
        monitorias apontam para o registro, não para o texto, então o histórico inteiro
        acompanha.
      </p>
    </Cartao>
  );
}
