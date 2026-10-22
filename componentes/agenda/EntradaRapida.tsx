'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import FormularioItem, { salvarRascunho, type Rascunho } from '@/componentes/agenda/FormularioItem';
import { interpretar } from '@/lib/agenda/interprete';
import { descreverRegra } from '@/lib/agenda/regras';
import { rotuloDoDia } from '@/lib/agenda/tempo';
import { categoria } from '@/lib/agenda/tipos';

const EXEMPLOS = [
  'sexta às 10 cobrar o relatório da equipe',
  'todo dia 5 conferir o pagamento',
  'toda segunda 9h alinhamento com o time',
  'amanhã de manhã revisar monitorias',
];

/**
 * A entrada do assistente: escreve-se do jeito que se fala, e a leitura
 * aparece embaixo enquanto se digita (dia, hora, repetição, assunto). Enter
 * salva; "Ajustar" abre o formulário completo já preenchido.
 */
export default function EntradaRapida({ focar = false }: { focar?: boolean }) {
  const router = useRouter();
  const campo = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<Rascunho | null>(null);
  const [exemplo, setExemplo] = useState(0);

  useEffect(() => { if (focar) campo.current?.focus(); }, [focar]);
  useEffect(() => {
    const t = setInterval(() => setExemplo((n) => (n + 1) % EXEMPLOS.length), 4000);
    return () => clearInterval(t);
  }, []);

  const leitura = useMemo(() => (texto.trim() ? interpretar(texto) : null), [texto]);
  const rascunho = (): Rascunho | null => leitura && { ...leitura, observacao: null };

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const r = rascunho();
    if (!r || !r.titulo) return;
    setSalvando(true);
    setErro(null);
    const falha = await salvarRascunho(r);
    setSalvando(false);
    if (falha) { setErro(falha); return; }
    setTexto('');
    router.refresh();
  }

  const fichas = leitura ? [
    leitura.dia ? rotuloDoDia(leitura.dia) : 'Sem data',
    leitura.hora ? (leitura.horaFim ? `${leitura.hora}–${leitura.horaFim}` : leitura.hora) : (leitura.dia ? 'Dia inteiro' : null),
    descreverRegra(leitura.regra),
    leitura.categoria !== 'geral' ? categoria(leitura.categoria).rotulo : null,
    leitura.prioridade === 1 ? 'Prioridade alta' : leitura.prioridade === 3 ? 'Prioridade baixa' : null,
  ].filter(Boolean) as string[] : [];

  return (
    <div>
      <form onSubmit={salvar} className="flex gap-2">
        <label htmlFor="entrada-rapida" className="sr-only">Novo lembrete</label>
        <input
          id="entrada-rapida" ref={campo} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder={`Ex.: ${EXEMPLOS[exemplo]}`} autoComplete="off" enterKeyHint="done"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-superficie px-4 py-3 text-[15px] text-slate-900
                     shadow-sm placeholder:text-slate-400 focus:border-marca-600 focus:outline-none focus:ring-2 focus:ring-marca-600/20"
        />
        <button type="submit" disabled={!leitura?.titulo || salvando} aria-label="Adicionar"
                className="shrink-0 rounded-xl bg-marca-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-marca-700 disabled:opacity-50">
          <span className="hidden sm:inline">{salvando ? 'Salvando…' : 'Adicionar'}</span>
          <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5 sm:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4v12M4 10h12" /></svg>
        </button>
      </form>

      {leitura && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 text-xs">
          <span className="font-medium text-slate-700">{leitura.titulo || '…'}</span>
          {fichas.map((f) => (
            <span key={f} className="rounded-full bg-marca-50 px-2 py-0.5 font-medium text-marca-700 dark:text-marca-400">{f}</span>
          ))}
          <button type="button" onClick={() => setFormulario(rascunho())}
                  className="ml-auto rounded-md px-1.5 py-0.5 font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">
            Ajustar
          </button>
        </div>
      )}
      {!leitura && (
        <button type="button"
                onClick={() => setFormulario({ titulo: '', dia: null, hora: null, horaFim: null, regra: null, categoria: 'geral', prioridade: 2, observacao: null })}
                className="mt-2 px-1 text-xs font-medium text-slate-500 hover:text-slate-800">
          ou preencher o formulário completo
        </button>
      )}
      {erro && <p role="alert" className="mt-2 text-sm text-rose-700">{erro}</p>}

      {formulario && (
        <FormularioItem inicial={formulario} aoFechar={(salvo) => { setFormulario(null); if (salvo) setTexto(''); }} />
      )}
    </div>
  );
}
