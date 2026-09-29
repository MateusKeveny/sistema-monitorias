'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro, Vazio } from '@/componentes/ui';
import { INICIO_PRESENCIAL, type Presencial } from '@/lib/tipos';

const entrada = `rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                 focus:border-marca-600 disabled:bg-slate-50`;
const botaoPrimario = `rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40`;

const dia = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
/** '2026-09-29' → 'Segunda'. */
const diaDaSemana = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' });
  return d.charAt(0).toUpperCase() + d.slice(1).replace('-feira', '');
};

/** "Allana Castro da Silva" → "Allana Castro". */
const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');


/** Dias úteis no intervalo (de, ate] — sem feriados, como no banco. */
function diasUteis(de: string, ate: string) {
  let n = 0;
  // Meio-dia: evita que o fuso jogue a data para o dia anterior.
  const d = new Date(`${de}T12:00:00`);
  const fim = new Date(`${ate}T12:00:00`);
  while (d < fim) {
    d.setDate(d.getDate() + 1);
    const dia = d.getDay();
    if (dia >= 1 && dia <= 5) n++;
  }
  return n;
}

/** Data mais antiga ainda dentro do prazo de 2 dias úteis. */
function dataMinima(hoje: string) {
  const d = new Date(`${hoje}T12:00:00`);
  let uteis = 0;
  while (uteis < PRAZO_EM_DIAS_UTEIS) {
    d.setDate(d.getDate() - 1);
    const dia = d.getDay();
    if (dia >= 1 && dia <= 5) uteis++;
  }
  return d.toLocaleDateString('sv-SE');
}

/** Dois dias úteis contados do dia seguinte ao atendimento. */
const PRAZO_EM_DIAS_UTEIS = 2;

/**
 * Atendimento presencial registrado por quem atendeu.
 *
 * Antes o operador anotava numa planilha à parte e o gestor transcrevia o
 * total do mês como lançamento manual. Cada transcrição era uma chance de
 * erro, e o detalhe que permite conferir — data, cliente, demanda — ficava
 * fora do sistema.
 *
 * Cada linha aqui vale um atendimento no extrato. Apagar é do gestor, ou do
 * próprio autor enquanto a competência não estiver fechada.
 */
