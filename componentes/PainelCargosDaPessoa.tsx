'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td } from '@/componentes/ui';
import { hojeNoBrasil, mesDeCompetencia, mesRotulo } from '@/lib/formatar';
import type { Cargo, CargoDaPessoa, Pessoa } from '@/lib/tipos';

const entrada = `rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                 focus:border-marca-600 disabled:bg-slate-50`;

/**
 * Cargo de cada pessoa, com vigência por competência.
 *
 * Mudar de cargo é ACRESCENTAR uma linha a partir de um mês, não trocar a
 * atual: quem vira Pleno em outubro continua Júnior em setembro, e o extrato
 * de setembro não muda.
 */
export default function PainelCargosDaPessoa({
  pessoas, cargos, historico,
}: {
  pessoas: Pessoa[];
  cargos: Cargo[];
  historico: CargoDaPessoa[];
}) {
  const router = useRouter();
  const competenciaAtual = mesDeCompetencia(hojeNoBrasil());
  const [rascunho, setRascunho] = useState<Record<string, { cargo: string; mes: string }>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nomeCargo = new Map(cargos.map((c) => [c.id, c.nome]));

  const linhasDe = (pessoaId: string) => historico
    .filter((h) => h.pessoa_id === pessoaId)
    .sort((a, b) => b.desde.localeCompare(a.desde));

  const vigente = (pessoaId: string) =>
    linhasDe(pessoaId).find((h) => h.desde <= competenciaAtual) ?? null;

  async function aplicar(pessoa: Pessoa) {
    const d = rascunho[pessoa.id];
    if (!d?.cargo || !d.mes) return;

    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().from('cargos_da_pessoa').upsert(
      { pessoa_id: pessoa.id, desde: `${d.mes}-01`, cargo_id: Number(d.cargo) },
      { onConflict: 'pessoa_id,desde' },
    );
    setOcupado(false);
    if (error) { setErro(error.message); return; }

    setRascunho((s) => { const n = { ...s }; delete n[pessoa.id]; return n; });
    router.refresh();
  }

  async function remover(h: CargoDaPessoa, nome: string) {
    if (!confirm(`Remover "${nomeCargo.get(h.cargo_id)}" de ${nome} a partir de `
      + `${mesRotulo(h.desde)}? Os meses desse período passam a usar o cargo anterior.`)) return;

    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().from('cargos_da_pessoa')
      .delete().eq('pessoa_id', h.pessoa_id).eq('desde', h.desde);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    router.refresh();
  }

  return (
    <Cartao titulo="Cargo de cada pessoa">
      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}

      <Tabela>
        <thead>
          <tr>
            <Th>Pessoa</Th>
            <Th>Nome no Hub</Th>
            <Th>Cargo em {mesRotulo(competenciaAtual)}</Th>
            <Th>Histórico</Th>
            <Th>Novo cargo a partir de</Th>
          </tr>
        </thead>
        <tbody>
          {pessoas.map((p) => {
            const atual = vigente(p.id);
            const d = rascunho[p.id] ?? { cargo: '', mes: competenciaAtual.slice(0, 7) };
            return (
              <tr key={p.id} className={p.ativo ? '' : 'opacity-60'}>
                <Td className="font-medium text-slate-800">
                  {p.nome}
                  {!p.ativo && (
                    <span className="ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium
                                     text-slate-600 ring-1 ring-slate-300">desligado</span>
                  )}
                </Td>
                <Td><NomeHub pessoa={p} /></Td>
                <Td>
                  {atual
                    ? nomeCargo.get(atual.cargo_id)
                    : <span className="text-slate-400">sem cargo — não recebe cota</span>}
                </Td>
                <Td>
                  <ul className="space-y-0.5 text-xs text-slate-500">
                    {linhasDe(p.id).map((h) => (
                      <li key={h.desde} className="flex items-center gap-2">
                        <span>{nomeCargo.get(h.cargo_id)} desde {mesRotulo(h.desde)}</span>
                        <button
                          type="button" disabled={ocupado} onClick={() => remover(h, p.nome)}
                          className="hover:text-rose-700 hover:underline"
                        >
                          remover
                        </button>
                      </li>
                    ))}
                  </ul>
                </Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={d.cargo} disabled={ocupado} className={entrada}
                      aria-label={`Novo cargo de ${p.nome}`}
                      onChange={(e) => setRascunho((s) => ({ ...s, [p.id]: { ...d, cargo: e.target.value } }))}
                    >
                      <option value="">—</option>
                      {cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                    <input
                      type="month" value={d.mes} disabled={ocupado} className={entrada}
                      aria-label={`Competência inicial de ${p.nome}`}
                      onChange={(e) => setRascunho((s) => ({ ...s, [p.id]: { ...d, mes: e.target.value } }))}
                    />
                    <button
                      type="button" disabled={ocupado || !d.cargo || !d.mes} onClick={() => aplicar(p)}
                      className="text-xs font-medium text-marca-700 hover:underline
                                 disabled:opacity-40 dark:text-marca-400"
                    >
                      aplicar
                    </button>
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Tabela>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Uma promoção é um cargo novo <strong>a partir de</strong> um mês: os meses anteriores
        continuam no cargo antigo. Aplicar no mesmo mês de uma linha existente substitui o
        cargo daquela linha.
      </p>
    </Cartao>
  );
}

/**
 * Nome como aparece no relatório do Hub. É por ele que o importador acha a
 * pessoa; nome sem vínculo bloqueia a importação.
 */
function NomeHub({ pessoa }: { pessoa: Pessoa }) {
  const router = useRouter();
  const [valor, setValor] = useState(pessoa.nome_hub ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mudou = valor.trim() !== (pessoa.nome_hub ?? '');

  async function salvar() {
    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().from('pessoas')
      .update({ nome_hub: valor.trim() || null }).eq('id', pessoa.id);
    setOcupado(false);
    if (error) {
      setErro(/duplicate|unique/i.test(error.message) ? 'Já usado por outra pessoa.' : error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          value={valor} disabled={ocupado} onChange={(e) => setValor(e.target.value)}
          aria-label={`Nome de ${pessoa.nome} no Hub`} placeholder="—"
          className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-marca-600"
        />
        {mudou && (
          <button type="button" onClick={salvar} disabled={ocupado}
                  className="text-xs font-medium text-marca-700 hover:underline dark:text-marca-400">
            salvar
          </button>
        )}
      </div>
      {erro && <span className="text-xs text-rose-700">{erro}</span>}
    </div>
  );
}
