'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import FormularioItem, { rascunhoDoItem } from '@/componentes/agenda/FormularioItem';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';
import { descreverRegra } from '@/lib/agenda/regras';
import { diaDaSemana, diaLocal, hoje, instante, somarDias } from '@/lib/agenda/tempo';
import { categoria, type ItemAgenda, type Pendencia } from '@/lib/agenda/tipos';
import { ENDERECO_PERFORMANCE } from '@/lib/sistema';

export type Linha =
  | { tipo: 'item'; chave: string; item: ItemAgenda; motivo?: string; tom?: 'atrasado' | 'agora' | 'normal';
      /** Repetição futura, só para ver: quem se conclui é a ocorrência real. */
      projetada?: boolean; numero?: number }
  | { tipo: 'pendencia'; chave: string; pendencia: Pendencia; motivo: string; tom?: 'atrasado' | 'normal'; numero?: number };

export type Grupo = { titulo: string; subtitulo?: string; linhas: Linha[]; vazio?: string };

const TOM: Record<string, string> = {
  atrasado: 'text-rose-700',
  agora: 'text-amber-700',
  normal: 'text-slate-500',
};

/**
 * As listas da agenda, com o que se faz em cada linha: concluir (com
 * "Desfazer" por alguns segundos), adiar, editar e abrir a pendência no
 * Performance.
 */
export default function ListaDaAgenda({ grupos, abrir = null }: {
  grupos: Grupo[];
  /** Lembrete para abrir já no formulário (?reagendar=<id>, vindo da notificação). */
  abrir?: ItemAgenda | null;
}) {
  const router = useRouter();
  const [escondidos, setEscondidos] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<{ texto: string; desfazer?: string } | null>(null);
  const [editando, setEditando] = useState<ItemAgenda | null>(abrir);
  const relogio = useRef<ReturnType<typeof setTimeout>>(undefined);

  // A lista nova do servidor substitui o que estava escondido de antemão.
  useEffect(() => { setEscondidos(new Set()); }, [grupos]);

  const avisar = (texto: string, desfazer?: string) => {
    clearTimeout(relogio.current);
    setAviso({ texto, desfazer });
    relogio.current = setTimeout(() => setAviso(null), 6000);
  };

  async function concluir(item: ItemAgenda) {
    setEscondidos((s) => new Set(s).add(item.id));
    const { data, error } = await criarClienteDaAgenda().rpc('agenda_concluir', { p_item: item.id });
    if (error) {
      setEscondidos((s) => { const n = new Set(s); n.delete(item.id); return n; });
      avisar(`Não foi possível concluir: ${error.message}`);
      return;
    }
    avisar(item.regra ? `Feito. Próxima: ${descreverRegra(item.regra)?.toLowerCase()}` : 'Concluído', data as string);
    router.refresh();
  }

  async function desfazer(id: string) {
    setAviso(null);
    const { error } = await criarClienteDaAgenda().rpc('agenda_desfazer', { p_concluido: id });
    if (error) avisar(`Não foi possível desfazer: ${error.message}`);
    router.refresh();
  }

  async function adiar(item: ItemAgenda, para: string, rotulo: string) {
    setEscondidos((s) => new Set(s).add(item.id));
    const { error } = await criarClienteDaAgenda().from('agenda_itens').update({ lembrar_em: para }).eq('id', item.id);
    if (error) avisar(`Não foi possível adiar: ${error.message}`);
    else avisar(`Adiado para ${rotulo}`);
    router.refresh();
  }

  // No recorrente, apaga a série: as repetições projetadas são o mesmo item.
  async function excluir(item: ItemAgenda) {
    const pergunta = item.regra
      ? `Excluir "${item.titulo}" e todas as próximas repetições? Não dá para desfazer.`
      : `Excluir "${item.titulo}"? Não dá para desfazer.`;
    if (!confirm(pergunta)) return;
    setEscondidos((s) => new Set(s).add(item.id));
    const { error } = await criarClienteDaAgenda().from('agenda_itens').delete().eq('id', item.id);
    if (error) avisar(`Não foi possível excluir: ${error.message}`);
    else avisar(item.regra ? 'Repetição excluída' : 'Excluído');
    router.refresh();
  }

  return (
    <>
      {grupos.map((g) => {
        const linhas = g.linhas.filter((l) => !(l.tipo === 'item' && !l.projetada && escondidos.has(l.item.id)));
        if (!linhas.length && !g.vazio) return null;
        return (
          <section key={g.titulo} className="px-4 py-5 sm:px-6">
            <header className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-800">{g.titulo}</h2>
              {g.subtitulo && <span className="text-xs text-slate-500">{g.subtitulo}</span>}
            </header>
            {!linhas.length ? (
              <p className="py-3 text-sm text-slate-500">{g.vazio}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {linhas.map((l) => l.tipo === 'pendencia'
                  ? <LinhaPendencia key={l.chave} linha={l} />
                  : <LinhaItem key={`${l.chave}:${l.projetada ? 'p' : 'r'}`} linha={l} aoConcluir={concluir}
                               aoAdiar={adiar} aoExcluir={excluir} aoEditar={setEditando} />)}
              </ul>
            )}
          </section>
        );
      })}

      {aviso && (
        <div role="status"
             className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-slate-900 px-4 py-3
                        text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900 lg:bottom-6">
          <span className="flex-1">{aviso.texto}</span>
          {aviso.desfazer && (
            <button onClick={() => desfazer(aviso.desfazer!)} className="font-semibold text-marca-400 dark:text-marca-700">
              Desfazer
            </button>
          )}
        </div>
      )}

      {editando && <FormularioItem inicial={rascunhoDoItem(editando)} aoFechar={() => {
        setEditando(null);
        // Tira o ?reagendar= do endereço, para não reabrir ao atualizar a tela.
        if (location.search.includes('reagendar=')) history.replaceState(null, '', location.pathname);
      }} />}
    </>
  );
}

