'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Quadro, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { hojeNoBrasil } from '@/lib/formatar';
import type { PagamentoMensal } from '@/lib/tipos';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';

/** Valor que o RH mandou pagar a uma pessoa (migração 73). */
export type ValorRh = { pessoa_id: string; valor: number; informado_por_nome: string | null; informado_em: string };

const pontos = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const reais = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Depois do dia 10 o valor do mês anterior já deveria ter chegado. */
const DIA_LIMITE = 10;

function atrasado(competencia: string) {
  const hoje = hojeNoBrasil();
  const [ano, mes] = competencia.split('-').map(Number);
  const seguinte = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);
  return hoje > seguinte && Number(hoje.slice(8, 10)) >= DIA_LIMITE;
}

/**
 * O que cada pessoa recebe na competência fechada.
 *
 * Pontuação vem do fechamento; o bônus de equipe sai de 10% da média do cargo
 * de referência, e só quando todos os que têm direito bateram a meta — um que
 * não bate, ninguém recebe. O valor por ponto é informado pelo gestor.
 *
 * Valor do RH (2.2.0): o que o RH mandou pagar a cada um, digitado aqui. Com
 * valor por ponto, aparece ao lado do calculado e a tela diz se confere.
 * Vale para qualquer pessoa fechada no mês (2.8.0, migração 77): se o RH
 * pagou quem ficou abaixo da meta, é isso que vale.
 */
