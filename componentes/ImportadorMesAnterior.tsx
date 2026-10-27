'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { dataHora, mesRotulo } from '@/lib/formatar';
import { lerPlanilha } from '@/lib/xlsx-navegador';
import { comparavel, lerMesDaPlanilha, type MesDaPlanilha } from '@/lib/planilha-mes-anterior';
import { mensagemDoErro } from '@/lib/erro-amigavel';

export type PessoaDoCadastro = { id: string; nome: string; email: string | null; nome_hub: string | null; ativo: boolean };
export type ImportacaoFeita = {
  id: string; mes_competencia: string; arquivo: string; importado_por_nome: string | null; importado_em: string;
  resumo: { finalizados?: number; validas?: number; positivas?: number; pessoas?: number } | null;
  /** 'completo' (mês antes do sistema) ou 'volume' (só o volume de um mês do sistema, migração 70). */
  tipo?: string;
};

const NOVO = 'novo';
const fmt = (n: number | null | undefined, d = 0) => n == null ? '—'
  : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number | null) => x == null ? '—' : `${fmt(x * 100, 1)}%`;
const botao = 'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40';

/**
 * Importar mês anterior (1.52.0, migração 69): o "Dashboard Expansão" de um mês
 * antes do sistema. A planilha é lida aqui, no computador; a prévia mostra o
 * que entra e a conferência por pessoa, e nada é gravado antes de "Importar".
 *
 * E-mail sem cadastro não é descartado: o gestor liga a uma pessoa ou cadastra
 * como histórico (inativa, sem login), e os dados contam como os de qualquer um.
 */
