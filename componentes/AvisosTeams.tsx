'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

export type SituacaoAviso = {
  chave: 'semana_encerrada' | 'monitorias_liberadas' | 'lembrete_fechamento' | 'diario_novidades';
  url: string | null;
  ultimo_envio: string | null;
  ultimo_titulo: string | null;
  status_http: number | null;
  erro: string | null;
};

const AVISOS: { chave: SituacaoAviso['chave']; titulo: string; quando: string }[] = [
  { chave: 'semana_encerrada', titulo: 'Semana encerrada e mês fechado',
    quando: 'Canal da equipe · às 8h do dia seguinte ao fim de cada semana do ciclo, e quando o gestor fecha o mês' },
  { chave: 'diario_novidades', titulo: 'Novidades do diário',
    quando: 'Canal da equipe · quando um processo novo ou treinamento é concluído no diário' },
  { chave: 'monitorias_liberadas', titulo: 'Monitorias liberadas',
    quando: 'Pleno e qualidade · quando o gestor importa o relatório de atendimentos' },
  { chave: 'lembrete_fechamento', titulo: 'Lembrete de fechamento',
    quando: 'Só o gestor · todo dia às 8h, depois do fim do ciclo, até o mês ser fechado' },
];

const entrada = `min-w-0 flex-1 rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 font-mono text-sm
                 outline-none focus:border-marca-600 disabled:opacity-50`;
const botaoPrimario = 'rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40';
const botaoSecundario = `rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm font-medium
                         text-slate-700 hover:bg-slate-50 disabled:opacity-40`;

/** O endereço funciona como senha: depois de salvo, só o começo e o fim. */
const encurtar = (url: string) => url.length > 60 ? `${url.slice(0, 42)}…${url.slice(-10)}` : url;
const quando = (iso: string) => new Date(iso)
  .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).replace(',', '');

/**
 * Avisos no Teams (1.30.0): para onde vai cada aviso (migração 40).
 *
 * Quem posta é o banco (pg_net); aqui o gestor só cola o endereço do Workflow
 * de cada destino e confere se chegou. O resultado da última chamada vem de
 * `situacao_dos_avisos`: 2xx é entregue, o resto é falha.
 */
