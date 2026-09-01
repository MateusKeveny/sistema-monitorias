'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao } from '@/componentes/ui';
import {
  nota as formatarNota, faixa, percentual,
  semanaDoCiclo, mesDeCompetencia, mesRotulo, hojeNoBrasil,
} from '@/lib/formatar';
import type { Canal, Criterio, Operador } from '@/lib/tipos';

type Resposta = { conforme: boolean | null; observacao: string };

const rotuloCampo = 'mb-1 block text-sm font-medium text-slate-700';
const campo = `w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none
               focus:border-marca-600 focus:ring-2 focus:ring-marca-100`;

/** Valores de uma monitoria existente, quando o formulário está em edição. */
export type MonitoriaEmEdicao = {
  id: string;
  protocolo: string;
  data_atendimento: string;
  numero_monitoria: number;
  operador_id: string;
  canal_id: string | null;
  tempo_atendimento_seg: number | null;
  zerado: boolean;
  motivo_zeramento: string | null;
  parecer: string | null;
  respostas: Record<string, Resposta>;
};

export default function FormularioMonitoria({
  perfilId, criterios, operadores, canais, emEdicao,
}: {
  perfilId: string;
  criterios: Criterio[];
  operadores: Operador[];
  canais: Canal[];
  /** Ausente = lançamento novo. Presente = edição da monitoria indicada. */
  emEdicao?: MonitoriaEmEdicao;
}) {
  const router = useRouter();
  const editando = Boolean(emEdicao);

  const [protocolo, setProtocolo] = useState(emEdicao?.protocolo ?? '');
  const [dataAtendimento, setDataAtendimento] = useState(emEdicao?.data_atendimento ?? hojeNoBrasil());
  const [operadorId, setOperadorId] = useState(emEdicao?.operador_id ?? '');
  const [canalId, setCanalId] = useState(emEdicao?.canal_id ?? canais[0]?.id ?? '');
  const [tempo, setTempo] = useState(
    emEdicao?.tempo_atendimento_seg ? String(Math.round(emEdicao.tempo_atendimento_seg / 60)) : '');
  const [zerado, setZerado] = useState(emEdicao?.zerado ?? false);
  const [motivoZeramento, setMotivoZeramento] = useState(emEdicao?.motivo_zeramento ?? '');
  const [parecer, setParecer] = useState(emEdicao?.parecer ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // No ciclo 26→25 da IGreen, semana e mês de competência são função
  // determinística da data do atendimento — por isso não são digitados. O banco
  // deriva os mesmos valores no gravar; aqui é só para o monitor conferir.
  const semana = semanaDoCiclo(dataAtendimento);
  const competencia = mesDeCompetencia(dataAtendimento);

  // Quais números já foram usados naquele operador, naquela semana do ciclo.
  // O nº da monitoria deixa de ser escolhido: é o primeiro slot livre.
  const [ocupados, setOcupados] = useState<number[] | null>(null);

  useEffect(() => {
    if (!operadorId) { setOcupados(null); return; }

    let cancelado = false;
    setOcupados(null);

    (async () => {
      const db = criarClienteNavegador();
      let consulta = db.from('monitorias')
        .select('numero_monitoria')
        .eq('operador_id', operadorId)
        .eq('mes_referencia', competencia)
        .eq('semana_mes', semana);

      // Na edição, a própria monitoria não conta como slot ocupado.
      if (emEdicao) consulta = consulta.neq('id', emEdicao.id);

      const { data } = await consulta;
      if (!cancelado) setOcupados((data ?? []).map((m) => m.numero_monitoria as number));
    })();

    return () => { cancelado = true; };
  }, [operadorId, competencia, semana, emEdicao]);

  const POR_SEMANA = 4;
  const livres = ocupados === null
    ? []
    : [1, 2, 3, 4].filter((n) => !ocupados.includes(n));
  const semanaCheia = ocupados !== null && livres.length === 0;

  // Em edição o número original é preservado; em lançamento novo, o primeiro livre.
  const numero = emEdicao ? emEdicao.numero_monitoria : (livres[0] ?? POR_SEMANA);

  // Num lançamento novo tudo começa "Sim", que é o caso comum. Em edição, cada
  // critério vem como está gravado — e um critério criado depois da monitoria
  // aparece sem resposta, para ser respondido em vez de assumir conformidade.
  const [respostas, setRespostas] = useState<Record<string, Resposta>>(() =>
    Object.fromEntries(criterios.map((c) => [
      c.id,
      emEdicao
        ? emEdicao.respostas[c.id] ?? { conforme: null, observacao: '' }
        : { conforme: true, observacao: '' },
    ])));

  // Mesma fórmula da planilha: zerado -> 0; senão 1 - soma dos pesos reprovados.
  const { notaPrevia, reprovados, pendentes } = useMemo(() => {
    let perdido = 0;
    const reprovados: Criterio[] = [];
    let pendentes = 0;
    for (const c of criterios) {
      const r = respostas[c.id];
      if (!r || r.conforme === null) { pendentes++; continue; }
      if (!r.conforme) { perdido += Number(c.peso); reprovados.push(c); }
    }
    return {
      notaPrevia: zerado ? 0 : Math.max(0, Number((1 - perdido).toFixed(4))),
      reprovados,
      pendentes,
    };
  }, [respostas, criterios, zerado]);

  function responder(id: string, valor: Partial<Resposta>) {
    setRespostas((atual) => ({ ...atual, [id]: { ...atual[id], ...valor } }));
  }

  function marcarTodos(conforme: boolean) {
    setRespostas(Object.fromEntries(
      criterios.map((c) => [c.id, { conforme, observacao: respostas[c.id]?.observacao ?? '' }])));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!operadorId) return setErro('Selecione o operador avaliado.');
    if (semanaCheia) return setErro('Esta semana já tem as 4 monitorias do operador. Escolha outra data ou outro operador.');
    if (pendentes > 0) return setErro(`Faltam ${pendentes} critério(s) sem resposta.`);
    if (zerado && !motivoZeramento.trim())
      return setErro('Descreva o motivo do zeramento por falha crítica.');

    setSalvando(true);
    const db = criarClienteNavegador();

    const campos = {
      protocolo: protocolo.trim(),
      data_atendimento: dataAtendimento,
      semana_mes: semana,
      numero_monitoria: numero,
      operador_id: operadorId,
      canal_id: canalId || null,
      tempo_atendimento_seg: tempo ? Math.round(Number(tempo) * 60) : null,
      zerado,
      motivo_zeramento: zerado ? motivoZeramento.trim() : null,
      parecer: parecer.trim() || null,
    };

    const mensagemDeErro = (e: { code?: string; message: string }) =>
      e.code === '23505'
        ? 'Já existe uma monitoria com essa combinação de operador, mês, semana e número.'
        : e.message;

    // ------------------------------------------------------------- edição
    if (emEdicao) {
      const { error } = await db.from('monitorias').update(campos).eq('id', emEdicao.id);
      if (error) { setSalvando(false); setErro(mensagemDeErro(error)); return; }

      const itens = criterios.map((c) => ({
        monitoria_id: emEdicao.id,
        criterio_id: c.id,
        conforme: respostas[c.id].conforme as boolean,
        observacao: respostas[c.id].observacao.trim() || null,
      }));

      // Upsert cobre os dois casos: atualiza o que já existia e cria a resposta
      // de um critério que passou a existir depois desta monitoria.
      const { error: erroItens } = await db.from('monitoria_itens')
        .upsert(itens, { onConflict: 'monitoria_id,criterio_id' });
      if (erroItens) {
        setSalvando(false);
        setErro(`Falha ao gravar os critérios: ${erroItens.message}`);
        return;
      }

      router.push(`/monitorias/${emEdicao.id}`);
      router.refresh();
      return;
    }

    // ---------------------------------------------------------- lançamento
    const { data: criada, error: erroMonitoria } = await db
      .from('monitorias')
      .insert({ ...campos, monitor_id: perfilId })
      .select('id')
      .single();

    if (erroMonitoria) {
      setSalvando(false);
      setErro(mensagemDeErro(erroMonitoria));
      return;
    }

    const itens = criterios.map((c) => ({
      monitoria_id: criada.id,
      criterio_id: c.id,
      conforme: respostas[c.id].conforme as boolean,
      observacao: respostas[c.id].observacao.trim() || null,
    }));

    const { error: erroItens } = await db.from('monitoria_itens').insert(itens);
    if (erroItens) {
      // Sem os itens a monitoria fica inconsistente; desfaz para não sujar a base.
      await db.from('monitorias').delete().eq('id', criada.id);
      setSalvando(false);
      setErro(`Falha ao gravar os critérios: ${erroItens.message}`);
      return;
    }

    router.push(`/monitorias/${criada.id}`);
    router.refresh();
  }

  const cores = {
    otimo: 'text-emerald-700', bom: 'text-sky-700',
    atencao: 'text-amber-700', critico: 'text-rose-700', vazio: 'text-slate-500',
  };

  return (
    <form onSubmit={salvar} className="space-y-6 pb-24">
      <div>
        <h1 className="text-xl font-semibold text-sobre-fundo">
          {editando ? `Editar monitoria ${emEdicao!.protocolo}` : 'Nova monitoria'}
        </h1>
        <p className="text-sm text-sobre-fundo-suave">
          {editando
            ? 'Toda alteração fica registrada no histórico da monitoria, com autor e data.'
            : 'A nota é calculada automaticamente pelos pesos dos critérios.'}
        </p>
      </div>

      {semanaCheia && !editando && (
        <p className="rounded-xl bg-amber-50 px-5 py-4 text-sm text-amber-900
                      ring-1 ring-amber-600/20">
          <strong>Semana concluída.</strong> Este operador já tem as {POR_SEMANA} monitorias
          da {semana}ª semana de {mesRotulo(competencia)}. Para lançar outra, escolha uma data
          de outra semana ou outro operador.
        </p>
      )}

      <Cartao titulo="Identificação do atendimento">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label>
            <span className={rotuloCampo}>ID / Protocolo</span>
            <input required value={protocolo} onChange={(e) => setProtocolo(e.target.value)}
              className={campo} placeholder="500063153" />
          </label>

          <label>
            <span className={rotuloCampo}>Data do atendimento</span>
            <input type="date" required value={dataAtendimento}
              onChange={(e) => setDataAtendimento(e.target.value)} className={campo} />
          </label>

          <label>
            <span className={rotuloCampo}>Operador(a)</span>
            <select required value={operadorId} onChange={(e) => setOperadorId(e.target.value)}
              className={campo}>
              <option value="">Selecione…</option>
              {operadores.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </label>

          <label>
            <span className={rotuloCampo}>Canal de atendimento</span>
            <select value={canalId} onChange={(e) => setCanalId(e.target.value)} className={campo}>
              <option value="">—</option>
              {canais.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>

          <div>
            <span className={rotuloCampo}>Semana do ciclo</span>
            <p className={`${campo} bg-slate-50 text-slate-700`}>
              {semana}ª Semana
              <span className="ml-2 text-xs text-slate-500">
                · competência {mesRotulo(competencia)}
              </span>
            </p>
          </div>

          <div>
            <span className={rotuloCampo}>Nº da monitoria na semana</span>
            <p className={`${campo} ${semanaCheia
              ? 'border-rose-300 bg-rose-50 text-rose-900'
              : 'bg-slate-50 text-slate-700'}`}>
              {!operadorId ? (
                <span className="text-slate-400">selecione o operador</span>
              ) : ocupados === null ? (
                <span className="text-slate-400">verificando…</span>
              ) : semanaCheia ? (
                <span className="font-medium">Semana concluída · 4 de 4</span>
              ) : (
                <>
                  {numero}ª Monitoria
                  <span className="ml-2 text-xs text-slate-500">
                    · {ocupados.length} de {POR_SEMANA} já lançada
                    {ocupados.length === 1 ? '' : 's'} nesta semana
                  </span>
                </>
              )}
            </p>
          </div>

          <label>
            <span className={rotuloCampo}>Tempo de atendimento (min)</span>
            <input type="number" min="0" step="1" value={tempo}
              onChange={(e) => setTempo(e.target.value)} className={campo} placeholder="opcional" />
          </label>
        </div>
      </Cartao>

      <Cartao
        titulo={`Critérios de atendimento (${criterios.length})`}
        acao={
          <div className="flex gap-2">
            <button type="button" onClick={() => marcarTodos(true)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium
                         text-slate-700 hover:bg-slate-50">
              Marcar tudo Sim
            </button>
            <button type="button" onClick={() => marcarTodos(false)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium
                         text-slate-700 hover:bg-slate-50">
              Tudo Não
            </button>
          </div>
        }
      >
        <ul className="divide-y divide-slate-100">
          {criterios.map((c) => {
            const r = respostas[c.id];
            return (
              <li key={c.id} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">
                      <span className="mr-2 tabular-nums text-slate-400">{c.ordem}.</span>
                      {c.nome}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Vale {percentual(Number(c.peso))} da nota
                    </p>
                  </div>

                  <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-300">
                    {([true, false] as const).map((valor) => (
                      <button
                        key={String(valor)} type="button"
                        onClick={() => responder(c.id, { conforme: valor })}
                        className={`px-4 py-1.5 text-sm font-medium transition ${
                          r?.conforme === valor
                            ? valor ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                            : 'bg-superficie text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {valor ? 'Sim' : 'Não'}
                      </button>
                    ))}
                  </div>
                </div>

                {r?.conforme === false && (
                  <input
                    value={r.observacao} onChange={(e) => responder(c.id, { observacao: e.target.value })}
                    placeholder="Evidência / o que aconteceu neste critério"
                    className="mt-2 w-full rounded-lg border border-rose-200 bg-rose-50/50 px-3 py-1.5
                               text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Cartao>

      <Cartao titulo="Fechamento">
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-lg bg-rose-50 p-3 ring-1 ring-rose-600/10">
            <input type="checkbox" checked={zerado} onChange={(e) => setZerado(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-400 text-rose-600" />
            <span>
              <span className="block text-sm font-medium text-rose-900">
                Zerar por falha crítica
              </span>
              <span className="block text-xs text-rose-700">
                A nota vai a 0% independentemente dos critérios acima.
              </span>
            </span>
          </label>

          {zerado && (
            <label className="block">
              <span className={rotuloCampo}>Motivo do zeramento</span>
              <input value={motivoZeramento} onChange={(e) => setMotivoZeramento(e.target.value)}
                className={campo} placeholder="Qual falha crítica motivou o zeramento" />
            </label>
          )}

          <label className="block">
            <span className={rotuloCampo}>Parecer geral / observações</span>
            <textarea value={parecer} onChange={(e) => setParecer(e.target.value)} rows={5}
              className={campo} placeholder="Feedback que será entregue ao operador." />
          </label>
        </div>
      </Cartao>

      {/* Barra fixa com a nota calculada em tempo real */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-superficie/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <div>
            <span className="block text-xs uppercase tracking-wide text-slate-500">
              Nota calculada
            </span>
            <span className={`text-2xl font-semibold tabular-nums ${
              zerado ? cores.critico : cores[faixa(notaPrevia)]}`}>
              {formatarNota(notaPrevia)}
            </span>
          </div>

          <p className="min-w-0 flex-1 text-xs text-slate-500">
            {zerado
              ? 'Zerada por falha crítica.'
              : reprovados.length === 0
                ? 'Nenhum critério reprovado.'
                : `Descontos: ${reprovados.map((c) => `${c.nome} (−${percentual(Number(c.peso))})`).join(', ')}`}
          </p>

          {erro && (
            <p className="w-full rounded-lg bg-rose-50 px-3 py-1.5 text-sm text-rose-800
                          ring-1 ring-rose-600/20 sm:w-auto">
              {erro}
            </p>
          )}

          <button type="submit" disabled={salvando || semanaCheia}
            className="rounded-lg bg-marca-600 px-5 py-2.5 text-sm font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-60">
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Salvar monitoria'}
          </button>
        </div>
      </div>
    </form>
  );
}
