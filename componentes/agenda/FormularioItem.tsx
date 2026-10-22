'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';
import { CATEGORIAS, PRIORIDADES, type Categoria, type ItemAgenda, type Prioridade } from '@/lib/agenda/tipos';
import { descreverRegra, proximoDia } from '@/lib/agenda/regras';
import { diaDaSemana, hoje, horaLocal, diaLocal, instante, nomeCurtoDoDia } from '@/lib/agenda/tempo';

/** O que o formulário edita — vem de um item salvo ou da entrada rápida. */
export type Rascunho = {
  id?: string;
  titulo: string;
  dia: string | null;
  hora: string | null;
  /** Fim do compromisso ("das 14h às 16h"), opcional (agenda/05). */
  horaFim: string | null;
  regra: string | null;
  categoria: Categoria;
  prioridade: Prioridade;
  observacao: string | null;
};

export const rascunhoDoItem = (i: ItemAgenda): Rascunho => ({
  id: i.id, titulo: i.titulo, categoria: i.categoria, prioridade: i.prioridade, observacao: i.observacao,
  regra: i.regra,
  dia: i.vence_em ? diaLocal(i.vence_em) : null,
  hora: i.vence_em && !i.dia_inteiro ? horaLocal(i.vence_em) : null,
  horaFim: i.hora_fim ? i.hora_fim.slice(0, 5) : null,
});

type TipoRepeticao = '' | 'diaria' | 'dias_uteis' | 'semanal' | 'mensal_dia' | 'mensal:ultimo' | 'mensal:ultimo_util';

function separarRegra(regra: string | null): { tipo: TipoRepeticao; dias: number[]; diaDoMes: number | null } {
  if (!regra) return { tipo: '', dias: [], diaDoMes: null };
  if (regra === 'diaria' || regra === 'dias_uteis' || regra === 'mensal:ultimo' || regra === 'mensal:ultimo_util') {
    return { tipo: regra, dias: [], diaDoMes: null };
  }
  if (regra.startsWith('semanal:')) return { tipo: 'semanal', dias: regra.slice(8).split(',').map(Number), diaDoMes: null };
  return { tipo: 'mensal_dia', dias: [], diaDoMes: Number(regra.slice(7)) };
}

/** Salva o rascunho. Devolve a mensagem de erro, se houver. */
export async function salvarRascunho(r: Rascunho): Promise<string | null> {
  const titulo = r.titulo.trim();
  if (!titulo) return 'Escreva o que é para fazer.';
  let dia = r.dia;
  if (r.regra) {
    dia = proximoDia(r.regra, dia ?? hoje());
    if (!dia) return 'Essa repetição não cai em nenhum dia.';
  }
  const linha = {
    titulo,
    observacao: r.observacao?.trim() || null,
    categoria: r.categoria,
    prioridade: r.prioridade,
    regra: r.regra,
    vence_em: dia ? instante(dia, r.hora) : null,
    dia_inteiro: !!dia && !r.hora,
    // Só vale com hora de início e depois dela.
    hora_fim: r.hora && r.horaFim && r.horaFim > r.hora ? r.horaFim : null,
  };
  if (r.hora && r.horaFim && r.horaFim <= r.hora) return 'O fim precisa ser depois do início.';
  const db = criarClienteDaAgenda();
  const { error } = r.id
    ? await db.from('agenda_itens').update(linha).eq('id', r.id)
    : await db.from('agenda_itens').insert(linha);
  return error ? `Não foi possível salvar: ${error.message}` : null;
}

/**
 * Formulário completo de um lembrete, numa janela por cima da tela (no
 * celular, encaixada embaixo). Serve para criar e para editar.
 */
