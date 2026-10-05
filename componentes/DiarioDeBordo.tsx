'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import {
  AUTORIZADORES, COR_SITUACAO, COR_TIPO, ROTULO_QUEM, ROTULO_SITUACAO, ROTULO_TIPO, TIPOS,
  juntarOutro, palavrasEncontradas, separarOutro, validade, type LeituraDiario, type RenovacaoDiario, type Subcategoria, type QuemAutorizou, type RegistroDiario, type TipoRegistro,
} from '@/lib/diario';

const entrada = `w-full rounded-xl border border-slate-300 bg-superficie px-3 py-2 text-sm outline-none
                 focus:border-marca-600 disabled:opacity-50`;
const rotulo = 'mb-1 block text-xs font-medium text-slate-600';
const botaoPrimario = `rounded-xl bg-marca-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-marca-700 disabled:cursor-not-allowed disabled:opacity-40`;
const botaoSecundario = `rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                         font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40`;

const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const diaExtenso = (iso: string, hoje: string) => {
  if (iso === hoje) return `Hoje, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const d = new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  return d.charAt(0).toUpperCase() + d.slice(1);
};

type Filtro = 'todos' | TipoRegistro | 'aguardando' | 'meus' | 'vencendo' | 'leitura';
const vazio = {
  tipo: '' as TipoRegistro | '', protocolo: '', assunto: '', descricao: '',
  quem: '' as QuemAutorizou | 'ninguem' | '', nome: '', cargo: '', setor: '',
  // Só gestor e Pleno: dia do ocorrido (vazio = hoje) e validade.
  data: '', temValidade: false, validoAte: '',
  subcategoria: '',
};

/**
 * Diário de bordo (1.22.0): o registro de todos e a lista de todos os casos.
 *
 * Autorização e exceção — ou qualquer texto que cite "autorizado",
 * "diretoria", "gestão", "exceção"… — pedem quem autorizou; sem isso o
 * registro não fecha. Autorização da gestão ou da diretoria registrada por um
 * júnior vai para a aprovação do gestor ou do Pleno; a do gestor, do Pleno e
 * do Analista conclui direto (1.24.0). O banco decide a situação (migrações
 * 31 e 33); a tela só antecipa o que vai acontecer.
 */
export default function DiarioDeBordo({
  registros, renovacoes, leituras, subcategorias, nomes, pessoaId, ehGestor, aprova, concluiDireto, hoje, filtroInicial,
}: {
  registros: RegistroDiario[];
  /** Renovações de validade, da mais recente à mais antiga. */
  renovacoes: RenovacaoDiario[];
  /** Quem precisa ler e quem já leu — só chega para gestor e Pleno. */
  leituras: LeituraDiario[];
  /** Subcategorias de problema operacional, ativas e desativadas. */
  subcategorias: Subcategoria[];
  nomes: Record<string, string>;
  pessoaId: string;
  ehGestor: boolean;
  /** Gestor ou Pleno: aprova e devolve o que aguarda. */
  aprova: boolean;
  /** Gestor, Pleno ou Analista: a autorização da gestão já nasce concluída. */
  concluiDireto: boolean;
  hoje: string;
  filtroInicial?: string;
}) {
  const router = useRouter();
  const [f, setF] = useState(vazio);
  const [corrigindo, setCorrigindo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>(
    (['aguardando', 'vencendo', 'leitura', 'meus', 'processo', 'treinamento', 'autorizacao', 'excecao', 'problema'] as string[]).includes(filtroInicial ?? '')
      ? filtroInicial as Filtro : 'todos');
  const [busca, setBusca] = useState('');
  const [devolvendo, setDevolvendo] = useState<{ id: string; texto: string } | null>(null);
  const [renovando, setRenovando] = useState<{ id: string; ate: string } | null>(null);
  const [vendoLeitura, setVendoLeitura] = useState<string | null>(null);
  const leiturasDe = (id: string) => leituras.filter((l) => l.registro_id === id);
  const comLeituraPendente = new Set(leituras.filter((l) => !l.ciente_em).map((l) => l.registro_id));

  const achadas = palavrasEncontradas(`${f.assunto} ${f.descricao}`);
  const exigeQuem = f.tipo === 'autorizacao' || f.tipo === 'excecao';
  const ehProblema = f.tipo === 'problema';
  // Problema operacional é da gestão: não pede quem autorizou.
  const pedeQuem = exigeQuem || (achadas.length > 0 && !ehProblema);
  const nomeSub = (id: number | null) => subcategorias.find((s) => s.id === id)?.nome ?? '—';
  // Em processo e treinamento a palavra pode aparecer sem ter havido
  // autorização ("não foi autorizado"): aí vale responder "ninguém".
  const ninguem = !exigeQuem && f.quem === 'ninguem';
  const outro = f.quem === 'outro';
  const faltam = [
    !f.tipo && 'tipo', ehProblema && !f.subcategoria && 'subcategoria', exigeQuem && !f.protocolo.trim() && 'protocolo', !f.assunto.trim() && 'assunto',
    !f.descricao.trim() && 'o que aconteceu',
    pedeQuem && (!f.quem || (exigeQuem && f.quem === 'ninguem')) && 'quem autorizou',
    pedeQuem && f.quem && !ninguem && !f.nome.trim() && 'nome de quem autorizou',
    pedeQuem && outro && !f.cargo.trim() && 'cargo', pedeQuem && outro && !f.setor.trim() && 'setor',
    aprova && f.data > hoje && 'dia do ocorrido até hoje',
    aprova && f.temValidade && !f.validoAte && 'até quando vale',
    aprova && f.temValidade && f.validoAte && f.validoAte < (f.data || hoje) && 'validade depois do dia do ocorrido',
  ].filter(Boolean) as string[];
  const vaiAprovar = pedeQuem && (f.quem === 'gestao' || f.quem === 'diretoria') && !concluiDireto;

  const set = (campo: keyof typeof vazio) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((s) => ({ ...s, [campo]: e.target.value }));

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (faltam.length) { setErro(`Falta: ${faltam.join(', ')}.`); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const campos = {
      tipo: f.tipo,
      protocolo: exigeQuem ? f.protocolo.trim() : null,
      assunto: f.assunto.trim(),
      descricao: f.descricao.trim(),
      autorizado_por: pedeQuem && !ninguem ? f.quem : null,
      autorizado_por_nome: !pedeQuem || ninguem ? null : outro ? juntarOutro(f.nome, f.cargo, f.setor) : f.nome.trim(),
      subcategoria_id: ehProblema ? Number(f.subcategoria) : null,
      // Para os demais, o banco grava hoje e sem validade (migração 36).
      ...(aprova ? { data: f.data || hoje, valido_ate: f.temValidade ? f.validoAte : null } : {}),
    };
    const db = criarClienteNavegador();
    const { error } = corrigindo
      ? await db.from('diario_registros').update(campos).eq('id', corrigindo)
      : await db.from('diario_registros').insert(campos);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setAviso(vaiAprovar
      ? 'Registro enviado para a aprovação do gestor ou do Pleno. Ele conclui quando for aprovado.'
      : corrigindo ? 'Registro corrigido.' : 'Registro concluído.');
    setF(vazio); setCorrigindo(null);
    router.refresh();
  }

  function corrigir(r: RegistroDiario) {
    setCorrigindo(r.id);
    const nomeGravado = r.autorizado_por_nome ?? '';
    const quem = r.autorizado_por;
    setF({
      tipo: r.tipo, protocolo: r.protocolo ?? '', assunto: r.assunto, descricao: r.descricao,
      subcategoria: r.subcategoria_id ? String(r.subcategoria_id) : '',
      quem: quem ?? '', cargo: '', setor: '',
      data: r.data, temValidade: !!r.valido_ate, validoAte: r.valido_ate ?? '',
      // Nome que não está mais na lista (registro antigo) volta vazio, para
      // ser escolhido de novo.
      nome: quem === 'gestao' || quem === 'diretoria'
        ? (AUTORIZADORES[quem].includes(nomeGravado) ? nomeGravado : '') : nomeGravado,
      ...(quem === 'outro' ? separarOutro(nomeGravado) : {}),
    });
    setErro(null); setAviso(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function decidir(id: string, aprovar: boolean, comentario: string) {
    setOcupado(true); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().rpc('decidir_registro_diario', {
      p_registro: id, p_aprovar: aprovar, p_comentario: comentario,
    });
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setDevolvendo(null);
    setAviso(aprovar ? 'Registro aprovado e concluído.' : 'Registro devolvido ao autor.');
    router.refresh();
  }

  async function renovar(id: string, ate: string) {
    setOcupado(true); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().rpc('renovar_registro_diario', { p_registro: id, p_ate: ate });
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setRenovando(null);
    setAviso('Validade renovada.');
    router.refresh();
  }

  async function excluir(r: RegistroDiario) {
    if (!confirm(`Excluir o registro "${r.assunto}"${r.protocolo ? ` (protocolo ${r.protocolo})` : ''}? Não dá para desfazer.`)) return;
    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().from('diario_registros').delete().eq('id', r.id);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    router.refresh();
  }

  const aguardando = registros.filter((r) => r.situacao === 'aguardando').length;
  const vencendo = registros.filter((r) => validade(r, hoje)?.vencendo).length;
  const leituraPendente = registros.filter((r) => comLeituraPendente.has(r.id)).length;
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const lista = useMemo(() => registros.filter((r) =>
    (filtro === 'todos' || (filtro === 'aguardando' ? r.situacao === 'aguardando'
      : filtro === 'vencendo' ? !!validade(r, hoje)?.vencendo
      : filtro === 'leitura' ? comLeituraPendente.has(r.id)
      : filtro === 'meus' ? r.pessoa_id === pessoaId : r.tipo === filtro))
    && (!termo || [r.protocolo ?? '', r.assunto, r.descricao, nomes[r.pessoa_id] ?? '', r.autorizado_por_nome ?? '']
      .some((t) => t.toLocaleLowerCase('pt-BR').includes(termo)))), [registros, filtro, termo, pessoaId, nomes, hoje, leituras]);
  const porDia = [...lista.reduce((m, r) => m.set(r.data, [...(m.get(r.data) ?? []), r]), new Map<string, RegistroDiario[]>())];

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      {/* ------------------------------------------------ Novo registro */}
      <section className="rounded-[18px] bg-superficie px-6 py-5 shadow-sm xl:sticky xl:top-6">
        <h2 className="text-base font-semibold text-slate-800">{corrigindo ? 'Corrigir registro devolvido' : 'Novo registro'}</h2>
        <p className="mb-4 text-sm text-slate-500">Autorização e exceção pedem o protocolo do atendimento.</p>

        <form onSubmit={registrar} className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 2xl:grid-cols-4" role="radiogroup" aria-label="Tipo do registro">
            {TIPOS.filter((t) => t.chave !== 'problema' || aprova).map((t) => (
              <button key={t.chave} type="button" role="radio" aria-checked={f.tipo === t.chave} disabled={ocupado}
                      onClick={() => setF((s) => ({ ...s, tipo: t.chave }))}
                      className={`rounded-xl border-2 px-3 py-2 text-left transition ${f.tipo === t.chave
                        ? 'border-marca-600 bg-marca-600/8' : 'border-slate-200 hover:border-slate-300'}`}>
                <b className="block text-sm text-slate-800">{t.rotulo}</b>
                <span className="text-xs text-slate-500">{t.dica}</span>
              </button>
            ))}
          </div>

          {ehProblema && (
            <label><span className={rotulo}>Subcategoria *</span>
              <select value={f.subcategoria} onChange={set('subcategoria')} disabled={ocupado} className={entrada}>
                <option value="">Escolha…</option>
                {subcategorias.filter((s) => s.ativo || String(s.id) === f.subcategoria)
                  .map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select></label>
          )}

          {/* Protocolo só em autorização e exceção: processo e treinamento não têm. */}
          <div className={`grid gap-3 ${exigeQuem ? 'sm:grid-cols-[11rem_1fr]' : ''}`}>
            {exigeQuem && (
              <label><span className={rotulo}>Protocolo *</span>
                <input value={f.protocolo} onChange={set('protocolo')} disabled={ocupado} className={entrada} placeholder="Ex.: 88124" /></label>
            )}
            <label><span className={rotulo}>Assunto *</span>
              <input value={f.assunto} onChange={set('assunto')} disabled={ocupado} className={entrada} placeholder="Em poucas palavras" /></label>
          </div>
          <label><span className={rotulo}>O que aconteceu *</span>
            <textarea value={f.descricao} onChange={set('descricao')} disabled={ocupado} rows={4}
                      className={`${entrada} resize-y leading-relaxed`} /></label>

          {aprova && (
            <div className="grid items-end gap-3 sm:grid-cols-3">
              <label><span className={rotulo}>Dia do ocorrido</span>
                <input type="date" value={f.data || hoje} max={hoje} onChange={set('data')} disabled={ocupado} className={entrada} /></label>
              <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
                <input type="checkbox" checked={f.temValidade} disabled={ocupado}
                       onChange={(e) => setF((s) => ({ ...s, temValidade: e.target.checked, validoAte: e.target.checked ? s.validoAte : '' }))}
                       className="h-4 w-4 accent-marca-600" />
                Tem validade
              </label>
              {f.temValidade && (
                <label><span className={rotulo}>Vale até *</span>
                  <input type="date" value={f.validoAte} min={f.data || hoje} onChange={set('validoAte')} disabled={ocupado} className={entrada} /></label>
              )}
              {f.temValidade && (
                <p className="text-xs text-slate-500 sm:col-span-3">Depois dessa data o registro continua no diário, marcado como vencido.</p>
              )}
            </div>
          )}

          {pedeQuem && (
            <div className="surgir rounded-2xl border border-amber-500/45 bg-amber-50 px-4 py-3">
              <p className="mb-2 text-sm text-amber-800 dark:text-amber-200">
                {achadas.length ? (
                  <>O texto cita{' '}
                    {achadas.map((a, i) => (
                      <span key={a}>{i ? ', ' : ''}<mark className="rounded bg-amber-500/30 px-1 text-inherit">{a}</mark></span>
                    ))}. Para concluir, diga quem autorizou.</>
                ) : 'Autorizações e exceções precisam dizer quem autorizou.'}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label><span className={rotulo}>Quem autorizou? *</span>
                  {/* Trocar a origem limpa o nome: o da gestão não vale na diretoria. */}
                  <select value={f.quem} disabled={ocupado} className={entrada}
                          onChange={(e) => setF((s) => ({ ...s, quem: e.target.value as typeof s.quem, nome: '', cargo: '', setor: '' }))}>
                    <option value="">Escolha…</option>
                    {(Object.keys(ROTULO_QUEM) as QuemAutorizou[]).map((q) => <option key={q} value={q}>{ROTULO_QUEM[q]}</option>)}
                    {!exigeQuem && <option value="ninguem">Ninguém autorizou — o texto só menciona</option>}
                  </select></label>
                {f.quem === 'gestao' || f.quem === 'diretoria' ? (
                  <label><span className={rotulo}>Nome de quem autorizou *</span>
                    <select value={f.nome} onChange={set('nome')} disabled={ocupado} className={entrada}>
                      <option value="">Escolha…</option>
                      {AUTORIZADORES[f.quem].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select></label>
                ) : (
                  <label><span className={rotulo}>Nome de quem autorizou {f.quem && !ninguem ? '*' : ''}</span>
                    <input value={ninguem ? '' : f.nome} onChange={set('nome')} disabled={ocupado || !f.quem || ninguem} className={entrada}
                           placeholder={ninguem ? '—' : outro ? 'Nome completo' : 'Escolha quem autorizou'} /></label>
                )}
                {outro && (
                  <>
                    <label><span className={rotulo}>Cargo *</span>
                      <input value={f.cargo} onChange={set('cargo')} disabled={ocupado} className={entrada} placeholder="Ex.: Coordenador" /></label>
                    <label><span className={rotulo}>Setor *</span>
                      <input value={f.setor} onChange={set('setor')} disabled={ocupado} className={entrada} placeholder="Ex.: Comercial" /></label>
                  </>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-600">
                {concluiDireto
                  ? <>Para você, a autorização da gestão ou da diretoria <strong>conclui direto</strong>, sem aprovação.</>
                  : <>Autorização da gestão ou da diretoria vai para <strong>aprovação do gestor ou do Pleno</strong> antes de concluir.</>}
              </p>
            </div>
          )}

          {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
          {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-slate-500">
              {faltam.length ? `Falta: ${faltam.join(', ')}` : vaiAprovar ? 'Vai para a aprovação do gestor ou do Pleno.' : 'Pronto para concluir.'}
            </span>
            <span className="flex gap-2">
              {corrigindo && (
                <button type="button" onClick={() => { setCorrigindo(null); setF(vazio); }} className={botaoSecundario}>Cancelar</button>
              )}
              <button type="submit" disabled={ocupado || faltam.length > 0} className={botaoPrimario}>
                {ocupado ? 'Salvando…' : vaiAprovar ? 'Enviar para aprovação' : corrigindo ? 'Salvar correção' : 'Registrar'}
              </button>
            </span>
          </div>
        </form>
      </section>

      {/* ------------------------------------------------ Registros da equipe */}
      <section className="rounded-[18px] bg-superficie px-6 py-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Registros da equipe</h2>
            <p className="text-sm text-slate-500">Todos os casos, do mais recente ao mais antigo.</p>
          </div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} type="search" aria-label="Buscar"
                 placeholder="Buscar protocolo, assunto ou pessoa…"
                 className="w-72 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-marca-600" />
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {([['todos', 'Todos'], ['processo', 'Processos'], ['treinamento', 'Treinamentos'], ['autorizacao', 'Autorizações'],
            ['excecao', 'Exceções'], ...(aprova ? [['problema', 'Problemas'] as const] : []), ['meus', 'Meus'], ['aguardando', `Aguardando aprovação${aguardando ? ` · ${aguardando}` : ''}`],
            ['vencendo', `Vencendo${vencendo ? ` · ${vencendo}` : ''}`],
            ...(aprova ? [['leitura', `Leitura pendente${leituraPendente ? ` · ${leituraPendente}` : ''}`] as const] : [])] as const)
            .map(([k, r]) => (
              <button key={k} type="button" aria-pressed={filtro === k} onClick={() => setFiltro(k)}
                      className={`rounded-full border px-3 py-0.5 text-xs ${filtro === k
                        ? 'border-marca-600 bg-marca-600/10 text-marca-700 dark:text-marca-400'
                        : (k === 'aguardando' && aguardando) || (k === 'vencendo' && vencendo) || (k === 'leitura' && leituraPendente) ? 'border-amber-500/50 text-amber-700 dark:text-amber-300'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                {r}
              </button>
            ))}
        </div>

        {porDia.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            {registros.length ? 'Nenhum registro neste filtro.' : 'Nenhum registro ainda. O primeiro pode ser o seu.'}
          </p>
        ) : porDia.map(([data, doDia]) => (
          <div key={data}>
            <h3 className="mb-0.5 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">{diaExtenso(data, hoje)}</h3>
            <ul className="divide-y divide-slate-100">
              {doDia.map((r) => (
                <li key={r.id} className="grid gap-1 py-3.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${COR_TIPO[r.tipo]}`}>
                      {ROTULO_TIPO[r.tipo]}{r.tipo === 'problema' ? ` · ${nomeSub(r.subcategoria_id)}` : ''}
                    </span>
                    {r.protocolo && <span className="font-semibold tabular-nums text-slate-800">#{r.protocolo}</span>}
                    <b className="font-semibold text-slate-800">{r.assunto}</b>
                    <SeloValidade r={r} hoje={hoje} />
                    {leiturasDe(r.id).length > 0 && (
                      <SeloLeitura lista={leiturasDe(r.id)} aberto={vendoLeitura === r.id}
                                   alternar={() => setVendoLeitura((v) => v === r.id ? null : r.id)} />
                    )}
                    <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${COR_SITUACAO[r.situacao]}`}>
                      {ROTULO_SITUACAO[r.situacao]}
                    </span>
                  </div>
                  <p className="whitespace-pre-line text-sm text-slate-700">{r.descricao}</p>
                  <p className="text-xs text-slate-500">
                    {nomeCurto(nomes[r.pessoa_id] ?? '—')} · {registradoEm(r)}
                    {r.autorizado_por && ` · autorizado por ${ROTULO_QUEM[r.autorizado_por]}${r.autorizado_por_nome ? ` (${r.autorizado_por_nome})` : ''}`}
                    {/* Quem conclui direto fica como "decidido por" si mesmo: não é aprovação. */}
                    {r.situacao === 'concluido' && r.decidido_por && r.decidido_por !== r.pessoa_id
                      && ` · aprovado por ${nomeCurto(nomes[r.decidido_por] ?? '—')}`}
                  </p>
                  {vendoLeitura === r.id && <QuemLeu lista={leiturasDe(r.id)} hoje={hoje} desde={r.criado_em} />}
                  <UltimaRenovacao lista={renovacoes.filter((x) => x.registro_id === r.id)} nomes={nomes} />
                  {r.situacao === 'devolvido' && r.comentario_decisao && (
                    <p className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-800 ring-1 ring-rose-600/20">
                      Devolvido por {nomeCurto(nomes[r.decidido_por ?? ''] ?? 'gestor')}: {r.comentario_decisao}
                    </p>
                  )}

                  {(ehGestor || (aprova && (r.situacao === 'aguardando' || validade(r, hoje)?.vencendo))
                    || (r.pessoa_id === pessoaId && r.situacao === 'devolvido')) && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {r.pessoa_id === pessoaId && r.situacao === 'devolvido' && (
                        <button type="button" onClick={() => corrigir(r)} className={botaoSecundario}>Corrigir e reenviar</button>
                      )}
                      {aprova && r.situacao === 'aguardando' && r.pessoa_id !== pessoaId && devolvendo?.id !== r.id && (
                        <>
                          <button type="button" disabled={ocupado} onClick={() => decidir(r.id, true, '')}
                                  className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                            Aprovar
                          </button>
                          <button type="button" disabled={ocupado} onClick={() => setDevolvendo({ id: r.id, texto: '' })} className={botaoSecundario}>
                            Devolver
                          </button>
                        </>
                      )}
                      {aprova && devolvendo?.id === r.id && (
                        <span className="flex w-full flex-wrap gap-2">
                          <input autoFocus value={devolvendo.texto} disabled={ocupado}
                                 onChange={(e) => setDevolvendo({ id: r.id, texto: e.target.value })}
                                 placeholder="O que precisa ser corrigido?"
                                 className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm outline-none focus:border-marca-600" />
                          <button type="button" disabled={ocupado || !devolvendo.texto.trim()}
                                  onClick={() => decidir(r.id, false, devolvendo.texto)} className={botaoSecundario}>
                            Devolver
                          </button>
                          <button type="button" onClick={() => setDevolvendo(null)} className="text-sm text-slate-500 hover:underline">cancelar</button>
                        </span>
                      )}
                      {aprova && validade(r, hoje)?.vencendo && renovando?.id !== r.id && (
                        <button type="button" disabled={ocupado} onClick={() => setRenovando({ id: r.id, ate: '' })} className={botaoSecundario}>
                          Renovar validade
                        </button>
                      )}
                      {aprova && renovando?.id === r.id && (
                        <span className="flex w-full flex-wrap items-center gap-2 text-sm text-slate-600">
                          Passa a valer até
                          {/* A nova data é depois da validade atual. */}
                          <input type="date" autoFocus value={renovando.ate} disabled={ocupado} min={diaSeguinte(r.valido_ate!)}
                                 onChange={(e) => setRenovando({ id: r.id, ate: e.target.value })}
                                 className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm outline-none focus:border-marca-600" />
                          <button type="button" disabled={ocupado || !renovando.ate || renovando.ate <= r.valido_ate!}
                                  onClick={() => renovar(r.id, renovando.ate)}
                                  className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                            Renovar
                          </button>
                          <button type="button" onClick={() => setRenovando(null)} className="text-sm text-slate-500 hover:underline">cancelar</button>
                        </span>
                      )}
                      {ehGestor && (
                        <button type="button" disabled={ocupado} onClick={() => excluir(r)}
                                className="ml-auto text-xs text-slate-400 hover:text-rose-700 hover:underline">
                          excluir
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

/** "Vale até" ou "Vencido em": o vencido continua no diário, só marcado. */
function SeloValidade({ r, hoje }: { r: RegistroDiario; hoje: string }) {
  const v = validade(r, hoje);
  if (!v) return null;
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${v.vencido
      ? 'bg-slate-500/15 text-slate-500 line-through decoration-slate-400'
      : v.vencendo ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
      : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'}`}>
      {v.texto}
    </span>
  );
}

const diaSeguinte = (iso: string) => new Date(Date.parse(iso) + 86_400_000).toISOString().slice(0, 10);
const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/**
 * Quando foi registrado. O registro fica no dia do ocorrido, que a gestão pode
 * pôr para trás; aí a data original do registro aparece junto com a hora.
 */
function registradoEm(r: RegistroDiario) {
  const dia = new Date(r.criado_em).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return dia === r.data ? hora(r.criado_em) : `registrado em ${dataBR(dia)} às ${hora(r.criado_em)}`;
}

/** A renovação mais recente do registro — a validade antiga fica à vista. */
function UltimaRenovacao({ lista, nomes }: { lista: RenovacaoDiario[]; nomes: Record<string, string> }) {
  const ultima = lista[0];
  if (!ultima) return null;
  return (
    <p className="text-xs text-slate-500">
      Renovado em {new Date(ultima.renovado_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
      {ultima.renovado_por ? ` por ${nomeCurto(nomes[ultima.renovado_por] ?? '—')}` : ''}
      {/* A lista vem da mais recente à mais antiga: a última guarda a validade de origem. */}
      {' '}· validade original {dataBR(lista[lista.length - 1].valia_ate)}
      {lista.length > 1 ? ` · ${lista.length} renovações` : ''}
    </p>
  );
}

/** "Lido por 6 de 9": âmbar enquanto falta alguém, verde quando todos leram. */
function SeloLeitura({ lista, aberto, alternar }: { lista: LeituraDiario[]; aberto: boolean; alternar: () => void }) {
  const leram = lista.filter((l) => l.ciente_em).length;
  const todos = leram === lista.length;
  return (
    <button type="button" onClick={alternar} aria-expanded={aberto}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${todos
              ? 'border-marca-600/45 text-marca-700 dark:text-marca-400'
              : 'border-amber-500/50 text-amber-700 dark:text-amber-300'}`}>
      {todos ? '✓ ' : ''}Lido por {leram} de {lista.length}
    </button>
  );
}

/** Quem leu (com data e hora) e quem falta (desde quando). */
function QuemLeu({ lista, hoje, desde }: { lista: LeituraDiario[]; hoje: string; desde: string }) {
  const quando = (iso: string) => {
    const d = new Date(iso);
    const dia = d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    return `${dia === hoje ? 'hoje' : dataBR(dia).slice(0, 5)} ${hora(iso)}`;
  };
  const leram = lista.filter((l) => l.ciente_em).sort((a, b) => a.ciente_em!.localeCompare(b.ciente_em!));
  const faltam = lista.filter((l) => !l.ciente_em).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return (
    <div className="mt-1 grid gap-4 rounded-xl bg-slate-50 px-4 py-3 sm:grid-cols-2">
      <div>
        <h4 className="mb-1 text-xs font-semibold text-slate-600">Leram ({leram.length})</h4>
        <ul className="grid gap-0.5 text-sm text-slate-700">
          {leram.length ? leram.map((l) => (
            <li key={l.pessoa_id}>{nomeCurto(l.nome)} <small className="ml-1 text-slate-500">{quando(l.ciente_em!)}</small></li>
          )) : <li className="text-xs text-slate-500">Ninguém ainda.</li>}
        </ul>
      </div>
      <div>
        <h4 className="mb-1 text-xs font-semibold text-slate-600">Faltam ({faltam.length})</h4>
        <ul className="grid gap-0.5 text-sm text-slate-700">
          {faltam.length ? faltam.map((l) => (
            <li key={l.pessoa_id}>{nomeCurto(l.nome)} <small className="ml-1 text-amber-700 dark:text-amber-300">pendente desde {quando(desde)}</small></li>
          )) : <li className="text-xs text-slate-500">Todos leram.</li>}
        </ul>
      </div>
    </div>
  );
}
