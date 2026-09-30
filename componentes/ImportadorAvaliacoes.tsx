'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro, Tabela, Th, Td } from '@/componentes/ui';
import { data as formatarData, mesDeCompetencia, mesRotulo, semanaDoCiclo } from '@/lib/formatar';
import { dataDoExcel, lerPlanilha, type Linha } from '@/lib/xlsx-navegador';
import type { Pessoa } from '@/lib/tipos';

type Origem = 'huggy' | 'diretores';

/** Setor do Hub → origem da avaliação na cota. */
const SETORES: Record<string, Origem> = {
  expansao: 'huggy',
  'diretores-expansao': 'diretores',
};

/** Nome do canal como aparece no Hub. */
const ROTULO_ORIGEM: Record<Origem, string> = { huggy: 'Expansão', diretores: 'Diretores-Expansão' };
const CANAIS: Origem[] = ['huggy', 'diretores'];

const normalizar = (v: unknown) => String(v ?? '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').trim().toLowerCase();

type Colunas = {
  data: string; protocolo: string; atendente: string; nota: string;
  tabulacao?: string; setor?: string;
};

/**
 * Descobre as colunas pelo cabeçalho, não pela posição: o relatório do Hub e a
 * planilha formatada têm as mesmas informações em ordens diferentes.
 */
function acharColunas(cabecalho: Linha): Colunas | null {
  const por = new Map(Object.entries(cabecalho).map(([col, v]) => [normalizar(v), col]));
  const um = (...nomes: string[]) => nomes.map((n) => por.get(n)).find(Boolean);
  const c = {
    data: um('data'),
    protocolo: um('protocolo'),
    atendente: um('atendente'),
    nota: um('csat', 'avaliacao'),
    tabulacao: um('tabulacao (tag)', 'tabulacao'),
    setor: um('setor', 'tipo de atendimento'),
  };
  return c.data && c.protocolo && c.atendente && c.nota ? (c as Colunas) : null;
}