export default function FormularioPresencial({
  registros, pessoaId, veOTime, pontosPorAtendimento,
}: {
  registros: Presencial[];
  /** Quem está logado; nulo quando é gestor olhando a equipe. */
  pessoaId: string | null;
  veOTime: boolean;
  pontosPorAtendimento: number | null;
}) {
  const router = useRouter();
  const hoje = new Date().toLocaleDateString('sv-SE');
  const [form, setForm] = useState({
    data: hoje, cliente_id: '', cliente_nome: '', demanda: '', observacao: '',
  });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (!pessoaId) return;
    if (!form.data || !form.cliente_id.trim() || !form.cliente_nome.trim() || !form.demanda.trim()) {
      setErro('Informe a data, o ID e o nome do cliente e a demanda tratada.'); return;
    }
    if (form.data > hoje) { setErro('A data não pode ser futura.'); return; }
    if (!veOTime && diasUteis(form.data, hoje) > PRAZO_EM_DIAS_UTEIS) {
      setErro('Prazo encerrado: o atendimento deve ser registrado em até 2 dias úteis.'
        + ' Peça ao gestor para registrar por você.');
      return;
    }
    if (form.data < INICIO_PRESENCIAL) {
      setErro('O registro pelo operador vale a partir de 26/09/2026. Antes disso, o presencial'
        + ' foi lançado pelo gestor.');
      return;
    }

    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const { error } = await db.from('atendimentos_presenciais').insert({
      pessoa_id: pessoaId,
      data: form.data,
      cliente_id: form.cliente_id.trim(),
      cliente_nome: form.cliente_nome.trim(),
      demanda: form.demanda.trim(),
      observacao: form.observacao.trim() || null,
    });
    setOcupado(false);
    if (error) { setErro(error.message); return; }

    // Mantém a data: o normal é registrar vários do mesmo dia.
    setForm((f) => ({ ...f, cliente_id: '', cliente_nome: '', demanda: '', observacao: '' }));
    setAviso('Atendimento registrado.');
    router.refresh();
  }

  async function excluir(r: Presencial) {
    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const { error, count } = await db.from('atendimentos_presenciais')
      .delete({ count: 'exact' }).eq('id', r.id);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    if (!count) {
      setErro('Não foi possível excluir: a competência deste atendimento já está fechada.');
      return;
    }
    setAviso('Atendimento excluído.');
    router.refresh();
  }

  // Os quatro campos são obrigatórios (1.19.0): sem o ID o gestor não acha o
  // cliente para conferir. Só a observação fica opcional.
  const completo = !!(form.data && form.cliente_id.trim() && form.cliente_nome.trim() && form.demanda.trim());

  // Por pessoa (só quem vê a equipe) e a lista por dia, com busca.
  const porPessoa = [...registros.reduce((m, r) => m.set(r.pessoa_nome, (m.get(r.pessoa_nome) ?? 0) + 1),
    new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const maiorPessoa = Math.max(1, ...porPessoa.map(([, q]) => q));
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const filtrados = !termo ? registros : registros.filter((r) =>
    [r.cliente_nome, r.cliente_id ?? '', r.demanda, r.observacao ?? '', r.pessoa_nome]
      .some((t) => t.toLocaleLowerCase('pt-BR').includes(termo)));
  const porDia = [...filtrados.reduce((m, r) => m.set(r.data, [...(m.get(r.data) ?? []), r]),
    new Map<string, Presencial[]>())];

  const rotulo = 'mb-1 block text-xs font-medium text-slate-600';
  const desde = veOTime ? null : [INICIO_PRESENCIAL, dataMinima(hoje)].sort().at(-1)!;

  return (
    <div className="space-y-6">
      <div className={`grid items-start gap-4 ${pessoaId && veOTime ? 'xl:grid-cols-[1.35fr_1fr]' : ''}`}>
        {pessoaId && (
          <Quadro titulo="Registrar atendimento"
                  subtitulo={veOTime ? 'Quem vê a equipe registra sem prazo.'
                    : `Prazo de 2 dias úteis: hoje dá para registrar atendimentos desde ${dia(desde!)}.`}>
            {erro && (
              <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                            ring-1 ring-rose-600/20">{erro}</p>
            )}
            {aviso && (
              <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800
                            ring-1 ring-emerald-600/20">{aviso}</p>
            )}

            <form onSubmit={registrar} className="grid gap-3 sm:grid-cols-[10rem_9rem_1fr]">
              <label>
                <span className={rotulo}>Data do atendimento *</span>
                <input
                  type="date" value={form.data} max={hoje} required
                  min={veOTime ? INICIO_PRESENCIAL : desde!}
                  disabled={ocupado} className={`${entrada} w-full`}
                  onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
                />
              </label>
              <label>
                <span className={rotulo}>ID do cliente *</span>
                <input
                  value={form.cliente_id} disabled={ocupado} className={`${entrada} w-full`} required
                  onChange={(e) => setForm((f) => ({ ...f, cliente_id: e.target.value }))}
                />
              </label>
              <label>
                <span className={rotulo}>Nome do cliente *</span>
                <input
                  value={form.cliente_nome} disabled={ocupado} className={`${entrada} w-full`} required
                  onChange={(e) => setForm((f) => ({ ...f, cliente_nome: e.target.value }))}
                />
              </label>
              <label className="sm:col-span-2">
                <span className={rotulo}>Demanda tratada *</span>
                <input
                  value={form.demanda} disabled={ocupado} className={`${entrada} w-full`} required
                  placeholder="Ex.: troca de titularidade"
                  onChange={(e) => setForm((f) => ({ ...f, demanda: e.target.value }))}
                />
              </label>
              <div className="flex items-end gap-3">
                <label className="min-w-0 flex-1">
                  <span className={rotulo}>Observação</span>
                  <input
                    value={form.observacao} disabled={ocupado} className={`${entrada} w-full`}
                    placeholder="Opcional"
                    onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
                  />
                </label>
                <button type="submit" disabled={ocupado || !completo} className={botaoPrimario}>
                  {ocupado ? 'Registrando…' : 'Registrar'}
                </button>
              </div>
            </form>

            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              * obrigatório. Cada atendimento vale{' '}
              {pontosPorAtendimento
                ? <strong>{pontosPorAtendimento.toLocaleString('pt-BR')} pontos</strong>
                : 'pontos conforme o cargo'}{' '}
              no extrato de quem atendeu, na semana da data informada. Enquanto a competência não
              fechar, o próprio autor pode excluir um registro errado. Passou do prazo de 2 dias úteis
              (sexta vale até terça), só o gestor registra.
            </p>
          </Quadro>
        )}

        {veOTime && (
          <Quadro titulo="Por pessoa no mês">
            {porPessoa.length === 0 ? (
              <p className="text-sm text-slate-500">Ninguém registrou ainda.</p>
            ) : (
              <ul className="grid gap-2.5">
                {porPessoa.map(([nome, q]) => (
                  <li key={nome} className="grid grid-cols-[8.5rem_1fr_2rem] items-center gap-3 text-sm">
                    <span className="truncate text-slate-700">{nomeCurto(nome)}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <span className="crescer-x block h-full origin-left rounded-full bg-marca-600"
                            style={{ transform: `scaleX(${q / maiorPessoa})` }} />
                    </span>
                    <span className="text-right font-semibold tabular-nums text-slate-800">{q}</span>
                  </li>
                ))}
              </ul>
            )}
          </Quadro>
        )}
      </div>

      <Quadro
        titulo={veOTime ? `Atendimentos do mês (${registros.length})` : `Meus atendimentos (${registros.length})`}
        subtitulo="Agrupados por dia."
        acao={registros.length > 0 && (
          <input value={busca} onChange={(e) => setBusca(e.target.value)} type="search"
                 placeholder="Buscar cliente, ID ou demanda…" aria-label="Buscar"
                 className={`${entrada} w-64`} />
        )}
      >
        {!registros.length ? (
          <Vazio>Nenhum atendimento presencial nesta competência.</Vazio>
        ) : porDia.length === 0 ? (
          <Vazio>Nada encontrado para “{busca}”.</Vazio>
        ) : (
          <div className="space-y-5">
            {porDia.map(([data, doDia]) => (
              <section key={data}>
                <h3 className="mb-1 flex justify-between text-xs font-semibold text-slate-500">
                  <span>{diaDaSemana(data)}, {dia(data)}</span>
                  <span>{doDia.length} atendimento{doDia.length > 1 ? 's' : ''}</span>
                </h3>
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {doDia.map((r) => (
                    <li key={r.id}
                        className={`grid items-baseline gap-x-4 gap-y-0.5 py-2 text-sm ${veOTime
                          ? 'sm:grid-cols-[9rem_7rem_1fr_1.4fr_auto]' : 'sm:grid-cols-[7rem_1fr_1.4fr_auto]'}`}>
                      {veOTime && <span className="font-medium text-slate-800">{nomeCurto(r.pessoa_nome)}</span>}
                      <span className="tabular-nums text-slate-500">{r.cliente_id ? `#${r.cliente_id}` : '—'}</span>
                      <span className="text-slate-700">{r.cliente_nome}</span>
                      <span className="text-slate-700">
                        {r.demanda}
                        {r.observacao && <span className="block text-xs text-slate-500">{r.observacao}</span>}
                      </span>
                      <button
                        type="button" disabled={ocupado} onClick={() => excluir(r)}
                        className="justify-self-end text-xs text-slate-500 hover:text-rose-700 hover:underline
                                   disabled:opacity-40 dark:hover:text-rose-400"
                      >
                        excluir
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Quadro>
    </div>
  );
}