export default function ImportadorMesAnterior({
  pessoas, importacoes, primeiroDoSistema, semVolume = [],
}: {
  pessoas: PessoaDoCadastro[];
  importacoes: ImportacaoFeita[];
  /** Primeiro mês fechado pelo próprio sistema: só antes dele se importa. */
  primeiroDoSistema: string | null;
  /** Meses fechados pelo sistema e sem volume: deles, só o volume (1.54.0). */
  semVolume?: string[];
}) {
  const router = useRouter();
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [lido, setLido] = useState<MesDaPlanilha | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const ativos = useMemo(() => [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [pessoas]);

  /** Pessoa do cadastro para um e-mail/nome da planilha: e-mail primeiro, depois nome. */
  function casar(email: string | null, nome: string) {
    const porEmail = email ? pessoas.find((p) => p.email?.trim().toLowerCase() === email) : undefined;
    if (porEmail) return { id: porEmail.id, como: 'e-mail' };
    const n = comparavel(nome);
    const porNome = pessoas.find((p) => comparavel(p.nome) === n || (p.nome_hub && comparavel(p.nome_hub) === n));
    return porNome ? { id: porNome.id, como: 'nome' } : null;
  }

  async function ler(f: File) {
    setErro(null); setAviso(null); setLido(null); setArquivo(f.name);
    try {
      const mes = lerMesDaPlanilha(await lerPlanilha(f));
      const inicial: Record<string, string> = {};
      for (const p of mes.pessoas) inicial[p.chave] = casar(p.email, p.nome)?.id ?? '';
      for (const c of mes.soAvaliacoes) inicial[c] = casar(c, c.split('@')[0])?.id ?? '';
      setEscolhas(inicial);
      setLido(mes);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui ler a planilha.');
    }
  }

  // O cadastro muda depois de uma importação (quem entrou como histórico em
  // julho já existe em junho): o que estava sem pessoa, ou marcado para
  // cadastrar, passa a apontar para quem agora casa.
  useEffect(() => {
    if (!lido) return;
    setEscolhas((s) => {
      const novo = { ...s };
      for (const p of lido.pessoas) {
        const achou = casar(p.email, p.nome);
        if (achou && (!s[p.chave] || s[p.chave] === NOVO)) novo[p.chave] = achou.id;
      }
      return novo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoas, lido]);

  // Só o volume (1.54.0, migração 70): mês já fechado pelo sistema, sem volume.
  // Entram só finalizados e tempos; fechamento e avaliações
  // ficam como estão. Só quem tem volume precisa de pessoa, e só do cadastro.
  const soVolume = !!lido && !!primeiroDoSistema && lido.mes >= primeiroDoSistema && semVolume.includes(lido.mes);
  const comVolume = lido ? lido.pessoas.filter((p) => !soVolume || p.volume.length > 0) : [];
  const chaves = lido ? [...comVolume.map((p) => p.chave), ...(soVolume ? [] : lido.soAvaliacoes)] : [];
  const semEscolha = chaves.filter((c) => !escolhas[c]);
  const repetidas = (() => {
    const usadas = chaves.map((c) => escolhas[c]).filter((v) => v && v !== NOVO);
    return usadas.filter((v, i) => usadas.indexOf(v) !== i);
  })();
  const naoCadastrados = comVolume.filter((p) => !casar(p.email, p.nome));

  const totais = useMemo(() => {
    if (!lido) return null;
    const vol = lido.pessoas.flatMap((p) => p.volume);
    const soma = (canal: string, campo: 'finalizados') =>
      vol.filter((v) => v.canal === canal).reduce((a, v) => a + (v[campo] ?? 0), 0);
    const validas = lido.avaliacoes.filter((a) => a.nota != null && a.nota >= 1 && a.nota <= 5);
    return {
      finalizados: soma('huggy', 'finalizados'), diretores: soma('diretores', 'finalizados'),
      validas: validas.length, positivas: validas.filter((a) => a.nota! >= 4).length,
    };
  }, [lido]);

  const daPessoa = (chave: string) => {
    const as = lido!.avaliacoes.filter((a) => a.chave === chave && a.nota != null && a.nota >= 1 && a.nota <= 5);
    return { validas: as.length, csat: as.length ? as.filter((a) => a.nota! >= 4).length / as.length : null };
  };

  const jaImportado = lido && importacoes.some((i) => i.mes_competencia === lido.mes);
  const doSistema = lido && primeiroDoSistema && lido.mes >= primeiroDoSistema && !soVolume;

  async function importar() {
    if (!lido || !totais || !arquivo) return;
    setOcupado(true); setErro(null); setAviso(null);
    const novo = (chave: string) => {
      const p = lido.pessoas.find((x) => x.chave === chave);
      return { nome: p?.nome ?? chave.split('@')[0], email: p?.email ?? (chave.includes('@') ? chave : null) };
    };
    if (soVolume) {
      const { data, error } = await criarClienteNavegador().rpc('importar_volume_mes', { p: {
        mes: lido.mes, arquivo,
        resumo: { finalizados: totais.finalizados,
          diretores: totais.diretores, pessoas: comVolume.length },
        vinculos: chaves.map((c) => ({ chave: c, pessoa_id: escolhas[c] })),
        pessoas: comVolume.map((p) => ({ chave: p.chave, volume: p.volume })),
      } });
      setOcupado(false);
      if (error) { setErro(await mensagemDoErro(error)); return; }
      setAviso(`Volume de ${mesRotulo(lido.mes).toLowerCase()} importado: ${fmt((data as { volume: number }).volume)} linhas (pessoa × semana × canal). O fechamento não mudou.`);
      setLido(null); setArquivo(null);
      router.refresh();
      return;
    }
    const { data, error } = await criarClienteNavegador().rpc('importar_mes_anterior', { p: {
      mes: lido.mes, arquivo,
      resumo: { ...totais, pessoas: lido.pessoas.length, de: lido.de, ate: lido.ate },
      vinculos: chaves.map((c) => (escolhas[c] === NOVO ? { chave: c, novo: novo(c) } : { chave: c, pessoa_id: escolhas[c] })),
      pessoas: lido.pessoas.map((p) => ({ chave: p.chave, resultado: p.resultado, meta: p.meta, volume: p.volume, linhas: p.linhas })),
      avaliacoes: lido.avaliacoes,
    } });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    const r = data as { fechados: number; avaliacoes: number; pessoas_novas: number };
    setAviso(`${mesRotulo(lido.mes)} importado: ${r.fechados} pessoas com o mês fechado, ${fmt(r.avaliacoes)} avaliações`
      + `${r.pessoas_novas ? `, ${r.pessoas_novas} cadastrada(s) como histórico` : ''}.`);
    setLido(null); setArquivo(null);
    router.refresh();
  }

  async function desfazer(i: ImportacaoFeita) {
    const oQue = i.tipo === 'volume' ? 'o volume que ela gravou (o fechamento fica)' : 'as avaliações, o volume e o fechamento que ela gravou';
    if (!window.confirm(`Desfazer a importação de ${mesRotulo(i.mes_competencia)}? Apaga ${oQue}.`)) return;
    setOcupado(true); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().rpc('desfazer_importacao_mes', { p_id: i.id });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setAviso(`Importação de ${mesRotulo(i.mes_competencia)} desfeita.`);
    router.refresh();
  }

  // Os 3 meses antes do primeiro do sistema, e ele.
  const meses = primeiroDoSistema ? [3, 2, 1, 0].map((n) => {
    const d = new Date(`${primeiroDoSistema}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n);
    return d.toISOString().slice(0, 7) + '-01';
  }) : [];

  return (
    <div className="space-y-6">
      <Quadro titulo="Meses antes do sistema"
              subtitulo='Para trazer o histórico das planilhas de cota. Um arquivo por mês, no formato "Dashboard Expansão". O resultado de cada pessoa entra congelado, como está na planilha — nada é recalculado com os pesos de hoje.'>
        {erro && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
        {aviso && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

        {meses.length > 0 && (
          <div className="grid gap-2.5 sm:grid-cols-4">
            {meses.map((m) => {
              const feita = importacoes.find((i) => i.mes_competencia === m);
              return (
                <div key={m} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-600">
                  <b className="block text-slate-900">{mesRotulo(m)}</b>
                  {m >= primeiroDoSistema! ? <>
                    <span className="rounded-full bg-slate-100 px-2 py-px text-xs text-slate-600">no sistema</span>
                    {feita?.tipo === 'volume' ? <span className="ml-1 rounded-full bg-marca-600/15 px-2 py-px text-xs font-semibold text-marca-700 dark:text-marca-400">+ volume importado</span>
                      : semVolume.includes(m) && <span className="ml-1 rounded-full bg-amber-500/15 px-2 py-px text-xs text-amber-700 dark:text-amber-300">sem volume</span>}
                  </>
                    : feita ? <span className="rounded-full bg-marca-600/15 px-2 py-px text-xs font-semibold text-marca-700 dark:text-marca-400">importado · fechado</span>
                      : 'sem dados'}
                </div>
              );
            })}
          </div>
        )}

        <label className="mt-4 block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 hover:border-marca-600">
          <b className="text-slate-800">{arquivo ? arquivo : 'Escolher o arquivo .xlsx'}</b>
          <span className="block">nada é gravado antes da conferência</span>
          <input type="file" accept=".xlsx,.xlsm" className="sr-only" disabled={ocupado}
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); e.target.value = ''; }} />
        </label>

        {importacoes.length > 0 && (
          <Tabela noQuadro>
            <thead><tr><Th>Importação</Th><Th>Arquivo</Th><Th>Por</Th><Th>Em</Th><Th className="text-right">Finalizados</Th><Th /></tr></thead>
            <tbody>
              {importacoes.map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium text-slate-800">
                    {mesRotulo(i.mes_competencia)}
                    {i.tipo === 'volume' && <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-px text-xs font-normal text-slate-600">só volume</span>}
                  </Td>
                  <Td className="text-slate-600">{i.arquivo}</Td>
                  <Td>{i.importado_por_nome ?? '—'}</Td>
                  <Td className="whitespace-nowrap">{dataHora(i.importado_em)}</Td>
                  <Td className="text-right tabular-nums">{fmt(i.resumo?.finalizados)}</Td>
                  <Td className="text-right">
                    <button type="button" disabled={ocupado} onClick={() => desfazer(i)}
                            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-rose-500 hover:text-rose-700 disabled:opacity-40">
                      Desfazer
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Quadro>

      {lido && totais && (
        <Quadro titulo={arquivo ?? 'Planilha'}
                subtitulo={<>Competência <b>{mesRotulo(lido.mes)}</b> · ciclo {lido.de.split('-').reverse().slice(0, 2).join('/')} a {lido.ate.split('-').reverse().slice(0, 2).join('/')} · conferência antes de gravar</>}>
          {soVolume && (
            <p className="mb-3 rounded-xl border-2 border-marca-600 bg-marca-600/8 px-4 py-3 text-sm text-slate-700">
              <b className="text-slate-900">Só o volume.</b> {mesRotulo(lido.mes)} já está no sistema, fechado, com as avaliações.
              Desta planilha entram só os finalizados, TMA e TME por pessoa e semana, e os atendimentos de
              Diretores e Executivos. <b className="text-slate-900">O resultado fechado e as avaliações não mudam.</b>
            </p>
          )}
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {(soVolume ? [
              ['Atendimentos finalizados (Huggy)', fmt(totais.finalizados), 'fila Expansão'],
              ['Diretores e Executivos', fmt(totais.diretores), 'fila Diretores-Expansão'],
              ['Pessoas com volume', fmt(comVolume.length), `de ${lido.pessoas.length} abas`],
            ] : [
              ['Atendimentos finalizados (Huggy)', fmt(totais.finalizados), 'fila Expansão'],
              ['Avaliações no ciclo', fmt(lido.avaliacoes.length), `${fmt(totais.validas)} com nota 1 a 5`],
              ['C-SAT da equipe', pct(totais.validas ? totais.positivas / totais.validas : null), `${fmt(totais.positivas)} positivas de ${fmt(totais.validas)} · sobre o mês inteiro`],
              ['Diretores e Executivos', fmt(totais.diretores), 'fila Diretores-Expansão'],
            ]).map(([r, v, s]) => (
              <div key={r} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-xs text-slate-500">{r}</p>
                <p className="text-xl font-semibold tabular-nums text-slate-900">{v}</p>
                <p className="text-xs text-slate-500">{s}</p>
              </div>
            ))}
          </div>

          <ul className="mt-3 space-y-1.5 text-sm">
            {doSistema && <li className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800">{mesRotulo(lido.mes)} já é do sistema e já tem volume (ou ainda está aberto): nada a importar. Meses inteiros, só antes de {mesRotulo(primeiroDoSistema!)}.</li>}
            {jaImportado && <li className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800">{mesRotulo(lido.mes)} já foi importado. Desfaça a importação anterior para importar de novo.</li>}
            {naoCadastrados.length > 0 && (
              <li className="rounded-lg bg-amber-500/10 px-3 py-2 text-slate-700">
                <b>{naoCadastrados.length === 1 ? '1 e-mail não está' : `${naoCadastrados.length} e-mails não estão`} no cadastro</b>:{' '}
                {naoCadastrados.map((p, i) => (
                  <span key={p.chave}>{i ? ', ' : ''}<code>{p.email ?? p.nome}</code> (aba {p.aba}{soVolume ? '' : `, ${fmt(daPessoa(p.chave).validas)} notas`})</span>
                ))}. {soVolume ? 'Escolha a pessoa do cadastro.' : <>Escolha a pessoa ou <b>Cadastrar como histórico</b> (inativa, sem login, fora das monitorias). Nada é descartado: as notas entram na C-SAT da equipe.</>}
              </li>
            )}
            {!soVolume && lido.soAvaliacoes.length > 0 && (
              <li className="rounded-lg bg-amber-500/10 px-3 py-2 text-slate-700">
                Avaliações de e-mail sem aba de pessoa: {lido.soAvaliacoes.map((c) => <code key={c} className="mr-1">{c}</code>)} — escolha a pessoa no fim da tabela.
              </li>
            )}
            {!soVolume && <li className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
              {fmt(lido.fora.depois)} avaliações depois de {lido.ate.split('-').reverse().slice(0, 2).join('/')} ficam de fora (são do mês seguinte)
              {lido.fora.semData ? ` · ${fmt(lido.fora.semData)} sem data ficam de fora` : ''}
              {lido.fora.repetidas ? ` · ${fmt(lido.fora.repetidas)} protocolos repetidos no mesmo dia entram uma vez só` : ''}.
            </li>}
            {!soVolume && <li className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
              Monitorias da planilha não entram (decisão da gestão); os pontos delas já estão no resultado congelado.
            </li>}
            {soVolume && lido.pessoas.filter((p) => !p.volume.length).map((p) => (
              <li key={p.chave} className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">{p.aba}: sem volume na planilha — nada entra para {p.aba === p.nome ? 'esta pessoa' : p.nome.split(' ')[0]}.</li>
            ))}
            {!soVolume && lido.avisos.map((a) => <li key={a} className="rounded-lg bg-amber-500/10 px-3 py-2 text-slate-700">{a}</li>)}
          </ul>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  {(soVolume ? ['Na planilha', 'No cadastro', 'Sem 1', 'Sem 2', 'Sem 3', 'Sem 4', 'TME médio', 'Dir.+Exec.']
                    : ['Na planilha', 'No cadastro', 'Sem 1', 'Sem 2', 'Sem 3', 'Sem 4', 'Notas 1–5', 'C-SAT', 'Dir.+Exec.', 'Resultado', 'Semanas + mês']).map((h, i) => (
                    <th key={h} className={`whitespace-nowrap border-b border-slate-200 px-1.5 py-2 font-medium ${i >= 2 && i <= 9 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comVolume.map((p) => {
                  const auto = casar(p.email, p.nome);
                  const huggy = (s: number) => p.volume.find((v) => v.canal === 'huggy' && v.semana === s)?.finalizados ?? null;
                  const dir = p.volume.filter((v) => v.canal === 'diretores').reduce((a, v) => a + v.finalizados, 0);
                  const { validas, csat } = daPessoa(p.chave);
                  return (
                    <tr key={p.chave} className="border-b border-slate-100">
                      <td className="whitespace-nowrap px-1.5 py-2 font-semibold text-slate-900">{p.aba}</td>
                      <td className="whitespace-nowrap px-1.5 py-2">
                        {!auto && <span className="mr-1.5 rounded-full bg-amber-500/15 px-2 py-px text-xs text-amber-700 dark:text-amber-300">não cadastrado</span>}
                        <EscolhaDePessoa valor={escolhas[p.chave] ?? ''} pessoas={ativos} disabled={ocupado} semNovo={soVolume}
                                         onChange={(v) => setEscolhas((s) => ({ ...s, [p.chave]: v }))} />
                        {auto && escolhas[p.chave] === auto.id && <span className="ml-1 text-xs text-slate-400">· {auto.como}</span>}
                      </td>
                      {[1, 2, 3, 4].map((s) => <td key={s} className="px-1.5 py-2 text-right">{fmt(huggy(s))}</td>)}
                      {soVolume ? <>
                        <td className="px-1.5 py-2 text-right">{tmeMedio(p.volume)}</td>
                        <td className="px-1.5 py-2 text-right">{fmt(dir)}</td>
                      </> : <>
                      <td className="px-1.5 py-2 text-right">{fmt(validas)}</td>
                      <td className="px-1.5 py-2 text-right">{pct(csat)}</td>
                      <td className="px-1.5 py-2 text-right">{fmt(dir)}</td>
                      <td className="px-1.5 py-2 text-right font-semibold text-slate-900">{fmt(p.resultado, 2)}</td>
                      <td className="whitespace-nowrap px-1.5 py-2">
                        {Math.abs(p.diferenca) < 0.01
                          ? <span className="font-semibold text-marca-700 dark:text-marca-400">✓ {p.soMes.length ? '' : 'bate'}</span>
                          : <span className="font-semibold text-amber-700 dark:text-amber-300">não fecha: {fmt(p.diferenca, 2)}</span>}
                        {p.soMes.length > 0 && (
                          <span className="text-xs text-slate-500"> {p.soMes.map((s) => `${s.cota > 0 ? '+' : ''}${fmt(s.cota)} ${s.rotulo.toLowerCase()}`).join(' · ')}</span>
                        )}
                      </td>
                      </>}
                    </tr>
                  );
                })}
                {!soVolume && lido.soAvaliacoes.map((c) => (
                  <tr key={c} className="border-b border-slate-100">
                    <td className="whitespace-nowrap px-1.5 py-2 text-slate-600"><code>{c}</code></td>
                    <td className="px-1.5 py-2" colSpan={10}>
                      <EscolhaDePessoa valor={escolhas[c] ?? ''} pessoas={ativos} disabled={ocupado}
                                       onChange={(v) => setEscolhas((s) => ({ ...s, [c]: v }))} />
                      <span className="ml-2 text-xs text-slate-500">só avaliações ({fmt(daPessoa(c).validas)} com nota)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Finalizados por semana vêm da aba de volume (com TMA e TME). &ldquo;Semanas + mês&rdquo; confere se as 4 semanas, mais o
            que só conta no mês, dão o resultado da planilha; o que não fechar entra no extrato como &ldquo;Diferença da planilha&rdquo;.
          </p>

          <div className="sticky bottom-3 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-marca-600/40 bg-[#0f1a14] px-4 py-2.5 text-sm text-[#e8f5ec]">
            <span>
              <b>{soVolume ? `Só o volume · ${comVolume.length} pessoas` : `${lido.pessoas.length} pessoas`}</b>
              {semEscolha.length > 0 ? ` · falta escolher ${semEscolha.length}` : repetidas.length ? ' · uma pessoa foi escolhida duas vezes'
                : soVolume ? ` · ${mesRotulo(lido.mes)} · o fechado não muda` : ` · ${mesRotulo(lido.mes)} entra fechado, com o resultado da planilha`}
            </span>
            <span className="flex gap-2">
              <button type="button" disabled={ocupado} onClick={() => { setLido(null); setArquivo(null); }}
                      className={`${botao} border border-white/25 font-medium hover:bg-white/10`}>Cancelar</button>
              <button type="button" onClick={importar}
                      disabled={ocupado || semEscolha.length > 0 || repetidas.length > 0 || !!jaImportado || !!doSistema}
                      className={`${botao} bg-marca-600 text-white hover:bg-marca-700`}>
                {ocupado ? 'Importando…' : soVolume ? `Importar volume de ${mesRotulo(lido.mes).toLowerCase()}` : `Importar ${mesRotulo(lido.mes).toLowerCase()}`}
              </button>
            </span>
          </div>
        </Quadro>
      )}

      {!lido && importacoes.length === 0 && !meses.length && <Vazio>Nenhum mês importado.</Vazio>}
    </div>
  );
}

/** TME médio das semanas com TME, em minutos. */
function tmeMedio(volume: { canal: string; tme_seg: number | null }[]) {
  const t = volume.filter((v) => v.canal === 'huggy' && v.tme_seg).map((v) => v.tme_seg!);
  if (!t.length) return '—';
  const min = Math.round(t.reduce((a, b) => a + b, 0) / t.length / 60);
  return min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min}min`;
}

function EscolhaDePessoa({ valor, pessoas, disabled, onChange, semNovo = false }: {
  valor: string; pessoas: PessoaDoCadastro[]; disabled: boolean; onChange: (v: string) => void; semNovo?: boolean;
}) {
  return (
    <select value={valor} disabled={disabled} onChange={(e) => onChange(e.target.value)}
            className={`rounded-md border bg-superficie px-2 py-1 text-sm text-slate-900 outline-none focus:border-marca-600 ${
              valor ? 'border-slate-300' : 'border-amber-500'}`}>
      <option value="">Escolher…</option>
      {!semNovo && <option value={NOVO}>Cadastrar como histórico</option>}
      {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? '' : ' (inativa)'}</option>)}
    </select>
  );
}