export default function FormularioItem({ inicial, aoFechar }: { inicial: Rascunho; aoFechar: (salvo?: boolean) => void }) {
  const router = useRouter();
  const janela = useRef<HTMLDialogElement>(null);
  const [r, setR] = useState<Rascunho>(inicial);
  const separada = separarRegra(inicial.regra);
  const [tipo, setTipo] = useState<TipoRepeticao>(separada.tipo);
  const [diasSemana, setDiasSemana] = useState<number[]>(
    separada.dias.length ? separada.dias : [diaDaSemana(inicial.dia ?? hoje())]);
  const [diaDoMes, setDiaDoMes] = useState<number>(separada.diaDoMes ?? Number((inicial.dia ?? hoje()).slice(8, 10)));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { janela.current?.showModal(); }, []);

  const regra = tipo === '' ? null
    : tipo === 'semanal' ? (diasSemana.length ? `semanal:${[...diasSemana].sort().join(',')}` : null)
    : tipo === 'mensal_dia' ? `mensal:${diaDoMes}`
    : tipo;

  const mudar = <K extends keyof Rascunho>(campo: K, valor: Rascunho[K]) => setR((x) => ({ ...x, [campo]: valor }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (tipo === 'semanal' && !diasSemana.length) { setErro('Escolha ao menos um dia da semana.'); return; }
    setSalvando(true);
    const falha = await salvarRascunho({ ...r, regra });
    setSalvando(false);
    if (falha) { setErro(falha); return; }
    aoFechar(true);
    router.refresh();
  }

  async function excluir() {
    if (!r.id || !confirm(inicial.regra
      ? 'Excluir este lembrete e todas as próximas repetições? Não dá para desfazer.'
      : 'Excluir este lembrete? Não dá para desfazer.')) return;
    const { error } = await criarClienteDaAgenda().from('agenda_itens').delete().eq('id', r.id);
    if (error) { setErro(error.message); return; }
    aoFechar(true);
    router.refresh();
  }

  const campo = 'w-full rounded-lg border border-slate-300 bg-superficie px-3 py-2 text-sm text-slate-900 focus:border-marca-600 focus:outline-none focus:ring-2 focus:ring-marca-600/20';
  const rotulo = 'mb-1 block text-xs font-medium text-slate-600';

  return (
    <dialog ref={janela} onClose={() => aoFechar()}
            className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-superficie p-0 text-slate-900 shadow-xl backdrop:bg-black/40
                       sm:m-auto sm:max-w-lg sm:rounded-2xl">
      <form onSubmit={salvar} className="max-h-[88vh] space-y-4 overflow-y-auto p-5 sm:p-6">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{r.id ? 'Editar lembrete' : 'Novo lembrete'}</h2>
          <button type="button" onClick={() => janela.current?.close()} aria-label="Fechar"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </header>

        <div>
          <label className={rotulo} htmlFor="titulo">O que fazer</label>
          <input id="titulo" className={campo} value={r.titulo} maxLength={200} autoFocus
                 onChange={(e) => mudar('titulo', e.target.value)} />
        </div>

        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
          <div>
            <label className={rotulo} htmlFor="dia">{regra ? 'A partir de' : 'Dia'}</label>
            <input id="dia" type="date" className={campo} value={r.dia ?? ''}
                   onChange={(e) => mudar('dia', e.target.value || null)} />
          </div>
          <div>
            <label className={rotulo} htmlFor="hora">Das <span className="font-normal text-slate-400">(opc.)</span></label>
            <input id="hora" type="time" className={campo} value={r.hora ?? ''}
                   onChange={(e) => mudar('hora', e.target.value || null)} />
          </div>
          <div>
            <label className={rotulo} htmlFor="horaFim">Até <span className="font-normal text-slate-400">(opc.)</span></label>
            <input id="horaFim" type="time" className={campo} value={r.horaFim ?? ''} disabled={!r.hora}
                   onChange={(e) => mudar('horaFim', e.target.value || null)} />
          </div>
        </div>
        {!r.hora && (r.dia || regra) && (
          <p className="-mt-2 text-xs text-slate-500">Sem hora, ele não toca sozinho: aparece no resumo do dia.</p>
        )}

        <div>
          <label className={rotulo} htmlFor="repete">Repetir</label>
          <select id="repete" className={campo} value={tipo} onChange={(e) => setTipo(e.target.value as TipoRepeticao)}>
            <option value="">Não repete</option>
            <option value="diaria">Todo dia</option>
            <option value="dias_uteis">Dias úteis (segunda a sexta)</option>
            <option value="semanal">Toda semana…</option>
            <option value="mensal_dia">Todo mês, num dia…</option>
            <option value="mensal:ultimo">Último dia do mês</option>
            <option value="mensal:ultimo_util">Último dia útil do mês</option>
          </select>
          {tipo === 'semanal' && (
            <div className="mt-2 grid grid-cols-7 gap-1">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                const marcado = diasSemana.includes(d);
                return (
                  <button key={d} type="button" aria-pressed={marcado}
                          onClick={() => setDiasSemana((l) => (marcado ? l.filter((x) => x !== d) : [...l, d]))}
                          className={`h-9 rounded-lg border text-sm font-medium ${marcado
                            ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                    {nomeCurtoDoDia(d)}
                  </button>
                );
              })}
            </div>
          )}
          {tipo === 'mensal_dia' && (
            <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
              Dia
              <input type="number" min={1} max={31} className={`${campo} w-20`} value={diaDoMes}
                     onChange={(e) => setDiaDoMes(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
              <span className="text-xs text-slate-500">(em mês mais curto, cai no último dia)</span>
            </div>
          )}
          {regra && <p className="mt-1.5 text-xs text-marca-700 dark:text-marca-400">{descreverRegra(regra)}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={rotulo} htmlFor="categoria">Assunto</label>
            <select id="categoria" className={campo} value={r.categoria}
                    onChange={(e) => mudar('categoria', e.target.value as Categoria)}>
              {CATEGORIAS.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
            </select>
          </div>
          <div>
            <label className={rotulo} htmlFor="prioridade">Prioridade</label>
            <select id="prioridade" className={campo} value={r.prioridade}
                    onChange={(e) => mudar('prioridade', Number(e.target.value) as Prioridade)}>
              {PRIORIDADES.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={rotulo} htmlFor="obs">Observação <span className="font-normal text-slate-400">(aparece na notificação)</span></label>
          <textarea id="obs" rows={2} maxLength={2000} className={campo} value={r.observacao ?? ''}
                    onChange={(e) => mudar('observacao', e.target.value)} />
        </div>

        {erro && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{erro}</p>}

        <footer className="flex items-center gap-2 pt-1">
          {r.id && (
            <button type="button" onClick={excluir}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50">
              Excluir
            </button>
          )}
          <button type="button" onClick={() => janela.current?.close()}
                  className="ml-auto rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancelar
          </button>
          <button type="submit" disabled={salvando}
                  className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-60">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
