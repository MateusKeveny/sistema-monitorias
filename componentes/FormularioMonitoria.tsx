'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro } from '@/componentes/ui';
import {
  nota as formatarNota, faixa, percentual,
  semanaDoCiclo, periodoDaSemana, mesDeCompetencia, mesRotulo, hojeNoBrasil,
  data as formatarDataBR, diaMes,
} from '@/lib/formatar';
import type { Canal, Criterio, Operador } from '@/lib/tipos';
import {
  ROTULO_QUEM, ROTULO_TIPO, TIPOS_QUE_AVISAM_NA_MONITORIA, validade, type RegistroDiario,
} from '@/lib/diario';

type Resposta = { conforme: boolean | null; observacao: string };

/** Um atendimento já importado do Hub, candidato ao sorteio (5.1.0). */
type Atendimento = { protocolo: string; data: string; tabulacao: string | null };

const POR_SEMANA = 4;

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
  perfilId, criterios, operadores, canais, emEdicao, mesAberto, operadorInicial,
}: {
  perfilId: string;
  criterios: Criterio[];
  operadores: Operador[];
  canais: Canal[];
  /** Ausente = lançamento novo. Presente = edição da monitoria indicada. */
  emEdicao?: MonitoriaEmEdicao;
  /**
   * Mês aberto para monitorias (migração 30): o seguinte só libera com o
   * fechamento da cota. A trava de verdade é do banco; aqui a data já nasce
   * dentro do mês aberto e o formulário avisa antes de salvar.
   */
  mesAberto?: string;
  /** Atendente já escolhido ao chegar pelo nome na Cobertura do ciclo (5.3.0). */
  operadorInicial?: string;
}) {
  const router = useRouter();
  const editando = Boolean(emEdicao);

  const [protocolo, setProtocolo] = useState(emEdicao?.protocolo ?? '');
  // Último dia do mês aberto: o ciclo vai do dia 26 ao 25.
  const ultimoDia = mesAberto ? `${mesAberto.slice(0, 8)}25` : null;
  // Em lançamento novo a data começa vazia, de propósito: preenchida com a data
  // de hoje, ela era salva sem ser conferida e a monitoria caía na semana ou no
  // mês errado. O analista informa a data do atendimento que está avaliando.
  const [dataAtendimento, setDataAtendimento] = useState(emEdicao?.data_atendimento ?? '');
  const [operadorId, setOperadorId] = useState(emEdicao?.operador_id ?? operadorInicial ?? '');
  const [canalId, setCanalId] = useState(emEdicao?.canal_id ?? canais[0]?.id ?? '');
  const [tempo, setTempo] = useState(
    emEdicao?.tempo_atendimento_seg ? String(Math.round(emEdicao.tempo_atendimento_seg / 60)) : '');
  const [zerado, setZerado] = useState(emEdicao?.zerado ?? false);
  const [motivoZeramento, setMotivoZeramento] = useState(emEdicao?.motivo_zeramento ?? '');
  const [parecer, setParecer] = useState(emEdicao?.parecer ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Diário de bordo (4.13.0): autorização ou exceção registrada para este
  // protocolo abre um aviso antes de gravar, e o monitor diz se ela impacta a
  // avaliação. A resposta fica em `diario_citacoes`.
  const [citados, setCitados] = useState<RegistroDiario[] | null>(null);
  const [impactos, setImpactos] = useState<Record<string, { impacta: boolean | null; justificativa: string }>>({});

  // No ciclo 26→25 da IGreen, semana e mês de competência são função
  // determinística da data do atendimento — por isso não são digitados. O banco
  // deriva os mesmos valores no gravar; aqui é só para o monitor conferir.
  const temData = /^\d{4}-\d{2}-\d{2}$/.test(dataAtendimento);
  const semana = temData ? semanaDoCiclo(dataAtendimento) : null;
  const competencia = temData ? mesDeCompetencia(dataAtendimento) : null;

  // Quais números já foram usados naquele operador, naquela semana do ciclo.
  // O nº da monitoria deixa de ser escolhido: é o primeiro slot livre.
  const [ocupados, setOcupados] = useState<number[] | null>(null);

  useEffect(() => {
    if (!operadorId || !competencia || !semana) { setOcupados(null); return; }

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

  const livres = ocupados === null
    ? []
    : [1, 2, 3, 4].filter((n) => !ocupados.includes(n));
  const semanaCheia = ocupados !== null && livres.length === 0;

  // ------------------------------------------------------------ o sorteio
  // Em lançamento novo o protocolo deixou de ser digitado (5.1.0): o monitor
  // escolhe o atendente e a semana, e o painel sorteia um atendimento que já
  // veio no relatório do Hub (`avaliacoes`). Digitar à mão continua possível,
  // mas só enquanto a semana ainda couber monitoria — com as 4 lançadas, o
  // campo some, senão ele seria o caminho para furar o limite da semana.
  const competenciaAberta = mesAberto ?? mesDeCompetencia(hojeNoBrasil());
  const [semanaEscolhida, setSemanaEscolhida] = useState<number | null>(null);
  const [doCiclo, setDoCiclo] = useState<
    { avaliacoes: Atendimento[]; monitorados: string[]; feitasPorSemana: number[] } | null>(null);
  const [descartados, setDescartados] = useState<string[]>([]);
  const [sorteado, setSorteado] = useState<Atendimento | null>(null);
  const [manual, setManual] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (editando || !operadorId) { setDoCiclo(null); return; }

    let cancelado = false;
    setDoCiclo(null); setSorteado(null); setDescartados([]); setManual(false);
    setSemanaEscolhida(null); setProtocolo(''); setDataAtendimento('');

    (async () => {
      const db = criarClienteNavegador();
      const [inicio] = periodoDaSemana(competenciaAberta, 1);
      const [, fim] = periodoDaSemana(competenciaAberta, POR_SEMANA);
      const [{ data: avaliacoes }, { data: monitorias }] = await Promise.all([
        db.from('avaliacoes').select('protocolo, data, tabulacao')
          .eq('pessoa_id', operadorId).gte('data', inicio).lte('data', fim)
          .not('protocolo', 'is', null),
        db.from('monitorias').select('protocolo, semana_mes')
          .eq('operador_id', operadorId).eq('mes_referencia', competenciaAberta),
      ]);
      if (cancelado) return;

      const feitasPorSemana = [0, 0, 0, 0];
      for (const m of (monitorias ?? []) as { semana_mes: number }[]) {
        if (m.semana_mes >= 1 && m.semana_mes <= POR_SEMANA) feitasPorSemana[m.semana_mes - 1]++;
      }
      setDoCiclo({
        avaliacoes: (avaliacoes ?? []) as Atendimento[],
        monitorados: (monitorias ?? []).map((m) => (m as { protocolo: string }).protocolo),
        feitasPorSemana,
      });
    })();

    return () => { cancelado = true; };
  }, [operadorId, competenciaAberta, editando]);

  const hoje = hojeNoBrasil();
  /**
   * Como está cada semana do ciclo para este atendente.
   *
   * `futura` é a semana que ainda não começou — não a que está correndo, que o
   * monitor precisa poder avaliar no dia. `vazia` é a semana sem nenhum
   * atendimento importado: não há o que sortear, mas ainda cabe monitoria.
   */
  const semanas = [1, 2, 3, 4].map((n) => {
    const [de, ate] = periodoDaSemana(competenciaAberta, n);
    const doBolo = (doCiclo?.avaliacoes ?? []).filter((a) => semanaDoCiclo(a.data) === n);
    const feitas = doCiclo?.feitasPorSemana[n - 1] ?? 0;
    const estado = de > hoje ? 'futura'
      : feitas >= POR_SEMANA ? 'cheia'
        : doBolo.length === 0 ? 'vazia' : 'ok';
    return { n, de, ate, feitas, total: doBolo.length, estado } as const;
  });

  // Abre na primeira semana que ainda dá para monitorar, em vez de cair numa
  // já concluída; se nenhuma der, na primeira que já começou.
  const semanaPadrao = (semanas.find((s) => s.estado === 'ok')
    ?? semanas.find((s) => s.estado !== 'futura') ?? semanas[0]).n;
  const semanaAtiva = semanaEscolhida ?? semanaPadrao;
  const aSemana = semanas[semanaAtiva - 1];
  /** Com a semana concluída nem o sorteio nem o campo manual aparecem. */
  const cabeMonitoria = aSemana.estado === 'ok' || aSemana.estado === 'vazia';

  function sortear(alemDestes: string[] = []) {
    if (!doCiclo) return;
    const fora = new Set([...doCiclo.monitorados, ...descartados, ...alemDestes]);
    const bolo = doCiclo.avaliacoes.filter(
      (a) => semanaDoCiclo(a.data) === semanaAtiva && !fora.has(a.protocolo));
    if (bolo.length === 0) {
      setErro('Todos os atendimentos desta semana já foram sorteados ou monitorados.');
      return;
    }
    const escolhido = bolo[Math.floor(Math.random() * bolo.length)];
    setErro(null);
    setSorteado(escolhido);
    setProtocolo(escolhido.protocolo);
    setDataAtendimento(escolhido.data);
  }

  function trocarSemana(n: number) {
    setSemanaEscolhida(n);
    setSorteado(null); setManual(false);
    setProtocolo(''); setDataAtendimento(''); setErro(null);
  }

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
  //
  // Um "Não" sem a evidência escrita não conta como respondido (5.1.0): é o que
  // mais pesa na nota, e sem o motivo o atendente leva o desconto sem saber por
  // quê. Ele fica como pendência até o campo ser preenchido.
  const { notaPrevia, reprovados, semResposta, semEvidencia } = useMemo(() => {
    let perdido = 0;
    const reprovados: Criterio[] = [];
    let semResposta = 0;
    let semEvidencia = 0;
    for (const c of criterios) {
      const r = respostas[c.id];
      if (!r || r.conforme === null) { semResposta++; continue; }
      if (!r.conforme) {
        perdido += Number(c.peso);
        reprovados.push(c);
        if (!r.observacao.trim()) semEvidencia++;
      }
    }
    return {
      notaPrevia: zerado ? 0 : Math.max(0, Number((1 - perdido).toFixed(4))),
      reprovados,
      semResposta,
      semEvidencia,
    };
  }, [respostas, criterios, zerado]);
  // Só no lançamento: numa edição a regra travaria quem só quer corrigir outro
  // campo de uma monitoria antiga, lançada quando a evidência não era exigida.
  const faltaEvidencia = editando ? 0 : semEvidencia;
  const pendentes = semResposta + faltaEvidencia;

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
    if (!validar()) return;

    // O protocolo tem autorização ou exceção no diário ainda sem resposta
    // nesta monitoria? Então o aviso vem antes de gravar.
    const db = criarClienteNavegador();
    const { data: doDiario, error: erroDiario } = await db.from('diario_registros').select('*')
      .eq('protocolo', protocolo.trim()).in('tipo', TIPOS_QUE_AVISAM_NA_MONITORIA).neq('situacao', 'devolvido')
      .order('criado_em', { ascending: false });
    // Sem conseguir conferir o diário, não grava: seguir em silêncio pularia o
    // aviso justamente quando ele poderia existir.
    if (erroDiario) {
      setErro(`Não foi possível conferir o diário de bordo (${erroDiario.message}). Tente salvar de novo.`);
      return;
    }
    let pendentesDoDiario = (doDiario ?? []) as RegistroDiario[];
    if (emEdicao && pendentesDoDiario.length) {
      const { data: jaRespondidos } = await db.from('diario_citacoes').select('registro_id').eq('monitoria_id', emEdicao.id);
      const respondidos = new Set((jaRespondidos ?? []).map((c) => c.registro_id as string));
      pendentesDoDiario = pendentesDoDiario.filter((r) => !respondidos.has(r.id));
    }
    if (pendentesDoDiario.length) { setCitados(pendentesDoDiario); return; }
    await gravar([]);
  }

  /** As mesmas conferências de antes de gravar; devolve se pode seguir. */
  function validar(): boolean {
    const falha = (m: string) => { setErro(m); return false; };

    if (!operadorId) return falha('Selecione o operador avaliado.');
    if (!protocolo.trim()) return falha('Sorteie um atendimento ou informe o protocolo.');
    if (!temData) return falha('Informe a data do atendimento.');
    if (semanaCheia) return falha('Esta semana já tem as 4 monitorias do operador. Escolha outra data ou outro operador.');
    if (semResposta > 0) return falha(`Faltam ${semResposta} critério(s) sem resposta.`);
    if (faltaEvidencia > 0)
      return falha(`Faltam ${faltaEvidencia} critério(s) reprovados sem a evidência do que aconteceu.`);
    if (zerado && !motivoZeramento.trim())
      return falha('Descreva o motivo do zeramento por falha crítica.');
    return true;
  }

  /** Grava a monitoria e, se houver, as respostas do aviso do diário. */
  async function gravar(respostasDiario: { registro_id: string; impacta: boolean; justificativa: string | null }[]) {
    setErro(null);
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

      if (!(await gravarCitacoes(emEdicao.id, respostasDiario))) return;
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

    if (!(await gravarCitacoes(criada.id, respostasDiario))) return;
    router.push(`/monitorias/${criada.id}`);
    router.refresh();
  }

  async function gravarCitacoes(monitoriaId: string, lista: { registro_id: string; impacta: boolean; justificativa: string | null }[]) {
    if (!lista.length) return true;
    const { error } = await criarClienteNavegador().from('diario_citacoes')
      .upsert(lista.map((c) => ({ ...c, monitoria_id: monitoriaId })), { onConflict: 'monitoria_id,registro_id' });
    if (error) {
      setSalvando(false);
      setErro(`A monitoria foi salva, mas a resposta ao diário não: ${error.message}. Abra a monitoria e salve de novo para responder.`);
      return false;
    }
    return true;
  }

  const respostaCompleta = (id: string) => {
    const r = impactos[id];
    return !!r && r.impacta !== null && (!r.impacta || r.justificativa.trim().length > 0);
  };

  async function concluirComDiario() {
    if (!citados) return;
    const lista = citados.map((r) => ({
      registro_id: r.id,
      impacta: impactos[r.id].impacta as boolean,
      justificativa: impactos[r.id].justificativa.trim() || null,
    }));
    setCitados(null);
    await gravar(lista);
  }

  const cores = {
    otimo: 'text-emerald-700', bom: 'text-sky-700',
    atencao: 'text-amber-700', critico: 'text-rose-700', vazio: 'text-slate-500',
  };

  return (
    <form onSubmit={salvar} className="space-y-6 pb-24">
      {citados && (
        <div role="dialog" aria-modal="true" aria-labelledby="titulo-diario"
             className="fixed inset-0 z-50 grid place-items-start overflow-y-auto bg-black/50 px-4 py-10 backdrop-blur-[2px]">
          <div className="surgir mx-auto w-full max-w-2xl rounded-2xl border border-amber-500/50 bg-superficie p-6 shadow-2xl">
            <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
              Protocolo citado no diário de bordo
            </span>
            <h2 id="titulo-diario" className="mt-3 text-lg font-semibold text-slate-900">
              O protocolo {protocolo.trim()} tem {citados.length === 1 ? 'um registro' : `${citados.length} registros`} no diário
            </h2>
            <p className="text-sm text-slate-500">Confira se o registro muda a avaliação antes de concluir a monitoria.</p>

            <div className="mt-4 space-y-5">
              {citados.map((r) => {
                const resp = impactos[r.id] ?? { impacta: null, justificativa: '' };
                // Parte do valor atual, e não do que estava na tela: escolher
                // e digitar em seguida não desfaz a escolha.
                const responder = (v: Partial<typeof resp>) => setImpactos((s) => ({
                  ...s, [r.id]: { ...(s[r.id] ?? { impacta: null, justificativa: '' }), ...v },
                }));
                return (
                  <div key={r.id}>
                    <div className="rounded-r-xl border-l-4 border-amber-500 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <b className="text-slate-900">{r.assunto}</b> · {ROTULO_TIPO[r.tipo].toLowerCase()} · {formatarDataBR(r.data)}
                      {r.valido_ate && ` · ${validade(r, hojeNoBrasil())!.texto.toLowerCase()}`}
                      <span className="mt-1 block whitespace-pre-line">{r.descricao}</span>
                      {r.autorizado_por && (
                        <span className="mt-1 block text-xs text-slate-500">
                          Autorizado por {ROTULO_QUEM[r.autorizado_por]}{r.autorizado_por_nome ? ` (${r.autorizado_por_nome})` : ''}
                          {r.situacao === 'aguardando' ? ' · ainda aguardando aprovação' : ''}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {([[true, 'Impacta a monitoria', 'o critério afetado deve ser revisto'],
                        [false, 'Não impacta', 'o registro não muda a avaliação']] as const).map(([valor, titulo, dica]) => (
                        <button key={String(valor)} type="button" aria-pressed={resp.impacta === valor}
                                onClick={() => responder({ impacta: valor })}
                                className={`rounded-xl border-2 px-3 py-2 text-left ${resp.impacta === valor
                                  ? 'border-marca-600 bg-marca-600/8' : 'border-slate-200 hover:border-slate-300'}`}>
                          <b className="block text-sm text-slate-800">{titulo}</b>
                          <span className="text-xs text-slate-500">{dica}</span>
                        </button>
                      ))}
                    </div>
                    <label className="mt-3 block">
                      <span className="mb-1 block text-xs font-medium text-slate-600">
                        Justificativa {resp.impacta ? '*' : '(opcional)'}
                      </span>
                      <textarea rows={2} value={resp.justificativa} onChange={(e) => responder({ justificativa: e.target.value })}
                                placeholder="Ex.: o estorno fora do prazo foi autorizado; o critério ‘seguiu a política’ não deve descontar."
                                className={campo} />
                    </label>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setCitados(null)}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Voltar à monitoria
              </button>
              <button type="button" disabled={salvando || !citados.every((r) => respostaCompleta(r.id))} onClick={concluirComDiario}
                      className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                {editando ? 'Salvar monitoria' : 'Concluir monitoria'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Data no futuro quase sempre é erro de digitação — e é um erro que não
          aparece: a monitoria cai numa competência que ainda não chegou, some
          dos relatórios do mês e reaparece meses depois. Já aconteceu duas
          vezes, uma delas lançada em setembro com data de dezembro.

          Avisa, não bloqueia: pode haver caso legítimo, e travar o lançamento
          atrapalharia mais do que ajudaria. */}
      {dataAtendimento > hojeNoBrasil() && (
        <p className="rounded-xl bg-amber-50 px-5 py-4 text-sm text-amber-900
                      ring-1 ring-amber-600/20">
          <strong>Data no futuro.</strong> O atendimento está em{' '}
          {formatarDataBR(dataAtendimento)}, que ainda não aconteceu. A monitoria vai
          contar em {competencia && mesRotulo(competencia)} e não aparece nos relatórios até lá —
          confira a data antes de salvar.
        </p>
      )}

      {ultimoDia && dataAtendimento > ultimoDia && (
        <p className="rounded-xl bg-amber-50 px-5 py-4 text-sm text-amber-900
                      ring-1 ring-amber-600/20">
          <strong>Competência ainda não liberada.</strong> Este atendimento conta em{' '}
          {competencia && mesRotulo(competencia)}, que só abre para monitorias depois do fechamento da cota de{' '}
          {mesRotulo(mesAberto!)}. Até lá, só dá para lançar atendimentos até {formatarDataBR(ultimoDia)}.
        </p>
      )}

      {semanaCheia && !editando && (
        <p className="rounded-xl bg-amber-50 px-5 py-4 text-sm text-amber-900
                      ring-1 ring-amber-600/20">
          <strong>Semana concluída.</strong> Este operador já tem as {POR_SEMANA} monitorias
          da {semana}ª semana de {competencia && mesRotulo(competencia)}. Para lançar outra, escolha uma data
          de outra semana ou outro operador.
        </p>
      )}

      {!editando && (
        <Quadro titulo="O atendimento"
                subtitulo="O sorteio usa os protocolos já importados do Hub, na semana escolhida.">
          <div className="grid gap-4 lg:grid-cols-[minmax(14rem,1fr)_2fr]">
            <label>
              <span className={rotuloCampo}>Atendente</span>
              <select required value={operadorId} onChange={(e) => setOperadorId(e.target.value)}
                className={campo}>
                <option value="">Selecione…</option>
                {operadores.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
            </label>

            <div>
              <span className={rotuloCampo}>Semana do ciclo · {mesRotulo(competenciaAberta)}</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {semanas.map((s) => (
                  <button
                    key={s.n} type="button" disabled={!operadorId || s.estado === 'futura'}
                    aria-pressed={s.n === semanaAtiva}
                    onClick={() => trocarSemana(s.n)}
                    className={`rounded-xl border-2 px-2.5 py-2 text-left transition disabled:opacity-50 ${
                      s.n === semanaAtiva ? 'border-marca-600 bg-marca-50' : 'border-slate-200 hover:border-slate-300'}`}
                  >
                    <span className="block text-sm font-semibold text-slate-800">{s.n}ª semana</span>
                    <span className="block text-xs text-slate-500">{diaMes(s.de)} a {diaMes(s.ate)}</span>
                    <span className={`mt-1 inline-block rounded-full px-1.5 text-[11px] font-semibold ${
                      !operadorId || doCiclo === null ? 'bg-slate-100 text-slate-500'
                        : s.estado === 'cheia' ? 'bg-emerald-100 text-emerald-800'
                          : s.estado === 'vazia' ? 'bg-amber-100 text-amber-900'
                            : s.estado === 'futura' ? 'bg-slate-100 font-normal text-slate-500'
                              : 'bg-slate-100 font-normal text-slate-500'}`}>
                      {!operadorId ? '—' : doCiclo === null ? '…'
                        : s.estado === 'cheia' ? 'concluída'
                          : s.estado === 'vazia' ? 'sem atendimentos'
                            : s.estado === 'futura' ? 'ainda não começou'
                              : `${s.feitas} de ${POR_SEMANA}`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!operadorId ? (
            <p className="mt-4 text-sm text-slate-500">Escolha o atendente para ver as semanas.</p>
          ) : doCiclo === null ? (
            <p className="mt-4 text-sm text-slate-500">Procurando os atendimentos do ciclo…</p>
          ) : sorteado ? (
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <div className="flex flex-wrap items-center gap-3 bg-marca-50 px-5 py-4">
                <div>
                  <span className="block text-xs text-slate-500">Protocolo sorteado</span>
                  <span className="font-mono text-2xl font-bold tracking-tight text-slate-900">
                    {sorteado.protocolo}
                  </span>
                </div>
                <div className="ml-auto flex gap-2">
                  <button type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(sorteado.protocolo).catch(() => {});
                      setCopiado(true);
                      setTimeout(() => setCopiado(false), 1600);
                    }}
                    className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                               font-medium text-slate-700 hover:bg-slate-50">
                    {copiado ? 'Copiado ✓' : 'Copiar'}
                  </button>
                  <button type="button" onClick={() => sortear([sorteado.protocolo])}
                    className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                               font-medium text-slate-700 hover:bg-slate-50">
                    Sortear outro
                  </button>
                </div>
              </div>
              <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-slate-500">Data do atendimento</dt>
                  <dd className="text-sm font-semibold text-slate-800">{formatarDataBR(sorteado.data)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Semana do ciclo</dt>
                  <dd className="text-sm font-semibold text-slate-800">
                    {semana}ª · competência {competencia && mesRotulo(competencia)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Nº da monitoria</dt>
                  <dd className="text-sm font-semibold text-slate-800">{numero}ª de {POR_SEMANA} na semana</dd>
                </div>
                <div className="sm:col-span-2 lg:col-span-4 lg:border-t lg:border-slate-100 lg:pt-3">
                  <dt className="text-xs text-slate-500">Tabulação registrada pelo atendente</dt>
                  <dd className="text-sm font-semibold text-slate-800">
                    {sorteado.tabulacao?.trim() || <span className="font-normal text-slate-500">sem tabulação</span>}
                  </dd>
                </div>
              </dl>
            </div>
          ) : aSemana.estado === 'cheia' ? (
            <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-emerald-600/20">
              <strong className="text-emerald-800">Semana concluída.</strong> Este atendente já tem as {POR_SEMANA} monitorias
              da {aSemana.n}ª semana ({diaMes(aSemana.de)} a {diaMes(aSemana.ate)}). Escolha outra semana ou outro atendente.
            </p>
          ) : aSemana.estado === 'futura' ? (
            <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-amber-600/20">
              <strong className="text-amber-800">Semana ainda não começou.</strong> O período de{' '}
              {diaMes(aSemana.de)} a {diaMes(aSemana.ate)} começa depois de hoje.
            </p>
          ) : (
            <>
              {aSemana.estado === 'vazia' ? (
                <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-amber-600/20">
                  <strong className="text-amber-800">Nenhum atendimento importado.</strong> Não há protocolos deste
                  atendente entre {diaMes(aSemana.de)} e {diaMes(aSemana.ate)}, então não há o que sortear.
                  Importe o relatório da semana ou informe o protocolo abaixo.
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => sortear()}
                    className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700">
                    Sortear protocolo
                  </button>
                  <span className="text-sm text-slate-500">
                    {aSemana.total} atendimento{aSemana.total === 1 ? '' : 's'} nesta semana,
                    {' '}{aSemana.feitas} já monitorado{aSemana.feitas === 1 ? '' : 's'}.
                  </span>
                </div>
              )}

              {/* Só enquanto a semana ainda couber monitoria: com as 4 lançadas,
                  digitar à mão seria o caminho para furar o limite. */}
              {cabeMonitoria && (
                <div className="mt-4">
                  <button type="button" onClick={() => setManual((m) => !m)}
                    className="text-sm text-marca-700 underline dark:text-marca-400">
                    {manual ? 'Voltar ao sorteio' : 'Prefiro digitar o protocolo'}
                  </button>
                  {manual && (
                    <div className="mt-3 grid max-w-xl gap-4 sm:grid-cols-2">
                      <label>
                        <span className={rotuloCampo}>Protocolo</span>
                        <input value={protocolo} onChange={(e) => setProtocolo(e.target.value)}
                          className={campo} placeholder="20261006-05596" />
                      </label>
                      <label>
                        <span className={rotuloCampo}>Data do atendimento</span>
                        <input type="date" value={dataAtendimento} max={ultimoDia ?? undefined}
                          onChange={(e) => setDataAtendimento(e.target.value)} className={campo} />
                      </label>
                      <p className="text-xs text-slate-500 sm:col-span-2">
                        Para avaliar um atendimento específico, ou quando o relatório da semana ainda não foi
                        importado. Os 8 primeiros dígitos do protocolo são a data: 20261006 é 06/10/2026.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-3">
            <label>
              <span className={rotuloCampo}>Canal de atendimento</span>
              <select value={canalId} onChange={(e) => setCanalId(e.target.value)} className={campo}>
                <option value="">—</option>
                {canais.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            <label>
              <span className={rotuloCampo}>Tempo de atendimento (min)</span>
              <input type="number" min="0" step="1" value={tempo}
                onChange={(e) => setTempo(e.target.value)} className={campo} placeholder="opcional" />
            </label>
          </div>
        </Quadro>
      )}

      {editando && (
      <Quadro titulo="Identificação do atendimento">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label>
            <span className={rotuloCampo}>ID / Protocolo</span>
            <input required value={protocolo} onChange={(e) => setProtocolo(e.target.value)}
              className={campo} placeholder="500063153" />
          </label>

          <label>
            <span className={rotuloCampo}>Data do atendimento</span>
            <input type="date" required value={dataAtendimento} max={ultimoDia ?? undefined}
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
              {semana == null || competencia == null
                ? <span className="text-slate-400">Informe a data do atendimento</span>
                : <>
                    {semana}ª Semana
                    <span className="ml-2 text-xs text-slate-500">
                      · competência {mesRotulo(competencia)}
                    </span>
                  </>}
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
      </Quadro>
      )}

      <Quadro
        titulo="Critérios de atendimento"
        subtitulo="Marque Não só no que falhou. O critério só conta como respondido depois que a evidência estiver escrita."
        acao={
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full rounded-full bg-marca-600 transition-all"
                      style={{ width: `${((criterios.length - pendentes) / Math.max(1, criterios.length)) * 100}%` }} />
              </span>
              {criterios.length - pendentes} de {criterios.length} respondidos
            </span>
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
                      {!editando && r?.conforme === false && !r.observacao.trim() && (
                        <span className="ml-2 rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-900">
                          falta a evidência
                        </span>
                      )}
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
      </Quadro>

      <Quadro titulo="Fechamento">
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
      </Quadro>

      {/* Barra fixa com a nota calculada em tempo real. Começa depois do menu
          lateral (5.0.0): presa à janela inteira, ela passava por cima dele e
          cobria o botão de sair. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-superficie/95 backdrop-blur lg:left-60">
        <div className="flex max-w-[1680px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 lg:px-9">
          <div>
            <span className="block text-xs uppercase tracking-wide text-slate-500">
              Nota calculada
            </span>
            <span className={`text-2xl font-semibold tabular-nums ${
              zerado ? cores.critico : cores[faixa(notaPrevia)]}`}>
              {formatarNota(notaPrevia)}
            </span>
          </div>

          {/* O que falta vem antes do que já está feito: é o que impede salvar. */}
          <p className="min-w-0 flex-1 text-xs text-slate-500">
            {pendentes > 0
              ? `Faltam ${pendentes} critério${pendentes === 1 ? '' : 's'}: ${[
                semResposta && `${semResposta} sem resposta`,
                faltaEvidencia && `${faltaEvidencia} sem a evidência`,
              ].filter(Boolean).join(' e ')}.`
              : zerado
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

          <button type="submit"
            disabled={salvando || semanaCheia || pendentes > 0 || !protocolo.trim()
                      || Boolean(ultimoDia && dataAtendimento > ultimoDia)}
            className="rounded-lg bg-marca-600 px-5 py-2.5 text-sm font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-60">
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Salvar monitoria'}
          </button>
        </div>
      </div>
    </form>
  );
}