function LinhaPendencia({ linha }: { linha: Extract<Linha, { tipo: 'pendencia' }> }) {
  const p = linha.pendencia;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Numero n={linha.numero} />
      <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${p.grave ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10 6v5M10 14h.01" /><circle cx="10" cy="10" r="7" /></svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-800">{p.texto}</p>
        <p className={`text-xs ${TOM[linha.tom ?? 'normal']}`}>{linha.motivo}</p>
      </div>
      <a href={p.href.startsWith('/agenda') ? p.href : `${ENDERECO_PERFORMANCE}${p.href}`}
         {...(p.href.startsWith('/agenda') ? {} : { target: '_blank', rel: 'noopener' })}
         className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
        {p.acao}{p.href.startsWith('/agenda') ? '' : ' ↗'}
      </a>
    </li>
  );
}

function Numero({ n }: { n?: number }) {
  if (n == null) return null;
  return <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-400">{n}</span>;
}

function LinhaItem({ linha, aoConcluir, aoAdiar, aoExcluir, aoEditar }: {
  linha: Extract<Linha, { tipo: 'item' }>;
  aoConcluir: (i: ItemAgenda) => void;
  aoAdiar: (i: ItemAgenda, para: string, rotulo: string) => void;
  aoExcluir: (i: ItemAgenda) => void;
  aoEditar: (i: ItemAgenda) => void;
}) {
  const { item, projetada } = linha;
  const cat = categoria(item.categoria);
  const regra = descreverRegra(item.regra);

  return (
    <li className={`flex items-start gap-3 py-2.5 ${projetada ? 'opacity-60' : ''}`}>
      <Numero n={linha.numero} />
      {projetada ? (
        <span aria-label="Repetição" title="Repetição — conclua a ocorrência atual"
              className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-slate-300 text-slate-400">
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9a6 6 0 0 1 10.5-3.5L16 7M16 3.5V7h-3.5M16 11a6 6 0 0 1-10.5 3.5L4 13M4 16.5V13h3.5" /></svg>
        </span>
      ) : (
        <button onClick={() => aoConcluir(item)} aria-label={`Concluir: ${item.titulo}`}
                className={`group mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors
                            ${item.prioridade === 1 ? 'border-rose-400' : 'border-slate-300'} hover:border-marca-600 hover:bg-marca-50`}>
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-marca-600 opacity-0 group-hover:opacity-100" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 10.5 3.2 3.2L15 6.5" /></svg>
        </button>
      )}

      <button onClick={() => aoEditar(item)} className="min-w-0 flex-1 text-left">
        <p className="text-sm font-medium text-slate-900">{item.titulo}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {linha.motivo && <span className={TOM[linha.tom ?? 'normal']}>{linha.motivo}</span>}
          {item.categoria !== 'geral' && <span className={`rounded px-1.5 py-px font-medium ${cat.cor}`}>{cat.rotulo}</span>}
          {regra && <span className="text-slate-500">↻ {regra}</span>}
        </p>
        {item.observacao && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.observacao}</p>}
      </button>

      <MenuDoItem item={item} aoAdiar={aoAdiar} aoExcluir={aoExcluir} podeAdiar={!projetada && !!item.lembrar_em} />
    </li>
  );
}

