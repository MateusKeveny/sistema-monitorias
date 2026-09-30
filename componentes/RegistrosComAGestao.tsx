'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { ROTULO_PRIVADO, type RegistroPrivado } from '@/lib/diario';

const entrada = `w-full rounded-xl border border-slate-300 bg-superficie px-3 py-2 text-sm outline-none
                 focus:border-marca-600 disabled:opacity-50`;
const rotulo = 'mb-1 block text-xs font-medium text-slate-600';
const botaoPrimario = 'rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40';
const botaoSecundario = `rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm font-medium
                         text-slate-700 hover:bg-slate-50 disabled:opacity-40`;
const COR: Record<RegistroPrivado['situacao'], string> = {
  aguardando: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  aprovado: 'bg-marca-600/15 text-marca-700 dark:text-marca-400',
  devolvido: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');
const quando = (iso: string) => new Date(iso)
  .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).replace(',', '');

type Filtro = 'todos' | RegistroPrivado['situacao'];

/**
 * Registros com a gestão (1.32.0): o atendente registra algo que só ele e a
 * gestão (gestor e Pleno) veem. A RLS da migração 43 entrega a cada um só o
 * que pode ver; a tela não filtra por segurança, só por conveniência.
 */
export default function RegistrosComAGestao({
  registros, nomes, pessoaId, aprova,
}: {
  registros: RegistroPrivado[];
  nomes: Record<string, string>;
  pessoaId: string;
  /** Gestor ou Pleno: vê os de todos, aprova e devolve. */
  aprova: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState({ assunto: '', texto: '' });
  const [corrigindo, setCorrigindo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>(aprova ? 'aguardando' : 'todos');
  const [busca, setBusca] = useState('');
  const [devolvendo, setDevolvendo] = useState<{ id: string; texto: string } | null>(null);

  const aguardando = registros.filter((r) => r.situacao === 'aguardando').length;
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const lista = useMemo(() => registros.filter((r) => (filtro === 'todos' || r.situacao === filtro)
    && (!termo || [r.assunto, r.texto, nomes[r.pessoa_id] ?? ''].some((t) => t.toLocaleLowerCase('pt-BR').includes(termo)))),
  [registros, filtro, termo, nomes]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.assunto.trim() || !f.texto.trim()) { setErro('Preencha o assunto e o que aconteceu.'); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const campos = { assunto: f.assunto.trim(), texto: f.texto.trim() };
    const db = criarClienteNavegador();
    const { error } = corrigindo
      ? await db.from('diario_privados').update(campos).eq('id', corrigindo)
      : await db.from('diario_privados').insert(campos);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setAviso('Enviado para a gestão. Ele aparece como "Aguardando aprovação" até alguém da gestão ver.');
    setF({ assunto: '', texto: '' }); setCorrigindo(null);
    router.refresh();
  }

  async function decidir(id: string, aprovar: boolean, comentario: string) {
    setOcupado(true); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().rpc('decidir_registro_privado', {
      p_registro: id, p_aprovar: aprovar, p_comentario: comentario,
    });
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setDevolvendo(null);
    setAviso(aprovar ? 'Registro aprovado.' : 'Registro devolvido ao atendente.');
    router.refresh();
  }

  const avisos = (
    <>
      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}
    </>
  );

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      {aprova ? (
        <section className="rounded-[18px] bg-superficie px-6 py-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800">Como funciona</h2>
          <p className="mb-3 text-sm text-slate-500">Cada atendente registra aqui o que quer deixar só com a gestão.</p>
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            🔒 Cada registro é visível só para quem registrou, o gestor e o Pleno. Os outros atendentes não veem.
          </p>
          <p className="text-sm text-slate-600">
            <b>Aprovar</b> marca como ciente e mantém o registro privado. <b>Devolver</b> pede um ajuste ao atendente, com comentário.
          </p>
          <div className="mt-3 grid gap-2">{avisos}</div>
        </section>
      ) : (
        <section className="rounded-[18px] bg-superficie px-6 py-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800">{corrigindo ? 'Corrigir registro devolvido' : 'Novo registro com a gestão'}</h2>
          <p className="mb-3 text-sm text-slate-500">Algo que você quer deixar registrado só com a gestão.</p>
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">🔒 Só você, o gestor e o Pleno veem este registro.</p>
          <form onSubmit={enviar} className="grid gap-3">
            <label><span className={rotulo}>Assunto *</span>
              <input value={f.assunto} disabled={ocupado} className={entrada} placeholder="Em poucas palavras"
                     onChange={(e) => setF((s) => ({ ...s, assunto: e.target.value }))} /></label>
            <label><span className={rotulo}>O que aconteceu *</span>
              <textarea value={f.texto} disabled={ocupado} rows={5} className={`${entrada} resize-y leading-relaxed`}
                        onChange={(e) => setF((s) => ({ ...s, texto: e.target.value }))} /></label>
            {avisos}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-slate-500">Vai para a aprovação da gestão.</span>
              <span className="flex gap-2">
                {corrigindo && (
                  <button type="button" className={botaoSecundario}
                          onClick={() => { setCorrigindo(null); setF({ assunto: '', texto: '' }); }}>Cancelar</button>
                )}
                <button type="submit" disabled={ocupado || !f.assunto.trim() || !f.texto.trim()}
                        className="rounded-xl bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                  {ocupado ? 'Enviando…' : corrigindo ? 'Reenviar para a gestão' : 'Enviar para a gestão'}
                </button>
              </span>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-[18px] bg-superficie px-6 py-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{aprova ? 'Registros dos atendentes' : 'Meus registros'}</h2>
            <p className="text-sm text-slate-500">{aprova ? 'De toda a equipe, do mais recente ao mais antigo.' : 'Só você e a gestão veem esta lista.'}</p>
          </div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={aprova ? 'Buscar assunto ou pessoa…' : 'Buscar…'}
                 className="w-64 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-marca-600" />
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {([['todos', 'Todos'], ['aguardando', `Aguardando${aguardando ? ` · ${aguardando}` : ''}`],
            ['aprovado', 'Aprovados'], ['devolvido', 'Devolvidos']] as const).map(([k, r]) => (
            <button key={k} type="button" aria-pressed={filtro === k} onClick={() => setFiltro(k)}
                    className={`rounded-full border px-3 py-0.5 text-xs ${filtro === k
                      ? 'border-marca-600 bg-marca-600/10 text-marca-700 dark:text-marca-400'
                      : k === 'aguardando' && aguardando ? 'border-amber-500/50 text-amber-700 dark:text-amber-300'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
              {r}
            </button>
          ))}
        </div>

        {lista.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            {registros.length ? 'Nenhum registro neste filtro.' : aprova ? 'Nenhum registro dos atendentes ainda.' : 'Você ainda não registrou nada com a gestão.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lista.map((r) => (
              <li key={r.id} className="grid gap-1 py-3.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <b className="font-semibold text-slate-800">{r.assunto}</b>
                  <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${COR[r.situacao]}`}>{ROTULO_PRIVADO[r.situacao]}</span>
                </div>
                <p className="whitespace-pre-line text-sm text-slate-700">{r.texto}</p>
                <p className="text-xs text-slate-500">
                  {aprova && `${nomeCurto(nomes[r.pessoa_id] ?? '—')} · `}{quando(r.criado_em)}
                  {r.situacao === 'aprovado' && r.decidido_por && ` · aprovado por ${nomeCurto(nomes[r.decidido_por] ?? '—')}`}
                </p>
                {r.situacao === 'devolvido' && r.comentario_decisao && (
                  <p className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-800 ring-1 ring-rose-600/20">
                    Devolvido por {nomeCurto(nomes[r.decidido_por ?? ''] ?? 'gestão')}: {r.comentario_decisao}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {r.pessoa_id === pessoaId && r.situacao === 'devolvido' && !aprova && (
                    <button type="button" className={botaoSecundario}
                            onClick={() => { setCorrigindo(r.id); setF({ assunto: r.assunto, texto: r.texto }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                      Corrigir e reenviar
                    </button>
                  )}
                  {aprova && r.situacao === 'aguardando' && r.pessoa_id !== pessoaId && devolvendo?.id !== r.id && (
                    <>
                      <button type="button" disabled={ocupado} onClick={() => decidir(r.id, true, '')} className={botaoPrimario}>Aprovar</button>
                      <button type="button" disabled={ocupado} onClick={() => setDevolvendo({ id: r.id, texto: '' })} className={botaoSecundario}>Devolver</button>
                    </>
                  )}
                  {aprova && devolvendo?.id === r.id && (
                    <span className="flex w-full flex-wrap gap-2">
                      <input autoFocus value={devolvendo.texto} disabled={ocupado} placeholder="O que precisa ser corrigido?"
                             onChange={(e) => setDevolvendo({ id: r.id, texto: e.target.value })}
                             className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm outline-none focus:border-marca-600" />
                      <button type="button" disabled={ocupado || !devolvendo.texto.trim()}
                              onClick={() => decidir(r.id, false, devolvendo.texto)} className={botaoSecundario}>Devolver</button>
                      <button type="button" onClick={() => setDevolvendo(null)} className="text-sm text-slate-500 hover:underline">cancelar</button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
