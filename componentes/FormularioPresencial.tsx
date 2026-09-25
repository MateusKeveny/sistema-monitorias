'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { INICIO_PRESENCIAL, type Presencial } from '@/lib/tipos';

const entrada = `rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                 focus:border-marca-600 disabled:bg-slate-50`;
const botaoPrimario = `rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40`;

const dia = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
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

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (!pessoaId) return;
    if (!form.cliente_nome.trim() || !form.demanda.trim()) {
      setErro('Informe o nome do cliente e a demanda tratada.'); return;
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
      cliente_id: form.cliente_id.trim() || null,
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

  return (
    <div className="space-y-6">
      {pessoaId && (
        <Cartao titulo="Registrar atendimento presencial">
          {erro && (
            <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                          ring-1 ring-rose-600/20">{erro}</p>
          )}
          {aviso && (
            <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800
                          ring-1 ring-emerald-600/20">{aviso}</p>
          )}

          <form onSubmit={registrar} className="flex flex-wrap items-end gap-3">
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Data</span>
              <input
                type="date" value={form.data} max={hoje}
                min={veOTime ? INICIO_PRESENCIAL
                  : [INICIO_PRESENCIAL, dataMinima(hoje)].sort().at(-1)}
                disabled={ocupado} className={entrada}
                onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
              />
            </label>
            <label className="w-32">
              <span className="mb-1 block text-xs font-medium text-slate-600">ID do cliente</span>
              <input
                value={form.cliente_id} disabled={ocupado} className={`${entrada} w-full`}
                placeholder="opcional"
                onChange={(e) => setForm((f) => ({ ...f, cliente_id: e.target.value }))}
              />
            </label>
            <label className="min-w-48 flex-1">
              <span className="mb-1 block text-xs font-medium text-slate-600">Nome do cliente</span>
              <input
                value={form.cliente_nome} disabled={ocupado} className={`${entrada} w-full`}
                onChange={(e) => setForm((f) => ({ ...f, cliente_nome: e.target.value }))}
              />
            </label>
            <label className="min-w-56 flex-1">
              <span className="mb-1 block text-xs font-medium text-slate-600">Demanda tratada</span>
              <input
                value={form.demanda} disabled={ocupado} className={`${entrada} w-full`}
                onChange={(e) => setForm((f) => ({ ...f, demanda: e.target.value }))}
              />
            </label>
            <button type="submit" disabled={ocupado} className={`${botaoPrimario} mb-0.5`}>
              {ocupado ? 'Registrando…' : 'Registrar'}
            </button>
          </form>

          <p className="mt-3 text-xs text-slate-500">
            Cada atendimento registrado aqui vale{' '}
            {pontosPorAtendimento
              ? <strong>{pontosPorAtendimento.toLocaleString('pt-BR')} pontos</strong>
              : 'pontos conforme o seu cargo'}{' '}
            no extrato, na semana da data informada — valendo a partir de 26/09/2026, início do
            ciclo de outubro. Enquanto a competência não fechar, você mesmo pode excluir um
            registro errado.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            O prazo para registrar é de <strong>2 dias úteis</strong> depois do atendimento:
            sexta-feira vale até terça. Passou do prazo, só o gestor registra.
          </p>
        </Cartao>
      )}

      <Cartao
        titulo={veOTime ? `Atendimentos presenciais (${registros.length})`
          : `Meus atendimentos (${registros.length})`}
      >
        {!registros.length ? (
          <Vazio>Nenhum atendimento presencial nesta competência.</Vazio>
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th className="w-28">Data</Th>
                {veOTime && <Th className="w-40">Operador</Th>}
                <Th className="w-28">ID</Th>
                <Th className="w-48">Cliente</Th>
                <Th>Demanda tratada</Th>
                <Th className="w-20"> </Th>
              </tr>
            </thead>
            <tbody>
              {registros.map((r) => (
                <tr key={r.id}>
                  <Td className="tabular-nums text-slate-700">{dia(r.data)}</Td>
                  {veOTime && (
                    <Td className="font-medium text-slate-800">{nomeCurto(r.pessoa_nome)}</Td>
                  )}
                  <Td className="tabular-nums text-slate-500">{r.cliente_id ?? '—'}</Td>
                  <Td className="text-slate-700">{r.cliente_nome}</Td>
                  <Td className="text-slate-700">
                    {r.demanda}
                    {r.observacao && (
                      <span className="block text-xs text-slate-500">{r.observacao}</span>
                    )}
                  </Td>
                  <Td>
                    <button
                      type="button" disabled={ocupado} onClick={() => excluir(r)}
                      className="text-xs text-rose-700 hover:underline disabled:opacity-40
                                 dark:text-rose-400"
                    >
                      excluir
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
