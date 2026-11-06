'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import {
  aplicarPlano, cargoBase, formatarValor, gradeDoArquivo, gradeDoTexto, modeloXlsx, planejar, valorAtual,
  ROTULO_MEDIA, ROTULO_META, type ContextoMetas, type Item, type Plano,
} from '@/lib/metasPorLista';

const botao = 'rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-40';

/** Baixa um arquivo gerado no navegador. */
export function baixarArquivo(bytes: Uint8Array, nome: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const nomeDoArquivo = (setor: string) =>
  `metas-${setor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.xlsx`;

/**
 * Metas e pesos por lista (4.0.0): baixar o modelo .xlsx com os valores de
 * hoje, editar no Excel e subir de volta (ou colar as células). Nada é gravado
 * antes da conferência "de → para", com motivo obrigatório para o histórico.
 */
export default function MetasPorLista({ setorId, setorNome, ctx }: {
  setorId: number; setorNome: string; ctx: ContextoMetas;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [motivo, setMotivo] = useState('');
  const [sobre, setSobre] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  async function lerArquivo(f: File) {
    setErro(null); setFeito(null);
    try { setPlano(planejar(await gradeDoArquivo(f), ctx)); }
    catch { setErro('Não consegui ler esta planilha. Salve como .xlsx no Excel e tente de novo.'); }
  }
  function lerTexto(t: string) { if (t.trim()) { setErro(null); setFeito(null); setPlano(planejar(gradeDoTexto(t), ctx)); } }

  async function aplicar() {
    if (!plano) return;
    if (!motivo.trim()) { setErro('Escreva o motivo da alteração: ele vai para o histórico.'); return; }
    const novos = plano.colunas.filter((c) => c.id == null && !c.erros.length).length;
    if (!confirm(`Aplicar ${plano.mudancas.length} alteração(ões)${novos ? ` e criar ${novos} cargo(s)` : ''} em ${setorNome}?\n\nOs meses em aberto são recalculados; os fechados não mudam.`)) return;
    setOcupado(true); setErro(null);
    try {
      const r = await aplicarPlano(criarClienteNavegador(), plano, ctx, setorId, motivo.trim());
      if (r.falhas.length) setErro(`Parte não foi gravada: ${r.falhas.join('; ')}`);
      setFeito(`${r.alteracoes} alteração(ões) gravada(s)${r.cargosNovos ? ` e ${r.cargosNovos} cargo(s) criado(s)` : ''}. Está no histórico de pesos.`);
      setPlano(null); setMotivo('');
      router.refresh();
    } catch (e) {
      setErro(await mensagemDoErro(e as Error));
    } finally { setOcupado(false); }
  }

  const nMud = plano?.mudancas.length ?? 0;
  const colunasOk = plano?.colunas ?? [];
  const nNovos = colunasOk.filter((c) => c.id == null && !c.erros.length).length;
  const nErros = colunasOk.filter((c) => c.erros.length).length;
  const base = cargoBase(ctx);
  const itens: { item: Item; rotulo: string }[] = [
    { item: 'meta', rotulo: ROTULO_META }, { item: 'media', rotulo: ROTULO_MEDIA },
    ...ctx.metricas.map((m) => ({ item: m.chave, rotulo: m.rotulo })),
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-superficie px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Metas e pesos por lista</h3>
          <p className="text-sm text-slate-500">
            Todos de uma vez: baixe o modelo com os valores de hoje, ajuste no Excel e suba de volta.
            Uma linha por métrica, uma coluna por cargo — como a tabela abaixo.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={`${botao} border border-slate-300 text-slate-700 hover:bg-slate-50`}
                  onClick={() => baixarArquivo(modeloXlsx(ctx), nomeDoArquivo(setorNome))}>
            ⬇ Baixar modelo (.xlsx)
          </button>
          <button type="button" className={`${botao} bg-marca-600 text-white hover:bg-marca-700`}
                  onClick={() => { setAberto(!aberto); setPlano(null); setErro(null); setFeito(null); }}>
            ⬆ Subir lista
          </button>
        </div>
      </div>

      {!ctx.metricas.length && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200">
          Este setor ainda não tem métricas{ctx.cargos.length ? '' : ' nem cargos'}: ele foi criado do zero, sem copiar de outro setor.
          O modelo traz só a Meta{ctx.cargos.length ? '' : ' e colunas vagas para nomear os cargos'}. As métricas nascem com as filas
          (Usuários e setores › Setores e filas) e em Faixas e nomes. Para começar com tudo igual a outro setor, exclua este e crie de
          novo escolhendo &ldquo;Copiar de&rdquo;.
        </p>
      )}
      {feito && <p className="surgir mt-3 rounded-lg bg-marca-50 px-3 py-2 text-sm text-marca-800 ring-1 ring-marca-600/20 dark:bg-marca-500/10 dark:text-marca-300">{feito}</p>}
      {erro && <p className="surgir mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}

      {aberto && !plano && (
        <div className="surgir mt-4 grid gap-3 lg:grid-cols-2">
          <label onDragOver={(e) => { e.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)}
                 onDrop={(e) => { e.preventDefault(); setSobre(false); const f = e.dataTransfer.files[0]; if (f) lerArquivo(f); }}
                 className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-6 text-center text-sm transition
                   ${sobre ? 'border-marca-600 bg-marca-50 text-marca-800 dark:bg-marca-500/10' : 'border-slate-300 text-slate-500 hover:border-marca-600/60'}`}>
            <b className="text-slate-800">Arraste a planilha aqui ou clique para escolher</b>
            <span className="mt-1 text-xs">O modelo (.xlsx) editado no Excel — também aceita .csv</span>
            <input type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) lerArquivo(f); e.target.value = ''; }} />
          </label>
          <div>
            <p className="mb-1 text-xs text-slate-500">…ou copie as células no Excel (com o cabeçalho) e cole aqui:</p>
            <textarea rows={5} onPaste={(e) => lerTexto(e.clipboardData.getData('text'))} onBlur={(e) => lerTexto(e.target.value)}
                      placeholder={'Métrica\tAtendente Júnior\tAtendente Pleno\nMeta do mês\t5000\t6000'}
                      className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs outline-none focus:border-marca-600" />
          </div>
        </div>
      )}

      {plano?.erro && <p className="surgir mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{plano.erro}</p>}

      {plano && !plano.erro && (
        <div className="surgir mt-4">
          <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{colunasOk.length} {colunasOk.length === 1 ? 'cargo' : 'cargos'} na lista</span>
            {nMud > 0 && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{nMud} {nMud === 1 ? 'valor muda' : 'valores mudam'}</span>}
            {nNovos > 0 && <span className="rounded-full bg-marca-50 px-3 py-1 text-marca-800 dark:bg-marca-500/15 dark:text-marca-300">{nNovos} {nNovos === 1 ? 'cargo novo' : 'cargos novos'}</span>}
            {nErros > 0 && <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300">{nErros} com erro (fica{nErros > 1 ? 'm' : ''} de fora)</span>}
            {!nMud && !nNovos && !nErros && <span className="rounded-full bg-marca-50 px-3 py-1 text-marca-800">Nada muda</span>}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500">
                  <th className="sticky left-0 bg-slate-50 px-3 py-2 text-left font-medium">Métrica</th>
                  {colunasOk.map((c) => (
                    <th key={c.cargo} className={`px-3 py-2 text-right font-semibold ${c.erros.length ? 'bg-rose-50 text-rose-800' : c.id == null ? 'bg-marca-50 text-marca-800' : 'text-slate-700'}`}>
                      {c.cargo}{c.id == null && !c.erros.length ? ' · novo' : ''}{c.erros.length ? ' · erro' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itens.map(({ item, rotulo }) => (
                  <tr key={item} className={item === 'media' ? 'border-b-2 border-slate-200' : ''}>
                    <td className="sticky left-0 bg-superficie px-3 py-1.5 text-slate-700">{rotulo}</td>
                    {colunasOk.map((c) => {
                      if (c.erros.length) return <td key={c.cargo} className="bg-rose-50/60 px-3 py-1.5 text-right text-slate-400">—</td>;
                      if (c.id == null) {
                        const v = c.valores[item];
                        if (v !== undefined) return <td key={c.cargo} className="bg-marca-50/60 px-3 py-1.5 text-right font-medium">{formatarValor(v)}</td>;
                        const copia = item === 'media' || !base ? undefined : valorAtual(ctx, base.id, item);
                        return <td key={c.cargo} title={base ? `Não veio na lista: copiado de ${base.nome}` : undefined}
                                   className="bg-marca-50/30 px-3 py-1.5 text-right italic text-slate-400">{copia === undefined ? '—' : `${formatarValor(copia)}*`}</td>;
                      }
                      const m = plano.mudancas.find((x) => x.id === c.id && x.item === item);
                      if (m) return (
                        <td key={c.cargo} className="bg-amber-50 px-3 py-1.5 text-right font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                          <s className="mr-1 font-normal text-slate-400">{formatarValor(m.de)}</s>{formatarValor(m.para)}
                        </td>
                      );
                      const atual = valorAtual(ctx, c.id, item);
                      // Média desligada é "não recebe", não "não pontua": traço.
                      const vazio = atual === undefined || (item === 'media' && atual === null);
                      return <td key={c.cargo} className="px-3 py-1.5 text-right text-slate-400">{vazio ? '—' : formatarValor(atual)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 space-y-1 text-xs text-slate-500">
            {colunasOk.filter((c) => c.erros.length).map((c) => <p key={c.cargo} className="text-rose-700 dark:text-rose-300">{c.cargo}: {c.erros.join('; ')} — fica de fora.</p>)}
            {colunasOk.filter((c) => c.avisos.length).map((c) => <p key={c.cargo} className="text-amber-700 dark:text-amber-300">{c.cargo}: {c.avisos.join('; ')}.</p>)}
            {nNovos > 0 && base && <p>* Cargo novo: o que não veio na lista é copiado de {base.nome} (a média, não).</p>}
            {plano.ignoradas.length > 0 && <p>Linhas ignoradas (não são métricas deste setor): {plano.ignoradas.join(', ')}.</p>}
            {plano.fora.length > 0 && <p>Fora da lista, ficam como estão: {plano.fora.join(', ')}.</p>}
            <p>Célula vazia não muda nada; &quot;não pontua&quot; desliga a métrica no cargo.</p>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-72 flex-1">
              <span className="mb-1 block text-xs font-medium text-slate-600">Motivo da alteração (obrigatório, vai para o histórico)</span>
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: metas de 2027 aprovadas pela diretoria"
                     className="w-full rounded-lg border border-slate-300 bg-superficie px-2.5 py-1.5 text-sm outline-none focus:border-marca-600" />
            </label>
            <button type="button" disabled={ocupado || (!nMud && !nNovos)} onClick={aplicar}
                    className={`${botao} bg-marca-600 py-2 text-white hover:bg-marca-700`}>
              {ocupado ? 'Gravando…' : 'Aplicar'}
            </button>
            <button type="button" onClick={() => setPlano(null)} className="text-sm text-slate-500 hover:underline">descartar</button>
          </div>
        </div>
      )}
    </section>
  );
}
