'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td } from '@/componentes/ui';
import { percentual } from '@/lib/formatar';
import type { Criterio } from '@/lib/tipos';

type Rascunho = { nome: string; peso: number };

/**
 * Nomes, pesos e composição do formulário de monitoria.
 *
 * A soma dos pesos ativos precisa fechar em 100%: se fechar em 90%, a melhor
 * nota possível passa a ser 90% e o C-SAT perde o sentido. Por isso o painel
 * bloqueia o salvamento fora disso e avisa quando adicionar ou desativar um
 * critério desequilibra a conta.
 */
export default function PainelCriterios({ criterios }: { criterios: Criterio[] }) {
  const router = useRouter();

  const ativos = criterios.filter((c) => c.ativo);
  const inativos = criterios.filter((c) => !c.ativo);

  const [rascunho, setRascunho] = useState<Record<string, Rascunho>>(
    () => Object.fromEntries(criterios.map((c) => [c.id, {
      nome: c.nome, peso: Number(c.peso),
    }])));

  /**
   * Mantém o rascunho em dia com a lista do servidor. O estado inicial só roda
   * na primeira montagem: sem isto, um critério recém-criado aparecia como
   * linha em branco até a página ser recarregada à força.
   */
  useEffect(() => {
    setRascunho((atual) => {
      const proximo = { ...atual };
      let mudou = false;

      for (const c of criterios) {
        if (!proximo[c.id]) {
          proximo[c.id] = { nome: c.nome, peso: Number(c.peso) };
          mudou = true;
        }
      }
      for (const id of Object.keys(proximo)) {
        if (!criterios.some((c) => c.id === id)) { delete proximo[id]; mudou = true; }
      }

      return mudou ? proximo : atual;
    });
  }, [criterios]);
  const [novo, setNovo] = useState({ nome: '', peso: '' });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const original = new Map(criterios.map((c) => [c.id, c]));
  const soma = ativos.reduce((s, c) => s + (rascunho[c.id]?.peso ?? 0), 0);
  const fecha = Math.abs(soma - 1) < 0.0005;

  const mudou = (c: Criterio) => {
    const d = rascunho[c.id];
    return d && (d.nome.trim() !== c.nome || Math.abs(d.peso - Number(c.peso)) > 0.00005);
  };
  const alterados = criterios.filter(mudou);

  const traduzir = (msg: string, nome: string) =>
    /duplicate key|unique/i.test(msg) ? `Já existe um critério chamado "${nome}".` : msg;

  async function salvar() {
    if (alterados.some((c) => !rascunho[c.id].nome.trim())) {
      setErro('O nome do critério não pode ficar vazio.');
      return;
    }

    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();

    for (const c of alterados) {
      const d = rascunho[c.id];
      const { error } = await db.from('criterios')
        .update({ nome: d.nome.trim(), peso: Number(d.peso.toFixed(4)) })
        .eq('id', c.id);
      if (error) { setErro(traduzir(error.message, d.nome.trim())); setOcupado(false); return; }
    }

    setOcupado(false);
    setAviso(`${alterados.length} critério(s) atualizado(s). `
      + 'As monitorias já lançadas mantêm a nota original.');
    router.refresh();
  }

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const nome = novo.nome.trim();
    const peso = Number(novo.peso) / 100;
    if (!nome || !Number.isFinite(peso) || peso <= 0) return;

    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();

    // A ordem é única entre os ativos, então o novo entra sempre no fim.
    const proximaOrdem = Math.max(0, ...criterios.map((c) => c.ordem)) + 1;

    const { error } = await db.from('criterios')
      .insert({ nome, peso: Number(peso.toFixed(4)), ordem: proximaOrdem, ativo: true });

    setOcupado(false);
    if (error) { setErro(traduzir(error.message, nome)); return; }

    setNovo({ nome: '', peso: '' });
    setAviso(`"${nome}" criado. Ajuste os pesos para a soma voltar a 100% antes de `
      + 'lançar novas monitorias.');
    router.refresh();
  }

  async function alternarAtivo(c: Criterio) {
    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();

    // Ao reativar, a ordem antiga pode estar ocupada; recebe uma nova no fim.
    const campos = c.ativo
      ? { ativo: false }
      : { ativo: true, ordem: Math.max(0, ...criterios.map((x) => x.ordem)) + 1 };

    const { error } = await db.from('criterios').update(campos).eq('id', c.id);
    setOcupado(false);
    if (error) { setErro(error.message); return; }

    setAviso(c.ativo
      ? `"${c.nome}" saiu do formulário. As monitorias antigas mantêm a resposta dele, `
        + 'e a soma dos pesos precisa ser reequilibrada.'
      : `"${c.nome}" voltou ao formulário, no fim da lista.`);
    router.refresh();
  }

  const entrada = `w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                   focus:border-marca-600 disabled:bg-slate-50`;
  const entradaPeso = `w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm
                       tabular-nums outline-none focus:border-marca-600 disabled:bg-slate-50`;

  return (
    <Cartao
      titulo={`Critérios e pesos (${ativos.length} ativos)`}
      acao={
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold tabular-nums ${
            fecha ? 'text-emerald-700' : 'text-rose-700'}`}>
            Soma: {percentual(soma)} {fecha ? '✓' : '— precisa fechar em 100%'}
          </span>
          <button
            onClick={salvar} disabled={!alterados.length || !fecha || ocupado}
            className="rounded-lg bg-marca-600 px-3 py-1.5 text-xs font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40"
          >
            {ocupado ? 'Salvando…' : alterados.length
              ? `Salvar ${alterados.length} alteração(ões)` : 'Salvar'}
          </button>
        </div>
      }
    >
      {!fecha && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900
                      ring-1 ring-amber-600/20">
          Os pesos somam {percentual(soma)}. Enquanto não fecharem 100%, a nota máxima
          possível de uma monitoria nova é {percentual(soma)}.
        </p>
      )}
      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}
      {aviso && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800
                      ring-1 ring-emerald-600/20">{aviso}</p>
      )}

      <Tabela>
        <thead>
          <tr>
            <Th className="w-12">Ordem</Th>
            <Th>Critério</Th>
            <Th className="w-28 text-right">Peso (%)</Th>
            <Th className="w-40" />
          </tr>
        </thead>
        <tbody>
          {ativos.map((c) => {
            const d = rascunho[c.id];
            return (
              <tr key={c.id}>
                <Td className="tabular-nums text-slate-400">{c.ordem}</Td>
                <Td>
                  <input
                    value={d?.nome ?? ''} disabled={ocupado} className={entrada}
                    onChange={(e) => setRascunho((s) => ({
                      ...s, [c.id]: { ...s[c.id], nome: e.target.value } }))}
                  />
                </Td>
                <Td className="text-right">
                  <input
                    type="number" min="0" max="100" step="0.1" disabled={ocupado}
                    value={Number(((d?.peso ?? 0) * 100).toFixed(2))}
                    onChange={(e) => setRascunho((s) => ({
                      ...s, [c.id]: { ...s[c.id], peso: Number(e.target.value) / 100 } }))}
                    className={entradaPeso}
                  />
                </Td>
                <Td>
                  <div className="flex gap-3">
                    {mudou(c) && (
                      <button
                        type="button" disabled={ocupado}
                        onClick={() => setRascunho((s) => ({
                          ...s, [c.id]: {
                            nome: original.get(c.id)!.nome,
                            peso: Number(original.get(c.id)!.peso),
                          } }))}
                        className="text-xs text-slate-500 hover:underline"
                      >
                        desfazer
                      </button>
                    )}
                    <button
                      type="button" disabled={ocupado}
                      onClick={() => alternarAtivo(c)}
                      className="text-xs text-slate-500 hover:text-rose-700 hover:underline"
                    >
                      remover
                    </button>
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Tabela>

      <form onSubmit={adicionar} className="mt-5 flex flex-wrap items-end gap-2
                                            border-t border-slate-100 pt-4">
        <label className="min-w-64 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Novo critério</span>
          <input
            value={novo.nome} disabled={ocupado} className={entrada}
            placeholder="Ex.: Ofereceu a pesquisa de satisfação"
            onChange={(e) => setNovo((n) => ({ ...n, nome: e.target.value }))}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Peso (%)</span>
          <input
            type="number" min="0.1" max="100" step="0.1" value={novo.peso} disabled={ocupado}
            onChange={(e) => setNovo((n) => ({ ...n, peso: e.target.value }))}
            className={entradaPeso}
          />
        </label>
        <button
          type="submit" disabled={!novo.nome.trim() || !novo.peso || ocupado}
          className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                     font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Adicionar
        </button>
      </form>

      {inativos.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="mb-2 text-xs font-medium text-slate-600">
            Fora do formulário ({inativos.length})
          </p>
          <ul className="space-y-1">
            {inativos.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 text-sm">
                <span className="text-slate-500">
                  {c.nome}
                  <span className="ml-2 text-xs">peso {percentual(Number(c.peso))}</span>
                </span>
                <button
                  type="button" disabled={ocupado} onClick={() => alternarAtivo(c)}
                  className="text-xs text-marca-700 dark:text-marca-400 hover:underline"
                >
                  voltar ao formulário
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Renomear atualiza o histórico inteiro, porque as respostas apontam para o registro e
        não para o texto. Já <strong>mudar o peso não recalcula</strong> as monitorias antigas —
        elas guardam a nota apurada na época, que é o correto para não reescrever avaliação já
        dada ao operador. <strong>Remover</strong> tira o critério das próximas monitorias sem
        apagar as respostas antigas; ele fica na lista abaixo e pode voltar.
      </p>
    </Cartao>
  );
}