/** As opções de adiar, conforme o item tenha hora ou seja do dia inteiro. */
function opcoesDeAdiar(item: ItemAgenda): { rotulo: string; para: string }[] {
  const agora = Date.now();
  const d = hoje();
  const amanha = somarDias(d, 1);
  const segunda = somarDias(d, 8 - diaDaSemana(d));
  if (item.dia_inteiro) {
    return [
      { rotulo: 'amanhã', para: instante(amanha) },
      { rotulo: 'segunda', para: instante(segunda) },
      { rotulo: 'daqui a uma semana', para: instante(somarDias(diaLocal(item.lembrar_em!) > d ? diaLocal(item.lembrar_em!) : d, 7)) },
    ];
  }
  return [
    { rotulo: '15 minutos', para: new Date(agora + 15 * 60_000).toISOString() },
    { rotulo: '1 hora', para: new Date(agora + 60 * 60_000).toISOString() },
    { rotulo: 'amanhã às 9h', para: instante(amanha, '09:00') },
    { rotulo: 'segunda às 9h', para: instante(segunda, '09:00') },
  ];
}

/** O menu ⋯ da linha: adiar (quando tem data) e excluir — no recorrente, a série toda. */
function MenuDoItem({ item, aoAdiar, aoExcluir, podeAdiar }: {
  item: ItemAgenda;
  aoAdiar: (i: ItemAgenda, para: string, rotulo: string) => void;
  aoExcluir: (i: ItemAgenda) => void;
  podeAdiar: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  return (
    <div ref={caixa} className="relative shrink-0">
      <button onClick={() => setAberto((a) => !a)} aria-label="Mais opções" aria-expanded={aberto}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor"><circle cx="4.5" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="15.5" cy="10" r="1.5" /></svg>
      </button>
      {aberto && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-slate-200 bg-superficie p-1 shadow-lg">
          {podeAdiar && (
            <>
              <p className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Adiar para</p>
              {opcoesDeAdiar(item).map((o) => (
                <button key={o.rotulo} onClick={() => { setAberto(false); aoAdiar(item, o.para, o.rotulo); }}
                        className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50">
                  {o.rotulo.replace(/^./, (c) => c.toUpperCase())}
                </button>
              ))}
              <div className="my-1 border-t border-slate-100" />
            </>
          )}
          <button onClick={() => { setAberto(false); aoExcluir(item); }}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm font-medium text-rose-700 hover:bg-rose-50">
            {item.regra ? 'Excluir repetição' : 'Excluir'}
          </button>
        </div>
      )}
    </div>
  );
}
