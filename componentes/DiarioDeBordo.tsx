'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import {
  COR_SITUACAO, COR_TIPO, ROTULO_QUEM, ROTULO_SITUACAO, ROTULO_TIPO, TIPOS,
  palavrasEncontradas, type QuemAutorizou, type RegistroDiario, type TipoRegistro,
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

type Filtro = 'todos' | TipoRegistro | 'aguardando' | 'meus';
const vazio = { tipo: '' as TipoRegistro | '', protocolo: '', assunto: '', descricao: '', quem: '' as QuemAutorizou | 'ninguem' | '', nome: '' };

/**
 * Diário de bordo (1.22.0): o registro de todos e a lista de todos os casos.
 *
 * Autorização e exceção — ou qualquer texto que cite "autorizado",
 * "diretoria", "gestão", "exceção"… — pedem quem autorizou; sem isso o
 * registro não fecha. Autorização da gestão ou da diretoria vai para a
 * aprovação do gestor. O banco decide a situação (migração 31); a tela só
 * antecipa o que vai acontecer.
 */
export default function DiarioDeBordo({
  registros, nomes, pessoaId, ehGestor, hoje, filtroInicial,
}: {
  registros: RegistroDiario[];
  nomes: Record<string, string>;
  pessoaId: string;
  ehGestor: boolean;
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
    (['aguardando', 'meus', 'processo', 'treinamento', 'autorizacao', 'excecao'] as string[]).includes(filtroInicial ?? '')
      ? filtroInicial as Filtro : 'todos');
  const [busca, setBusca] = useState('');
  const [devolvendo, setDevolvendo] = useState<{ id: string; texto: string } | null>(null);

  const achadas = palavrasEncontradas(`${f.assunto} ${f.descricao}`);
  const exigeQuem = f.tipo === 'autorizacao' || f.tipo === 'excecao';
  const pedeQuem = exigeQuem || achadas.length > 0;
  // Em processo e treinamento a palavra pode aparecer sem ter havido
  // autorização ("não foi autorizado"): aí vale responder "ninguém".
  const ninguem = !exigeQuem && f.quem === 'ninguem';
  const faltam = [
    !f.tipo && 'tipo', !f.protocolo.trim() && 'protocolo', !f.assunto.trim() && 'assunto',
    !f.descricao.trim() && 'o que aconteceu',
    pedeQuem && (!f.quem || (exigeQuem && f.quem === 'ninguem')) && 'quem autorizou', pedeQuem && !ninguem && !f.nome.trim() && 'nome de quem autorizou',
  ].filter(Boolean) as string[];
  const vaiAprovar = pedeQuem && (f.quem === 'gestao' || f.quem === 'diretoria') && !ehGestor;

  const set = (campo: keyof typeof vazio) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((s) => ({ ...s, [campo]: e.target.value }));

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (faltam.length) { setErro(`Falta: ${faltam.join(', ')}.`); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const campos = {
      tipo: f.tipo,
      protocolo: f.protocolo.trim(),
      assunto: f.assunto.trim(),
      descricao: f.descricao.trim(),
      autorizado_por: pedeQuem && !ninguem ? f.quem : null,
      autorizado_por_nome: pedeQuem && !ninguem ? f.nome.trim() : null,
    };
    const db = criarClienteNavegador();
    const { error } = corrigindo
      ? await db.from('diario_registros').update(campos).eq('id', corrigindo)
      : await db.from('diario_registros').insert(campos);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setAviso(vaiAprovar
      ? 'Registro enviado para a aprovação do gestor. Ele conclui quando for aprovado.'
      : corrigindo ? 'Registro corrigido.' : 'Registro concluído.');
    setF(vazio); setCorrigindo(null);
    router.refresh();
  }

  function corrigir(r: RegistroDiario) {
    setCorrigindo(r.id);
    setF({
      tipo: r.tipo, protocolo: r.protocolo, assunto: r.assunto, descricao: r.descricao,
      quem: r.autorizado_por ?? '', nome: r.autorizado_por_nome ?? '',
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

  async function excluir(r: RegistroDiario) {
    if (!confirm(`Excluir o registro "${r.assunto}" (protocolo ${r.protocolo})? Não dá para desfazer.`)) return;
    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().from('diario_registros').delete().eq('id', r.id);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    router.refresh();
  }

  const aguardando = registros.filter((r) => r.situacao === 'aguardando').length;
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const lista = useMemo(() => registros.filter((r) =>
    (filtro === 'todos' || (filtro === 'aguardando' ? r.situacao === 'aguardando'
      : filtro === 'meus' ? r.pessoa_id === pessoaId : r.tipo === filtro))
    && (!termo || [r.protocolo, r.assunto, r.descricao, nomes[r.pessoa_id] ?? '', r.autorizado_por_nome ?? '']
      .some((t) => t.toLocaleLowerCase('pt-BR').includes(termo)))), [registros, filtro, termo, pessoaId, nomes]);
  const porDia = [...lista.reduce((m, r) => m.set(r.data, [...(m.get(r.data) ?? []), r]), new Map<string, RegistroDiario[]>())];

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      {/* ------------------------------------------------ Novo registro */}
      <section className="rounded-[18px] bg-superficie px-6 py-5 shadow-sm xl:sticky xl:top-6">
        <h2 className="text-base font-semibold text-slate-800">{corrigindo ? 'Corrigir registro devolvido' : 'Novo registro'}</h2>
        <p className="mb-4 text-sm text-slate-500">O protocolo é obrigatório para concluir.</p>

        <form onSubmit={registrar} className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 2xl:grid-cols-4" role="radiogroup" aria-label="Tipo do registro">
            {TIPOS.map((t) => (
              <button key={t.chave} type="button" role="radio" aria-checked={f.tipo === t.chave} disabled={ocupado}
                      onClick={() => setF((s) => ({ ...s, tipo: t.chave }))}
                      className={`rounded-xl border-2 px-3 py-2 text-left transition ${f.tipo === t.chave
                        ? 'border-marca-600 bg-marca-600/8' : 'border-slate-200 hover:border-slate-300'}`}>
                <b className="block text-sm text-slate-800">{t.rotulo}</b>
                <span className="text-xs text-slate-500">{t.dica}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
            <label><span className={rotulo}>Protocolo *</span>
              <input value={f.protocolo} onChange={set('protocolo')} disabled={ocupado} className={entrada} placeholder="Ex.: 88124" /></label>
            <label><span className={rotulo}>Assunto *</span>
              <input value={f.assunto} onChange={set('assunto')} disabled={ocupado} className={entrada} placeholder="Em poucas palavras" /></label>
          </div>
          <label><span className={rotulo}>O que aconteceu *</span>
            <textarea value={f.descricao} onChange={set('descricao')} disabled={ocupado} rows={4}
                      className={`${entrada} resize-y leading-relaxed`} /></label>

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
                  <select value={f.quem} onChange={set('quem')} disabled={ocupado} className={entrada}>
                    <option value="">Escolha…</option>
                    {(Object.keys(ROTULO_QUEM) as QuemAutorizou[]).map((q) => <option key={q} value={q}>{ROTULO_QUEM[q]}</option>)}
                    {!exigeQuem && <option value="ninguem">Ninguém autorizou — o texto só menciona</option>}
                  </select></label>
                <label><span className={rotulo}>Nome de quem autorizou {ninguem ? '' : '*'}</span>
                  <input value={ninguem ? '' : f.nome} onChange={set('nome')} disabled={ocupado || ninguem} className={entrada}
                         placeholder={ninguem ? '—' : 'Ex.: Carlos (diretoria comercial)'} /></label>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                Autorização da gestão ou da diretoria vai para <strong>aprovação do gestor</strong> antes de concluir.
              </p>
            </div>
          )}

          {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
          {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-slate-500">
              {faltam.length ? `Falta: ${faltam.join(', ')}` : vaiAprovar ? 'Vai para a aprovação do gestor.' : 'Pronto para concluir.'}
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
            ['excecao', 'Exceções'], ['meus', 'Meus'], ['aguardando', `Aguardando aprovação${aguardando ? ` · ${aguardando}` : ''}`]] as const)
            .map(([k, r]) => (
              <button key={k} type="button" aria-pressed={filtro === k} onClick={() => setFiltro(k)}
                      className={`rounded-full border px-3 py-0.5 text-xs ${filtro === k
                        ? 'border-marca-600 bg-marca-600/10 text-marca-700 dark:text-marca-400'
                        : k === 'aguardando' && aguardando ? 'border-amber-500/50 text-amber-700 dark:text-amber-300'
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
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${COR_TIPO[r.tipo]}`}>{ROTULO_TIPO[r.tipo]}</span>
                    <span className="font-semibold tabular-nums text-slate-800">#{r.protocolo}</span>
                    <b className="font-semibold text-slate-800">{r.assunto}</b>
                    <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${COR_SITUACAO[r.situacao]}`}>
                      {ROTULO_SITUACAO[r.situacao]}
                    </span>
                  </div>
                  <p className="whitespace-pre-line text-sm text-slate-700">{r.descricao}</p>
                  <p className="text-xs text-slate-500">
                    {nomeCurto(nomes[r.pessoa_id] ?? '—')} · {hora(r.criado_em)}
                    {r.autorizado_por && ` · autorizado por ${ROTULO_QUEM[r.autorizado_por]}${r.autorizado_por_nome ? ` (${r.autorizado_por_nome})` : ''}`}
                    {r.situacao === 'concluido' && r.decidido_por && ` · aprovado por ${nomeCurto(nomes[r.decidido_por] ?? '—')}`}
                  </p>
                  {r.situacao === 'devolvido' && r.comentario_decisao && (
                    <p className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-800 ring-1 ring-rose-600/20">
                      Devolvido por {nomeCurto(nomes[r.decidido_por ?? ''] ?? 'gestor')}: {r.comentario_decisao}
                    </p>
                  )}

                  {(ehGestor || (r.pessoa_id === pessoaId && r.situacao === 'devolvido')) && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {r.pessoa_id === pessoaId && r.situacao === 'devolvido' && (
                        <button type="button" onClick={() => corrigir(r)} className={botaoSecundario}>Corrigir e reenviar</button>
                      )}
                      {ehGestor && r.situacao === 'aguardando' && devolvendo?.id !== r.id && (
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
                      {ehGestor && devolvendo?.id === r.id && (
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