function lerData(v: unknown): string | null {
  // Serial de data plausível (anos 2000 a 2100); fora disso a coluna não é data.
  if (typeof v === 'number') return v > 36_500 && v < 73_000 ? dataDoExcel(v) : null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "Sem atendente (bot/sem handoff)", vazio: conversa sem pessoa — não há a quem atribuir. */
const ehRobo = (atendente: string) => !atendente || normalizar(atendente).startsWith('sem atendente');

type Avaliacao = {
  pessoa_id: string; origem: Origem; data: string; protocolo: string;
  nota: number; tabulacao: string | null; origem_arquivo: string;
};

/** Nota de atendente que nenhuma ficha reconhece: fica guardada (migração 45). */
type Guardada = {
  nome_no_arquivo: string; origem: Origem; data: string; protocolo: string;
  nota: number; tabulacao: string | null; origem_arquivo: string;
};

type AnaliseArquivo = {
  nome: string;
  aba: string | null;
  formato: 'hub' | 'huggy' | null;
  /** Arquivo fora: sem as colunas, ilegível ou com setor desconhecido. */
  erro: string | null;
  lidas: number;
  semNota: number;
  semData: number;
  robo: number;
  repetidasNoLote: number;
  jaImportadas: number;
  novas: Avaliacao[];
  guardar: Guardada[];
  periodo: [string, string] | null;
};

const PAGINA = 1000;

/**
 * Importar avaliações (1.34.0): um ou vários relatórios de uma vez.
 *
 * Cada arquivo é lido aqui, no navegador (lib/xlsx-navegador) — o servidor só
 * recebe as avaliações prontas, em lotes. A mesma avaliação (data + protocolo)
 * entra uma vez só, venha de um arquivo, de dois ou de uma importação antiga.
 * Nota de atendente não reconhecido é guardada, não descartada; conversa só
 * com o robô é ignorada.
 */
export default function ImportadorAvaliacoes({
  pessoas, importadoPor,
}: {
  pessoas: Pessoa[];
  importadoPor: string;
}) {
  const router = useRouter();
  const [arquivos, setArquivos] = useState<AnaliseArquivo[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // Nome no Hub principal e os nomes a mais (migração 45).
  const porNomeHub = useMemo(() => {
    const m = new Map<string, Pessoa>();
    for (const p of pessoas) {
      for (const n of [p.nome_hub, ...(p.nomes_hub_extras ?? [])]) if (n) m.set(normalizar(n), p);
    }
    return m;
  }, [pessoas]);
  const porEmail = useMemo(() => new Map(pessoas.filter((p) => p.email)
    .map((p) => [normalizar(p.email), p])), [pessoas]);
  const nomePessoa = useMemo(() => new Map(pessoas.map((p) => [p.id, p.nome])), [pessoas]);

  /** Lê um arquivo e separa as linhas, sem olhar o banco ainda. */
  async function lerArquivo(f: File, vistas: Set<string>): Promise<AnaliseArquivo> {
    const a: AnaliseArquivo = {
      nome: f.name, aba: null, formato: null, erro: null, lidas: 0, semNota: 0, semData: 0, robo: 0,
      repetidasNoLote: 0, jaImportadas: 0, novas: [], guardar: [], periodo: null,
    };
    let abas: Map<string, Linha[]>;
    try { abas = await lerPlanilha(f); } catch (e) {
      a.erro = e instanceof Error ? e.message : 'Não foi possível ler o arquivo.'; return a;
    }
    const aba = [...abas].find(([, l]) => l.length && acharColunas(l[0]));
    if (!aba) { a.erro = 'Nenhuma aba com as colunas Data, Protocolo, Atendente e CSAT/Avaliação.'; return a; }

    const [nomeAba, [cabecalho, ...linhas]] = aba;
    const col = acharColunas(cabecalho)!;
    a.aba = nomeAba; a.formato = col.setor ? 'hub' : 'huggy'; a.lidas = linhas.length;
    const desconhecidos = new Map<string, number>();

    for (const l of linhas) {
      const nota = Number(l[col.nota]);
      // Só avaliações contam. Atendimento sem nota não é assunto da importação.
      if (!(nota >= 1 && nota <= 5)) { a.semNota++; continue; }
      const data = lerData(l[col.data]);
      if (!data) { a.semData++; continue; }

      let origem: Origem = 'huggy';
      if (col.setor) {
        const setor = String(l[col.setor] ?? '');
        const o = SETORES[normalizar(setor)];
        if (!o) { desconhecidos.set(setor || '(vazio)', (desconhecidos.get(setor || '(vazio)') ?? 0) + 1); continue; }
        origem = o;
      }

      const atendente = String(l[col.atendente] ?? '').trim();
      if (ehRobo(atendente)) { a.robo++; continue; }

      const protocolo = String(l[col.protocolo] ?? '').trim();
      const chave = `${data}|${protocolo}`;
      if (vistas.has(chave)) { a.repetidasNoLote++; continue; }
      vistas.add(chave);

      const tabulacao = col.tabulacao && l[col.tabulacao] != null ? String(l[col.tabulacao]) : null;
      const pessoa = a.formato === 'hub' ? porNomeHub.get(normalizar(atendente)) : porEmail.get(normalizar(atendente));
      if (pessoa) {
        a.novas.push({ pessoa_id: pessoa.id, origem, data, protocolo, nota, tabulacao, origem_arquivo: f.name });
      } else {
        a.guardar.push({ nome_no_arquivo: atendente, origem, data, protocolo, nota, tabulacao, origem_arquivo: f.name });
      }
    }

    // Setor desconhecido costuma ser arquivo errado: o arquivo inteiro fica de fora.
    if (desconhecidos.size) {
      a.erro = `Setores desconhecidos: ${[...desconhecidos].map(([n, q]) => `${n} (${q})`).join(', ')}. Confira se é o relatório certo.`;
      a.novas = []; a.guardar = [];
      return a;
    }
    const datas = [...a.novas, ...a.guardar].map((c) => c.data).sort();
    if (datas.length) a.periodo = [datas[0], datas[datas.length - 1]];
    return a;
  }

  async function escolherArquivos(lista: File[]) {
    setArquivos(null); setErro(null); setSucesso(null);
    if (!lista.length) return;
    setOcupado(`Lendo ${lista.length > 1 ? `${lista.length} planilhas` : 'a planilha'}…`);

    // A mesma avaliação em dois arquivos entra uma vez só.
    const vistas = new Set<string>();
    const lidos: AnaliseArquivo[] = [];
    for (const f of lista) lidos.push(await lerArquivo(f, vistas));

    // O que já está no banco — na cota ou guardado — no período de todos.
    const validos = lidos.filter((a) => !a.erro && a.periodo);
    if (validos.length) {
      setOcupado('Conferindo o que já foi importado…');
      const de = validos.map((a) => a.periodo![0]).sort()[0];
      const fins = validos.map((a) => a.periodo![1]).sort();
      const ate = fins[fins.length - 1];
      const existentes = new Set<string>();
      const db = criarClienteNavegador();
      for (const tabela of ['avaliacoes', 'avaliacoes_guardadas'] as const) {
        for (let i = 0; ; i += PAGINA) {
          const { data: pag, error } = await db.from(tabela).select('data, protocolo')
            .gte('data', de).lte('data', ate).order('data').order('protocolo').range(i, i + PAGINA - 1);
          if (error) { setErro(error.message); setOcupado(null); return; }
          for (const r of pag ?? []) existentes.add(`${r.data}|${r.protocolo}`);
          if ((pag ?? []).length < PAGINA) break;
        }
      }
      for (const a of validos) {
        const antes = a.novas.length + a.guardar.length;
        a.novas = a.novas.filter((c) => !existentes.has(`${c.data}|${c.protocolo}`));
        a.guardar = a.guardar.filter((c) => !existentes.has(`${c.data}|${c.protocolo}`));
        a.jaImportadas = antes - a.novas.length - a.guardar.length;
      }
    }

    setArquivos(lidos);
    setOcupado(null);
  }

  const ok = (arquivos ?? []).filter((a) => !a.erro);
  const novas = ok.flatMap((a) => a.novas);
  const guardar = ok.flatMap((a) => a.guardar);
  const periodoTotal = useMemo(() => {
    const d = [...novas, ...guardar].map((c) => c.data).sort();
    return d.length ? [d[0], d[d.length - 1]] as [string, string] : null;
  }, [novas, guardar]);

  async function importar() {
    if (!arquivos || (!novas.length && !guardar.length)) return;
    setOcupado('Importando…'); setErro(null);
    const db = criarClienteNavegador();
    const agora = new Date().toISOString();
    const lote = 500;

    for (let i = 0; i < novas.length; i += lote) {
      const { error } = await db.from('avaliacoes').upsert(
        novas.slice(i, i + lote).map((n) => ({ ...n, importado_por: importadoPor, importado_em: agora })),
        { onConflict: 'data,protocolo', ignoreDuplicates: true },
      );
      if (error) {
        setErro(`Falha após ${i} avaliações: ${error.message}. Importe os arquivos de novo — as que já entraram são ignoradas.`);
        setOcupado(null);
        return;
      }
    }
    for (let i = 0; i < guardar.length; i += lote) {
      const { error } = await db.from('avaliacoes_guardadas').upsert(
        guardar.slice(i, i + lote).map((g) => ({ ...g, importado_por: importadoPor, importado_em: agora })),
        { onConflict: 'data,protocolo', ignoreDuplicates: true },
      );
      if (error) {
        setErro(`As avaliações entraram, mas as notas sem atendente não foram guardadas: ${error.message}.`);
        setOcupado(null);
        return;
      }
    }

    // Avisa Pleno e qualidade no Teams que as monitorias podem começar
    // (migração 40) — uma vez, com o período de todos os arquivos.
    let avisou = false;
    if (novas.length && periodoTotal) {
      const { data } = await db.rpc('aviso_relatorio_importado', { p_ate: periodoTotal[1], p_quantidade: novas.length });
      avisou = data === true;
    }

    setSucesso(`${novas.length} avaliações importadas`
      + (guardar.length ? ` e ${guardar.length} guardadas sem atendente reconhecido` : '')
      + ` de ${ok.length} arquivo${ok.length > 1 ? 's' : ''}.`
      + (avisou ? ' A monitoria foi avisada no Teams.' : ''));
    setArquivos(null);
    setOcupado(null);
    router.refresh();
  }

  // Resumo por pessoa e origem, com as notas.
  const resumo = useMemo(() => {
    const m = new Map<string, { pessoa: string; origem: Origem; notas: number[]; total: number }>();
    for (const n of novas) {
      const k = `${n.pessoa_id}|${n.origem}`;
      if (!m.has(k)) m.set(k, { pessoa: nomePessoa.get(n.pessoa_id) ?? '—', origem: n.origem, notas: [0, 0, 0, 0, 0], total: 0 });
      const r = m.get(k)!; r.notas[n.nota - 1]++; r.total++;
    }
    return [...m.values()].sort((x, y) => x.origem.localeCompare(y.origem) || x.pessoa.localeCompare(y.pessoa));
  }, [novas, nomePessoa]);

  /** Total por semana do ciclo, separado por canal. */
  const porSemana = useMemo(() => {
    const m = new Map<Origem, Map<string, number>>(CANAIS.map((c) => [c, new Map()]));
    for (const n of novas) {
      const k = `${mesDeCompetencia(n.data)}|${semanaDoCiclo(n.data)}`;
      const s = m.get(n.origem)!;
      s.set(k, (s.get(k) ?? 0) + 1);
    }
    return m;
  }, [novas]);

  /** Guardadas por nome como veio no arquivo. */
  const guardarPorNome = [...guardar.reduce((m, g) => m.set(g.nome_no_arquivo, (m.get(g.nome_no_arquivo) ?? 0) + 1),
    new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  // Três passos (1.19.0): escolher, conferir, importar.
  const passo = sucesso ? 3 : arquivos ? 2 : 1;
  const Passo = ({ n, rotulo }: { n: number; rotulo: string }) => (
    <span className={`flex items-center gap-2 text-sm ${n === passo && !sucesso ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
      <b className={`grid h-6 w-6 place-items-center rounded-full text-xs ${n < passo || sucesso
        ? 'bg-marca-600 text-white' : n === passo ? 'bg-slate-800 text-superficie' : 'bg-slate-100 text-slate-600'}`}>
        {n < passo || sucesso ? '✓' : n}
      </b>
      {rotulo}
    </span>
  );

  const soma = (f: (a: AnaliseArquivo) => number) => ok.reduce((s, a) => s + f(a), 0);

  return (
    <Quadro titulo="Importar avaliações">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Passo n={1} rotulo="Escolher arquivos" />
        <span aria-hidden className="h-px w-7 bg-slate-300" />
        <Passo n={2} rotulo="Conferir" />
        <span aria-hidden className="h-px w-7 bg-slate-300" />
        <Passo n={3} rotulo="Importar" />
      </div>

      <p className="mb-4 text-sm text-slate-600">
        Relatórios de atendimentos do Hub (<code>.xlsx</code>), um ou vários de uma vez. Entram só as avaliações com nota
        de 1 a 5: os setores <strong>Expansão</strong> e <strong>Diretores-Expansão</strong> são contados separadamente.
        A mesma avaliação (data e protocolo) entra uma vez só. Nota de atendente não reconhecido fica guardada;
        conversa só com o robô é ignorada.
      </p>

      <label className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-slate-300
                        px-6 py-6 text-center text-sm text-slate-500 hover:border-marca-600">
        {arquivos
          ? <span><strong className="text-slate-800">{arquivos.length} arquivo{arquivos.length > 1 ? 's' : ''}</strong> · clique para trocar</span>
          : <span><strong className="text-slate-800">Escolha os relatórios do Hub</strong> (.xlsx) — pode selecionar vários</span>}
        <input type="file" accept=".xlsx" multiple disabled={!!ocupado} className="sr-only"
               onChange={(e) => { escolherArquivos([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </label>

      {ocupado && <p className="mt-4 text-sm text-slate-500">{ocupado}</p>}
      {erro && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {sucesso && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{sucesso}</p>}

      {arquivos && (
        <div className="mt-5 space-y-5 border-t border-slate-100 pt-5">
          <div className="px-1">
            <Tabela>
              <thead>
                <tr>
                  <Th>Arquivo</Th><Th>Período</Th><Th className="text-right">Novas</Th>
                  <Th className="text-right">Já no sistema</Th><Th className="text-right">Guardar</Th>
                  <Th className="text-right">Robô</Th><Th className="text-right">Repetidas</Th>
                </tr>
              </thead>
              <tbody>
                {arquivos.map((a) => (
                  <tr key={a.nome}>
                    <Td>
                      <span className="block max-w-xs truncate font-medium text-slate-800" title={a.nome}>{a.nome}</span>
                      {a.erro
                        ? <span className="block text-xs text-rose-700 dark:text-rose-300">Fora da importação: {a.erro}</span>
                        : <span className="block text-xs text-slate-500">aba {a.aba} · {a.lidas} linhas, {a.semNota} sem avaliação{a.semData ? `, ${a.semData} sem data` : ''}</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{a.periodo ? `${formatarData(a.periodo[0])} a ${formatarData(a.periodo[1])}` : '—'}</Td>
                    <Td className="text-right font-semibold tabular-nums">{a.erro ? '—' : a.novas.length}</Td>
                    <Td className="text-right tabular-nums text-slate-500">{a.erro ? '—' : a.jaImportadas}</Td>
                    <Td className="text-right tabular-nums">{a.erro ? '—' : a.guardar.length || ''}</Td>
                    <Td className="text-right tabular-nums text-slate-500">{a.erro ? '—' : a.robo || ''}</Td>
                    <Td className="text-right tabular-nums text-slate-500">{a.erro ? '—' : a.repetidasNoLote || ''}</Td>
                  </tr>
                ))}
                {arquivos.length > 1 && (
                  <tr className="font-semibold">
                    <Td>Total</Td>
                    <Td className="whitespace-nowrap text-xs">{periodoTotal ? `${formatarData(periodoTotal[0])} a ${formatarData(periodoTotal[1])}` : '—'}</Td>
                    <Td className="text-right tabular-nums">{novas.length}</Td>
                    <Td className="text-right tabular-nums">{soma((a) => a.jaImportadas)}</Td>
                    <Td className="text-right tabular-nums">{guardar.length || ''}</Td>
                    <Td className="text-right tabular-nums">{soma((a) => a.robo) || ''}</Td>
                    <Td className="text-right tabular-nums">{soma((a) => a.repetidasNoLote) || ''}</Td>
                  </tr>
                )}
              </tbody>
            </Tabela>
          </div>
          <p className="text-xs text-slate-500">
            <b>Repetidas</b>: a mesma avaliação em mais de um arquivo — entra uma vez. <b>Robô</b>: conversas sem atendente, ignoradas.
          </p>

          {guardarPorNome.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
              <p className="font-semibold">
                {guardar.length} nota{guardar.length > 1 ? 's' : ''} de atendente{guardarPorNome.length > 1 ? 's' : ''} não reconhecido{guardarPorNome.length > 1 ? 's' : ''} ser{guardar.length > 1 ? 'ão' : 'á'} guardada{guardar.length > 1 ? 's' : ''}, sem entrar na cota
              </p>
              <p className="mt-1">{guardarPorNome.map(([n, q]) => `"${n}" (${q})`).join(', ')}.</p>
              <p className="mt-1 text-xs">
                Grave o nome como Nome no Hub na ficha da pessoa (Atendentes) e as notas entram sozinhas — ou atribua no quadro
                "Notas guardadas", abaixo.
              </p>
            </div>
          )}

          <div className="grid items-start gap-4 xl:grid-cols-2">
            {CANAIS.map((canal) => {
              const linhas = resumo.filter((r) => r.origem === canal);
              const total = linhas.reduce((s, r) => s + r.total, 0);
              const semanas = [...porSemana.get(canal)!].sort();
              return (
                <section key={canal} className="rounded-lg ring-1 ring-slate-200">
                  <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                    <h3 className="text-sm font-semibold text-slate-800">{ROTULO_ORIGEM[canal]}</h3>
                    <span className="text-sm tabular-nums text-slate-600">{total} avaliações novas</span>
                  </header>
                  {linhas.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-slate-500">Nenhuma avaliação nova deste canal.</p>
                  ) : (
                    <div className="px-5 py-5">
                      <Tabela>
                        <thead>
                          <tr>
                            <Th>Pessoa</Th>
                            {[1, 2, 3, 4, 5].map((n) => <Th key={n} className="text-right">Nota {n}</Th>)}
                            <Th className="text-right">Total</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {linhas.map((r) => (
                            <tr key={r.pessoa}>
                              <Td>{r.pessoa}</Td>
                              {r.notas.map((q, i) => <Td key={i} className="text-right tabular-nums">{q || ''}</Td>)}
                              <Td className="text-right font-semibold tabular-nums">{r.total}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </Tabela>
                    </div>
                  )}
                  {semanas.length > 0 && (
                    <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                      Por semana: {semanas.map(([k, q]) => {
                        const [mes, sem] = k.split('|');
                        return `${mesRotulo(mes)} ${sem}ª: ${q}`;
                      }).join(' · ')}
                    </p>
                  )}
                </section>
              );
            })}
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setArquivos(null); setErro(null); setSucesso(null); }} disabled={!!ocupado}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Cancelar
            </button>
            <button type="button" onClick={importar} disabled={!!ocupado || (!novas.length && !guardar.length)}
                    className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
              {!novas.length && !guardar.length ? 'Nada novo para importar'
                : `Importar ${novas.length}${guardar.length ? ` e guardar ${guardar.length}` : ''}`}
            </button>
          </div>
        </div>
      )}
    </Quadro>
  );
}