export default function PagamentoDoMes({
  competencia, linhas, titulo = 'Pagamento', valoresRh = [],
}: {
  competencia: string;
  linhas: PagamentoMensal[];
  titulo?: string;
  valoresRh?: ValorRh[];
}) {
  const router = useRouter();
  const doRh = new Map(valoresRh.map((v) => [v.pessoa_id, Number(v.valor)]));
  const paraTexto = (v: number | undefined) => (v == null ? '' : v.toFixed(2).replace('.', ','));
  const [rascunho, setRascunho] = useState<Record<string, string>>(
    () => Object.fromEntries(linhas.map((l) => [l.pessoa_id, paraTexto(doRh.get(l.pessoa_id))])));
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Depois de gravar, a tela inteira do fechamento é refeita (alguns segundos):
  // o botão diz que está atualizando, em vez de parecer que nada aconteceu (2.2.1).
  const [atualizando, iniciar] = useTransition();
  const lerReais = (t: string) => { const x = t.trim().replace(/\./g, '').replace(',', '.'); return x === '' ? null : Number(x); };
  const mudados = linhas.filter((l) => lerReais(rascunho[l.pessoa_id] ?? '') !== (doRh.get(l.pessoa_id) ?? null));
  const precisaMotivo = mudados.some((l) => doRh.has(l.pessoa_id));

  async function salvarRh() {
    const valores = mudados.map((l) => ({ pessoa_id: l.pessoa_id, valor: lerReais(rascunho[l.pessoa_id] ?? '') }));
    if (valores.some((v) => v.valor != null && (!Number.isFinite(v.valor) || v.valor < 0))) { setErro('Valor inválido. Use 1234,56.'); return; }
    if (precisaMotivo && !motivo.trim()) { setErro('Escreva o motivo: um valor já informado está mudando.'); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().rpc('salvar_valores_rh', { p_mes: competencia, p_valores: valores, p_motivo: motivo.trim() || null });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    // Aviso no computador (2.4.0): entrega os avisos novos a quem ativou.
    fetch('/api/cota/avisos/enviar', { method: 'POST' }).catch(() => {});
    setMotivo(''); setAviso(`${valores.length} valor(es) do RH salvo(s).`);
    iniciar(() => router.refresh());
  }
  if (!linhas.length) {
    return (
      <Quadro titulo={titulo}>
        <Vazio>Nada fechado nesta competência.</Vazio>
      </Quadro>
    );
  }

  const primeira = linhas[0];
  const semValor = primeira.valor_por_ponto == null;
  const comDireito = linhas.filter((l) => l.recebe_bonus && l.mes_inteiro);

  // Sem soma dos valores, por decisão do gestor: o total do mês não é
  // conferido aqui e um número somado na tela vira número citado em reunião.
  return (
    <Quadro titulo={titulo}>
      {semValor && valoresRh.length > 0 ? (
        <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-300">
          Valor do RH informado. O valor por ponto é opcional: com ele, a tela confere o calculado com o do RH.
        </p>
      ) : semValor ? (
        <p className={`mb-4 rounded-lg px-3 py-2 text-sm ring-1 ${
          atrasado(competencia)
            ? 'bg-amber-50 text-amber-900 ring-amber-600/20'
            : 'bg-slate-50 text-slate-700 ring-slate-300'}`}>
          {atrasado(competencia)
            ? 'O valor por ponto desta competência ainda não foi informado — já passou do dia 10.'
            : 'O valor por ponto desta competência ainda não foi informado.'}
        </p>
      ) : (
        <p className="mb-4 text-sm text-slate-600">
          {reais(Number(primeira.valor_por_ponto))} por ponto.{' '}
          {primeira.bonus_liberado
            ? <>Bônus de equipe <strong>liberado</strong>:{' '}
                {Math.round(Number(primeira.percentual_bonus) * 10000) / 100}% de{' '}
                {pontos(primeira.media_base)} = <strong>{pontos(comDireito[0]?.bonus ?? 0)}</strong>{' '}
                pontos para cada um dos {comDireito.length} que têm direito.</>
            : <>Bônus de equipe <strong>não liberado</strong>: {primeira.quantos_faltaram}{' '}
                {primeira.quantos_faltaram === 1 ? 'pessoa não bateu' : 'pessoas não bateram'}{' '}
                a meta entre quem precisa bater.</>}
        </p>
      )}

      <Tabela noQuadro>
        <thead>
          <tr>
            <Th>Pessoa</Th>
            <Th className="w-36">Cargo</Th>
            <Th className="w-28 text-right">Pontos</Th>
            <Th className="w-28 text-right">Bônus</Th>
            <Th className="w-32 text-right">Total de pontos</Th>
            <Th className="w-32 text-right">Calculado</Th>
            <Th className="w-36 text-right">Valor do RH (R$)</Th>
            <Th className="w-40" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.pessoa_id}>
              <Td className="font-medium text-slate-800">
                {l.pessoa_nome}
                {!l.mes_inteiro && (
                  <span className="ml-2 text-xs font-normal text-slate-500">mês parcial</span>
                )}
              </Td>
              <Td className="text-xs text-slate-500">{l.cargo ?? '—'}</Td>
              <Td className="text-right tabular-nums">{pontos(l.resultado)}</Td>
              <Td className="text-right tabular-nums text-slate-600">
                {Number(l.bonus) > 0 ? `+${pontos(l.bonus)}` : '—'}
              </Td>
              <Td className="text-right font-semibold tabular-nums">{pontos(l.pontos_pagos)}</Td>
              <Td className="text-right font-semibold tabular-nums">
                {l.atingiu_meta
                  ? reais(l.valor)
                  : <span className="text-xs font-normal text-slate-400">abaixo da meta</span>}
              </Td>
              <Td className="text-right">
                <input value={rascunho[l.pessoa_id] ?? ''} disabled={ocupado} inputMode="decimal"
                       placeholder="0,00" aria-label={`Valor do RH para ${l.pessoa_nome}`}
                       onChange={(e) => setRascunho((r) => ({ ...r, [l.pessoa_id]: e.target.value }))}
                       className={`w-28 rounded-md border px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-marca-600 disabled:bg-slate-50 ${
                         mudados.includes(l) ? 'border-amber-500 bg-amber-500/10' : 'border-slate-300 bg-superficie'}`} />
              </Td>
              <Td className="whitespace-nowrap">
                {(() => {
                  const rh = doRh.get(l.pessoa_id);
                  if (!l.atingiu_meta) {
                    return rh == null ? null
                      : <span className="rounded-full bg-slate-500/15 px-2 py-px text-[11px] font-semibold text-slate-600">pago pelo RH</span>;
                  }
                  if (rh == null) return <span className="rounded-full bg-amber-500/15 px-2 py-px text-[11px] font-semibold text-amber-700 dark:text-amber-300">falta o valor do RH</span>;
                  if (l.valor == null) return <span className="rounded-full bg-marca-600/15 px-2 py-px text-[11px] font-semibold text-marca-700 dark:text-marca-400">informado</span>;
                  const d = rh - Number(l.valor);
                  return Math.abs(d) < 0.01
                    ? <span className="rounded-full bg-marca-600/15 px-2 py-px text-[11px] font-semibold text-marca-700 dark:text-marca-400">confere</span>
                    : <span className="rounded-full bg-amber-500/15 px-2 py-px text-[11px] font-semibold text-amber-700 dark:text-amber-300">diferença {d > 0 ? '+' : ''}{reais(d)}</span>;
                })()}
              </Td>
            </tr>
          ))}
        </tbody>
      </Tabela>

      {atualizando && (
        <p className="mt-3 text-right text-sm text-slate-600">Salvo, atualizando a tela…</p>
      )}
      {(mudados.length > 0 || erro || aviso) && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {erro && <span className="mr-auto rounded-lg bg-rose-50 px-3 py-1.5 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</span>}
          {aviso && (atualizando || !mudados.length) && <span className="mr-auto rounded-lg bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</span>}
          {precisaMotivo && (
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={ocupado} placeholder="Motivo da mudança (obrigatório)"
                   className="min-w-64 flex-1 rounded-md border border-slate-300 bg-superficie px-2 py-1.5 text-sm outline-none focus:border-marca-600" />
          )}
          {mudados.length > 0 && !atualizando && <>
            <button type="button" disabled={ocupado} onClick={() => { setRascunho(Object.fromEntries(linhas.map((l) => [l.pessoa_id, paraTexto(doRh.get(l.pessoa_id))]))); setErro(null); }}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Desfazer</button>
            <button type="button" disabled={ocupado} onClick={salvarRh}
                    className="rounded-lg bg-marca-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
              {ocupado ? 'Salvando…' : `Salvar ${mudados.length} valor(es) do RH`}
            </button>
          </>}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        <b>Valor do RH:</b> o que o RH mandou pagar a cada um; é o que o atendente vê no extrato. Mudar um valor já
        informado pede o motivo, e toda mudança fica registrada.{' '}
        Pelo cálculo, quem fecha abaixo da meta não recebe — é para isso que a meta existe; se o RH pagou mesmo
        assim, informe o valor dele.
        O bônus é {Math.round(Number(primeira.percentual_bonus) * 10000) / 100}% da média do cargo
        de referência e só sai quando <strong>todos</strong> os que têm direito batem a meta. Pleno
        e Gestor não recebem: já são remunerados pela média multiplicada. Quem trabalhou a
        competência pela metade não entra na conta do bônus.
      </p>
    </Quadro>
  );
}
