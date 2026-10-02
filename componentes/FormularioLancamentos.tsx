'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import type { CargoDaPessoa, Lancamento, PesoCargo, Pessoa, RegraCota } from '@/lib/tipos';

const entrada = `w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none
                 focus:border-marca-600 disabled:bg-slate-50`;
const rotuloCampo = 'mb-1 block text-xs font-medium text-slate-600';
const botaoPrimario = `rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40`;

const numero = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

type Props = {
  competencia: string;
  canal: 'huggy' | 'diretores';
  pessoas: Pessoa[];
  regras: RegraCota[];
  pesos: PesoCargo[];
  historico: CargoDaPessoa[];
  lancamentos: Lancamento[];
};

/**
 * O que não vem de sistema nenhum: lançamentos por regra (transferências,
 * demandas extras, atestado…).
 *
 * As avaliações de diretores digitadas nota a nota saíram na 1.19.0: todas
 * chegam pela importação (as 547 do banco vieram de lá, nenhuma digitada).
 */
export default function FormularioLancamentos(props: Props) {
  const { competencia, pessoas, historico } = props;

  /** Cargo vigente da pessoa nesta competência. */
  const cargoDe = (pessoaId: string) => historico
    .filter((h) => h.pessoa_id === pessoaId && h.desde <= competencia)
    .sort((a, b) => b.desde.localeCompare(a.desde))[0]?.cargo_id ?? null;

  const comCargo = pessoas.filter((p) => cargoDe(p.id) != null);

  return <NovoLancamento {...props} pessoas={comCargo} cargoDe={cargoDe} />;
}