export default function AvisosTeams({ situacao }: { situacao: SituacaoAviso[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const de = (chave: string) => situacao.find((s) => s.chave === chave);

  async function salvar(chave: string, url: string | null) {
    if (url && !/^https:\/\/\S+$/.test(url)) { setErro('Cole o endereço completo do Workflow, começando por https://'); return; }
    setOcupado(chave); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().from('avisos_teams')
      .update({ url, atualizado_em: new Date().toISOString() }).eq('chave', chave);
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    setEditando(({ [chave]: _, ...resto }) => resto);
    setAviso(url ? 'Endereço salvo. Use "Enviar teste" para conferir.' : 'Aviso desligado.');
    router.refresh();
  }

  async function testar(chave: string) {
    setOcupado(chave); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().rpc('testar_aviso_teams', { p_chave: chave });
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    setAviso('Teste enviado. Confira no Teams; a situação ao lado se atualiza em alguns segundos.');
    // A resposta do Teams chega depois: recarrega para mostrar se foi entregue.
    setTimeout(() => router.refresh(), 4000);
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <section className="rounded-[18px] bg-superficie px-6 py-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">Avisos no Teams</h2>
        <p className="mb-2 text-sm text-slate-500">Cole o endereço de um Workflow do Teams em cada aviso. Campo vazio desliga o aviso.</p>

        {AVISOS.map((a) => {
          const s = de(a.chave);
          const emEdicao = a.chave in editando || !s?.url;
          const entregue = s?.status_http != null && s.status_http >= 200 && s.status_http < 300;
          const falhou = s?.ultimo_envio && (s.erro || (s.status_http != null && !entregue));
          return (
            <div key={a.chave} className="grid gap-2 border-t border-slate-100 py-4 first-of-type:border-t-0">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-800">{a.titulo}</h3>
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${!s?.url ? 'bg-slate-100 text-slate-500'
                  : falhou ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                  : 'bg-marca-600/15 text-marca-700 dark:text-marca-400'}`}>
                  {!s?.url ? 'Desligado'
                    : !s.ultimo_envio ? 'Ativo · nada enviado ainda'
                    : falhou ? `Falhou em ${quando(s.ultimo_envio)}${s.status_http ? ` · resposta ${s.status_http}` : ''}`
                    : `Ativo · último envio ${quando(s.ultimo_envio)}${s.status_http == null ? ' (aguardando resposta)' : ''}`}
                </span>
              </div>
              <span className="text-xs text-slate-500">{a.quando}</span>
              {emEdicao ? (
                <div className="flex gap-2">
                  <input className={entrada} value={editando[a.chave] ?? ''} disabled={ocupado === a.chave}
                         onChange={(e) => setEditando((x) => ({ ...x, [a.chave]: e.target.value.trim() }))}
                         placeholder="Cole aqui o endereço do Workflow" />
                  <button type="button" className={botaoPrimario} disabled={ocupado === a.chave || !editando[a.chave]}
                          onClick={() => salvar(a.chave, editando[a.chave])}>Salvar</button>
                  {s?.url && (
                    <button type="button" className={botaoSecundario}
                            onClick={() => setEditando(({ [a.chave]: _, ...resto }) => resto)}>Cancelar</button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200">
                    {encurtar(s!.url!)}
                  </code>
                  <button type="button" className={botaoSecundario} disabled={ocupado !== null}
                          onClick={() => setEditando((x) => ({ ...x, [a.chave]: '' }))}>Trocar</button>
                  <button type="button" className={botaoSecundario} disabled={ocupado !== null}
                          onClick={() => testar(a.chave)}>{ocupado === a.chave ? 'Enviando…' : 'Enviar teste'}</button>
                  <button type="button" className="text-xs text-slate-400 hover:text-rose-700 hover:underline" disabled={ocupado !== null}
                          onClick={() => confirm(`Desligar o aviso "${a.titulo}"?`) && salvar(a.chave, null)}>desligar</button>
                </div>
              )}
              {s?.erro && <p className="text-xs text-rose-700 dark:text-rose-300">{s.erro}</p>}
            </div>
          );
        })}

        {erro && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
        {aviso && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}
        <p className="mt-3 text-xs text-slate-500">
          O endereço funciona como senha: quem o tiver consegue postar no destino. Ele fica guardado no banco, visível só
          para o gestor, e aparece encurtado depois de salvo.
        </p>
      </section>

      <section className="rounded-[18px] bg-superficie px-6 py-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">Como criar o endereço no Teams</h2>
        <p className="mb-3 text-sm text-slate-500">Uma vez para cada destino.</p>
        <ol className="grid list-decimal gap-1.5 pl-5 text-sm leading-relaxed text-slate-700">
          <li>No canal (ou chat) que vai receber o aviso, clique em <b>…</b> › <b>Fluxos de trabalho</b> e busque <b>webhook</b>.</li>
          <li>Escolha <b>&quot;Enviar alertas de webhook para um canal&quot;</b> (equipe) ou <b>&quot;… para um chat&quot;</b> (monitoria e lembrete).
            Não use os modelos &quot;de pessoas específicas&quot; ou &quot;de uma organização&quot;: eles exigem login e recusam o painel.</li>
          <li>Dê um nome, como <i>Painel de Performance</i>, confira o destino e clique em <b>Adicionar fluxo de trabalho</b>.</li>
          <li>Copie o endereço que aparece no fim e cole no aviso correspondente.</li>
          <li>Clique em <b>Enviar teste</b>: um cartão de teste deve chegar no destino.</li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">Se a busca não trouxer esses modelos, a TI precisa liberar o Power Automate no Teams.</p>
      </section>
    </div>
  );
}
