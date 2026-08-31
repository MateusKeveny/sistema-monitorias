'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td } from '@/componentes/ui';
import { percentual } from '@/lib/formatar';
import type { Criterio } from '@/lib/tipos';

type Rascunho = { nome: string; peso: number };

/**
 * Nomes e pesos dos critérios. A soma dos pesos ativos precisa fechar em 100%,
 * senão a nota máxima possível deixa de ser 100% e o C-SAT perde o sentido —
 * por isso o botão de salvar fica travado até fechar.
 */
export default function PainelCriterios({ criterios }: { criterios: Criterio[] }) {
  const router = useRouter();
  const [rascunho, setRascunho] = useState<Record<string, Rascunho>>(
    () => Object.fromEntries(criterios.map((c) => [c.id, {
      nome: c.nome, peso: Number(c.peso),
    }])));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const original = new Map(criterios.map((c) => [c.id, c]));
  const soma = criterios.reduce((s, c) => s + (rascunho[c.id]?.peso ?? 0), 0);
  const fecha = Math.abs(soma - 1) < 0.0005;

  const mudou = (c: Criterio) => {
    const d = rascunho[c.id];
    return d && (d.nome.trim() !== c.nome || Math.abs(d.peso - Number(c.peso)) > 0.00005);
  };
  const alterados = criterios.filter(mudou);

  async function salvar() {
    if (alterados.some((c) => !rascunho[c.id].nome.trim())) {
      setErro('O nome do critério não pode ficar vazio.');
      return;
    }

    setSalvando(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();

    for (const c of alterados) {
      const d = rascunho[c.id];
      const { error } = await db.from('criterios')
        .update({ nome: d.nome.trim(), peso: Number(d.peso.toFixed(4)) })
        .eq('id', c.id);
      if (error) {
        setErro(/duplicate key|unique/i.test(error.message)
          ? `Já existe um critério chamado "${d.nome.trim()}".`
          : error.message);
        setSalvando(false);
        return;
      }
    }

    setSalvando(false);
    setAviso(`${alterados.length} critério(s) atualizado(s). `
      + 'As monitorias já lançadas mantêm a nota original.');
    router.refresh();
  }

  const entrada = `w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                   focus:border-marca-600 disabled:bg-slate-50`;

  return (
    <Cartao
      titulo={`Critérios e pesos (${criterios.length})`}
      acao={
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold tabular-nums ${
            fecha ? 'text-emerald-700' : 'text-rose-700'}`}>
            Soma: {percentual(soma)} {fecha ? '✓' : '— precisa fechar em 100%'}
          </span>
          <button
            onClick={salvar} disabled={!alterados.length || !fecha || salvando}
            className="rounded-lg bg-marca-600 px-3 py-1.5 text-xs font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40"
          >
            {salvando ? 'Salvando…' : alterados.length
              ? `Salvar ${alterados.length} alteração(ões)` : 'Salvar'}
          </button>
        </div>
      }
    >
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
            <Th className="w-24" />
          </tr>
        </thead>
        <tbody>
          {criterios.map((c) => {
            const d = rascunho[c.id];
            return (
              <tr key={c.id}>
                <Td className="tabular-nums text-slate-400">{c.ordem}</Td>
                <Td>
                  <input
                    value={d?.nome ?? ''} disabled={salvando} className={entrada}
                    onChange={(e) => setRascunho((s) => ({
                      ...s, [c.id]: { ...s[c.id], nome: e.target.value } }))}
                  />
                </Td>
                <Td className="text-right">
                  <input
                    type="number" min="0" max="100" step="0.1" disabled={salvando}
                    value={Number(((d?.peso ?? 0) * 100).toFixed(2))}
                    onChange={(e) => setRascunho((s) => ({
                      ...s, [c.id]: { ...s[c.id], peso: Number(e.target.value) / 100 } }))}
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right
                               text-sm tabular-nums outline-none focus:border-marca-600"
                  />
                </Td>
                <Td>
                  {mudou(c) && (
                    <button
                      type="button"
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
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Tabela>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Renomear um critério atualiza o histórico inteiro, porque as respostas apontam para o
        registro e não para o texto. Já <strong>mudar o peso não recalcula</strong> as monitorias
        antigas — elas guardam a nota apurada na época, que é o correto para não reescrever
        avaliação já dada ao operador. O peso novo vale para os próximos lançamentos.
      </p>
    </Cartao>
  );
}