function NovoLancamento({
  competencia, canal, pessoas, regras, pesos, lancamentos, cargoDe,
}: Props & { cargoDe: (id: string) => number | null }) {
  const router = useRouter();
  const vazio = { pessoa: '', semana: '', regra: '', quantidade: '', pontos: '', observacao: '' };
  const [f, setF] = useState(vazio);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<string | null>(null);

  const cargo = f.pessoa ? cargoDe(f.pessoa) : null;
  // Só as regras que pontuam no cargo da pessoa escolhida.
  const pesoNoCargo = new Map(pesos.filter((p) => p.cargo_id === cargo).map((p) => [p.regra, Number(p.peso)]));
  // O presencial sai daqui: quem registra agora é o próprio operador, na tela
  // de Atendimento presencial. Mantê-lo nos dois lugares contaria em dobro.
  const disponiveis = regras.filter((r) => pesoNoCargo.has(r.chave) && r.chave !== 'presencial');
  const regra = regras.find((r) => r.chave === f.regra) ?? null;
  const nomePessoa = new Map(pessoas.map((p) => [p.id, p.nome]));
  const rotuloRegra = new Map(regras.map((r) => [r.chave, r.rotulo]));

  // O efeito no extrato antes de lançar: quantidade × peso do cargo, ou o
  // valor digitado nas regras de valor manual.
  // Atestado (migração 49): lança-se em dias; o desconto sai da pontuação do
  // mês e muda até o fechamento — não dá para mostrar o valor agora.
  const ehAtestado = regra?.chave === 'atestado';
  const efeito = !regra || !f.pessoa || ehAtestado ? null
    : regra.valor_manual ? (f.pontos === '' ? null : Number(f.pontos))
      : f.quantidade === '' ? null : Number(f.quantidade) * (pesoNoCargo.get(regra.chave) ?? 0);

  const set = (campo: keyof typeof vazio) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((s) => ({ ...s, [campo]: e.target.value }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.pessoa || !regra) return;
    const quantidade = Number(f.quantidade || 0);
    if (!Number.isFinite(quantidade)) { setErro('Quantidade inválida.'); return; }
    if (regra.valor_manual && f.pontos === '') { setErro('Informe os pontos desta regra.'); return; }

    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().from('lancamentos').insert({
      pessoa_id: f.pessoa,
      mes_competencia: competencia,
      canal,
      semana: f.semana ? Number(f.semana) : null,
      regra: regra.chave,
      quantidade,
      pontos_manuais: regra.valor_manual ? Number(f.pontos) : null,
      observacao: f.observacao.trim() || null,
    });
    setOcupado(false);
    if (error) { setErro(error.message); return; }

    // Mantém pessoa e semana: o normal é lançar várias regras seguidas.
    setF((s) => ({ ...vazio, pessoa: s.pessoa, semana: s.semana }));
    router.refresh();
  }

  async function excluir(l: Lancamento) {
    if (!confirm(`Excluir o lançamento "${rotuloRegra.get(l.regra) ?? l.regra}" de `
      + `${nomePessoa.get(l.pessoa_id) ?? 'pessoa'}?`)) return;
    const { error } = await criarClienteNavegador().from('lancamentos').delete().eq('id', l.id);
    if (error) { setErro(error.message); return; }
    router.refresh();
  }

  return (
    <Quadro titulo="Lançamentos manuais"
            subtitulo="O que não vem de sistema: transferências, demandas extras, atestado, atraso…">
      <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="lg:col-span-2">
          <span className={rotuloCampo}>Pessoa</span>
          <select value={f.pessoa} onChange={(e) => setF((s) => ({ ...s, pessoa: e.target.value, regra: '' }))}
                  disabled={ocupado} className={entrada} required>
            <option value="">Selecione…</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}{p.ativo ? '' : ' · desligado'}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={rotuloCampo}>Semana</span>
          <select value={f.semana} onChange={set('semana')} disabled={ocupado} className={entrada}>
            <option value="">Mês inteiro</option>
            {[1, 2, 3, 4].map((s) => <option key={s} value={s}>{s}ª semana</option>)}
          </select>
        </label>
        <label className="lg:col-span-3">
          <span className={rotuloCampo}>Regra</span>
          <select value={f.regra} onChange={set('regra')} disabled={ocupado || !f.pessoa}
                  className={entrada} required>
            <option value="">{f.pessoa ? 'Selecione…' : 'Escolha a pessoa primeiro'}</option>
            {disponiveis.map((r) => (
              <option key={r.chave} value={r.chave}>
                {r.rotulo}{r.chave === 'atestado' ? '' : r.valor_manual ? ' (valor digitado)' : ` · ${numero(pesoNoCargo.get(r.chave)!)} pts`}
              </option>
            ))}
          </select>
        </label>

        {regra && !regra.valor_manual && (
          <label>
            <span className={rotuloCampo}>{ehAtestado ? 'Dias de afastamento' : 'Quantidade'}</span>
            <input type="number" step={ehAtestado ? 1 : 'any'} min={ehAtestado ? 1 : undefined} value={f.quantidade}
                   onChange={set('quantidade')} disabled={ocupado} className={entrada} required />
          </label>
        )}
        {regra?.valor_manual && (
          <label>
            <span className={rotuloCampo}>Pontos (negativo desconta)</span>
            <input type="number" step="any" value={f.pontos} onChange={set('pontos')}
                   disabled={ocupado} className={entrada} required />
          </label>
        )}
        <label className={regra ? 'lg:col-span-4' : 'lg:col-span-5'}>
          <span className={rotuloCampo}>Observação</span>
          <input value={f.observacao} onChange={set('observacao')} disabled={ocupado}
                 className={entrada} placeholder="Opcional" />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={ocupado || !f.pessoa || !f.regra} className={botaoPrimario}>
            {ocupado ? 'Salvando…' : 'Lançar'}
          </button>
        </div>
      </form>

      {ehAtestado && f.pessoa && (
        <p className="mt-2 text-sm text-slate-500">
          O desconto é a <strong>pontuação do mês</strong> de {nomePessoa.get(f.pessoa)?.split(' ')[0]} ÷ os dias do ciclo
          × os dias de afastamento. Ele aparece no extrato e acompanha o mês até o fechamento.
        </p>
      )}
      {efeito != null && Number.isFinite(efeito) && (
        <p className="mt-2 text-sm text-slate-500">
          Vai {efeito < 0 ? 'tirar' : 'somar'}{' '}
          <strong className={efeito < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-marca-700 dark:text-marca-400'}>
            {efeito < 0 ? '−' : '+'}{numero(Math.abs(efeito))} pts
          </strong>
          {' '}no extrato de {nomePessoa.get(f.pessoa)?.split(' ')[0]}, {f.semana ? `${f.semana}ª semana` : 'no mês'}.
        </p>
      )}

      {erro && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        {lancamentos.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[null, ...new Set(lancamentos.map((l) => l.pessoa_id))].map((id) => {
              const ativo = filtro === id;
              const qtd = id ? lancamentos.filter((l) => l.pessoa_id === id).length : lancamentos.length;
              return (
                <button key={id ?? 'todos'} type="button" aria-pressed={ativo} onClick={() => setFiltro(id)}
                        className={`rounded-full border px-3 py-0.5 text-xs ${ativo
                          ? 'border-marca-600 bg-marca-600/10 text-marca-700 dark:text-marca-400'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  {id ? nomePessoa.get(id) ?? 'Pessoa' : 'Todos'} · {qtd}
                </button>
              );
            })}
          </div>
        )}
        {lancamentos.length === 0 ? (
          <Vazio>Nenhum lançamento nesta competência.</Vazio>
        ) : (
          <Tabela noQuadro>
            <thead>
              <tr>
                <Th>Pessoa</Th><Th>Semana</Th><Th>Regra</Th>
                <Th className="text-right">Qtde / pontos</Th><Th>Observação</Th><Th>Lançado por</Th><Th />
              </tr>
            </thead>
            <tbody>
              {lancamentos.filter((l) => !filtro || l.pessoa_id === filtro).map((l) => (
                <tr key={l.id}>
                  <Td>{nomePessoa.get(l.pessoa_id) ?? '—'}</Td>
                  <Td>{l.semana ? `${l.semana}ª` : 'mês'}</Td>
                  <Td>{rotuloRegra.get(l.regra) ?? l.regra}</Td>
                  <Td className="text-right tabular-nums">
                    {l.pontos_manuais != null ? `${numero(Number(l.pontos_manuais))} pts` : `${numero(Number(l.quantidade))}${l.regra === 'atestado' ? ' dia(s)' : ''}`}
                  </Td>
                  <Td className="text-xs text-slate-500">{l.observacao ?? ''}</Td>
                  <Td className="text-xs text-slate-500">{l.lancado_por_nome ?? '—'}</Td>
                  <Td>
                    <button type="button" onClick={() => excluir(l)}
                            className="text-xs text-slate-500 hover:text-rose-700 hover:underline">
                      excluir
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </div>
    </Quadro>
  );
}
