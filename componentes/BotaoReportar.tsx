'use client';

import { useEffect, useRef, useState } from 'react';
import Link from '@/componentes/Link';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

const TIPOS_DE_PRINT = ['image/png', 'image/jpeg', 'image/webp'];
const LIMITE_DO_PRINT = 5 * 1024 * 1024;

const entrada = `w-full rounded-xl border border-slate-300 bg-superficie px-3 py-2 text-sm outline-none
                 focus:border-marca-600 disabled:opacity-50`;
const rotulo = 'mb-1 block text-xs font-medium text-slate-600';

/** "Chrome 141 · Windows · 1920×1080": o bastante para reproduzir o problema. */
function descreverNavegador() {
  const ua = navigator.userAgent;
  const nav = /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}`
    : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}`
    : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`
    : /Safari\//.test(ua) ? 'Safari' : 'Outro navegador';
  const so = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'outro sistema';
  return `${nav} · ${so} · ${window.innerWidth}×${window.innerHeight}`;
}

/**
 * Reportar problema (1.33.0): o botão do menu nos dois sites e o formulário.
 *
 * O report leva sozinho a tela, a versão e o navegador. O print é opcional —
 * colado com Ctrl+V em qualquer lugar da janela ou escolhido do computador — e
 * vai para o bucket privado "reportes", na pasta da pessoa (migração 44).
 */
export default function BotaoReportar({
  sistema, versao, pessoaId, ehGestor, avisos = 0, variante = 'lateral',
}: {
  sistema: 'performance' | 'monitorias';
  versao: string;
  pessoaId: string;
  ehGestor: boolean;
  /** Respostas novas (autor) ou reports novos (gestor): o ponto no botão. */
  avisos?: number;
  variante?: 'lateral' | 'topo';
}) {
  const [aberto, setAberto] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [esperado, setEsperado] = useState('');
  const [print, setPrint] = useState<File | null>(null);
  const [miniatura, setMiniatura] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<number | null>(null);
  const [contexto, setContexto] = useState({ tela: '', navegador: '' });
  const arquivo = useRef<HTMLInputElement>(null);

  function abrir() {
    setContexto({ tela: window.location.pathname + window.location.search, navegador: descreverNavegador() });
    setAberto(true); setEnviado(null); setErro(null);
  }

  function fechar() {
    setAberto(false); setDescricao(''); setEsperado(''); escolherPrint(null);
  }

  function escolherPrint(f: File | null) {
    if (f && !TIPOS_DE_PRINT.includes(f.type)) { setErro('O print precisa ser uma imagem PNG, JPG ou WEBP.'); return; }
    if (f && f.size > LIMITE_DO_PRINT) { setErro('O print passa de 5 MB. Recorte só a parte do problema.'); return; }
    setErro(null);
    setPrint(f);
    setMiniatura((antiga) => { if (antiga) URL.revokeObjectURL(antiga); return f ? URL.createObjectURL(f) : null; });
  }

  // Ctrl+V com um print na área de transferência, em qualquer lugar da janela.
  useEffect(() => {
    if (!aberto) return;
    const colar = (e: ClipboardEvent) => {
      const img = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
      if (img) { e.preventDefault(); escolherPrint(img); }
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ocupado) fechar(); };
    window.addEventListener('paste', colar);
    window.addEventListener('keydown', tecla);
    return () => { window.removeEventListener('paste', colar); window.removeEventListener('keydown', tecla); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, ocupado]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!descricao.trim()) { setErro('Conte o que aconteceu.'); return; }
    setOcupado(true); setErro(null);
    const db = criarClienteNavegador();

    let printPath: string | null = null;
    if (print) {
      const ext = print.type === 'image/png' ? 'png' : print.type === 'image/webp' ? 'webp' : 'jpg';
      printPath = `${pessoaId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await db.storage.from('reportes').upload(printPath, print, { contentType: print.type });
      if (error) { setOcupado(false); setErro(`O print não subiu: ${error.message}`); return; }
    }

    const { data, error } = await db.from('reportes').insert({
      sistema, tela: contexto.tela, versao: `${sistema === 'performance' ? 'Performance' : 'Monitorias'} ${versao}`,
      navegador: contexto.navegador, descricao: descricao.trim(), esperado: esperado.trim() || null, print_path: printPath,
    }).select('id').single();
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setEnviado(data.id as number);
    setDescricao(''); setEsperado(''); escolherPrint(null);
  }

  const botao = variante === 'lateral'
    ? 'relative flex w-full items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50'
    : 'relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50';

  return (
    <>
      <button type="button" onClick={abrir} className={botao}
              title={avisos ? (ehGestor ? `${avisos} report(s) novo(s)` : `${avisos} resposta(s) nova(s)`) : undefined}>
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"
             strokeLinecap="round" strokeLinejoin="round"><path d="M5 17V3.5M5 4h9l-2 3.5 2 3.5H5" /></svg>
        Reportar problema
        {avisos > 0 && (
          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-xs font-bold text-white">
            {avisos}
          </span>
        )}
      </button>

      {aberto && (
        <div role="dialog" aria-modal="true" aria-labelledby="titulo-reporte"
             className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4"
             onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) fechar(); }}>
          <div className="w-full max-w-xl rounded-2xl bg-superficie p-6 text-left shadow-2xl">
            <h2 id="titulo-reporte" className="text-lg font-semibold text-slate-900">Reportar um problema</h2>

            {enviado ? (
              <div className="mt-3 grid gap-4">
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
                  Report <b>#{enviado}</b> enviado. {ehGestor ? '' : 'A gestão responde por aqui; acompanhe em "Meus reports".'}
                </p>
                <div className="flex justify-end gap-2">
                  <Link href="/reportes" onClick={fechar}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    {ehGestor ? 'Ver os reports' : 'Ver meus reports'}
                  </Link>
                  <button type="button" onClick={fechar} className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700">Fechar</button>
                </div>
              </div>
            ) : (
              <form onSubmit={enviar} className="mt-1 grid gap-3">
                <p className="text-sm text-slate-500">Conte o que aconteceu. A gestão responde por aqui.</p>
                <label><span className={rotulo}>O que aconteceu? *</span>
                  <textarea autoFocus value={descricao} onChange={(e) => setDescricao(e.target.value)} disabled={ocupado} rows={4}
                            className={`${entrada} resize-y leading-relaxed`} placeholder="Ex.: o total da semana 2 aparece zerado no extrato." /></label>
                <label><span className={rotulo}>O que você esperava? (opcional)</span>
                  <input value={esperado} onChange={(e) => setEsperado(e.target.value)} disabled={ocupado} className={entrada} /></label>

                <div>
                  <span className={rotulo}>Print (opcional)</span>
                  {print && miniatura ? (
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={miniatura} alt="Print anexado" className="h-16 w-28 rounded-lg object-cover" />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{print.name || 'print colado'} · {Math.round(print.size / 1024)} KB</span>
                      <button type="button" onClick={() => escolherPrint(null)} disabled={ocupado}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Remover</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => arquivo.current?.click()} disabled={ocupado}
                            className="w-full rounded-xl border-2 border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500 hover:border-slate-400">
                      Cole com <b>Ctrl+V</b> ou clique para escolher a imagem
                    </button>
                  )}
                  <input ref={arquivo} type="file" accept={TIPOS_DE_PRINT.join(',')} hidden
                         onChange={(e) => { escolherPrint(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  <p className="mt-1 text-xs text-slate-500">Dica: <b>Win+Shift+S</b> tira o print; depois é só Ctrl+V aqui.</p>
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <dt className="font-semibold">Tela</dt><dd className="truncate">{contexto.tela}</dd>
                  <dt className="font-semibold">Versão</dt><dd>{sistema === 'performance' ? 'Performance' : 'Monitorias'} {versao}</dd>
                  <dt className="font-semibold">Navegador</dt><dd>{contexto.navegador}</dd>
                </dl>

                {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link href="/reportes" onClick={fechar} className="text-sm text-marca-700 hover:underline dark:text-marca-400">
                    {ehGestor ? 'Ver os reports' : 'Ver meus reports'}
                  </Link>
                  <span className="flex gap-2">
                    <button type="button" onClick={fechar} disabled={ocupado}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                    <button type="submit" disabled={ocupado || !descricao.trim()}
                            className="rounded-lg bg-marca-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                      {ocupado ? 'Enviando…' : 'Enviar report'}
                    </button>
                  </span>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
