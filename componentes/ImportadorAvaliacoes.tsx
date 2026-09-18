'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td } from '@/componentes/ui';
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

type Avaliacao = {
  pessoa_id: string; origem: Origem; data: string; protocolo: string;
  nota: number; tabulacao: string | null;
};

type Analise = {
  aba: string;
  formato: 'hub' | 'huggy';
  lidas: number;
  semNota: number;
  semData: number;
  duplicadasNoArquivo: number;
  jaImportadas: number;
  novas: Avaliacao[];
  semVinculo: Map<string, number>;
  setoresDesconhecidos: Map<string, number>;
  periodo: [string, string] | null;
};

const PAGINA = 1000;

export default function ImportadorAvaliacoes({
  pessoas, importadoPor,
}: {
  pessoas: Pessoa[];
  importadoPor: string;
}) {
  const router = useRouter();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [abas, setAbas] = useState<Map<string, Linha[]> | null>(null);
  const [aba, setAba] = useState('');
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  const porNomeHub = useMemo(() => new Map(pessoas.filter((p) => p.nome_hub)
    .map((p) => [normalizar(p.nome_hub), p])), [pessoas]);
  const porEmail = useMemo(() => new Map(pessoas.filter((p) => p.email)
    .map((p) => [normalizar(p.email), p])), [pessoas]);
  const nomePessoa = useMemo(() => new Map(pessoas.map((p) => [p.id, p.nome])), [pessoas]);

  /** Abas que parecem relatório de avaliações. */
  const abasValidas = abas
    ? [...abas].filter(([, linhas]) => linhas.length && acharColunas(linhas[0])).map(([n]) => n)
    : [];

  async function escolherArquivo(f: File | null) {
    setArquivo(f); setAbas(null); setAnalise(null); setErro(null); setSucesso(null);
    if (!f) return;
    setOcupado('Lendo a planilha…');
    try {
      const lidas = await lerPlanilha(f);
      const validas = [...lidas].filter(([, l]) => l.length && acharColunas(l[0])).map(([n]) => n);
      if (!validas.length) {
        setErro('Nenhuma aba com as colunas Data, Protocolo, Atendente e CSAT/Avaliação.');
      } else {
        setAbas(lidas);
        setAba(validas[0]);
        await analisar(lidas, validas[0]);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
    }
    setOcupado(null);
  }

  async function analisar(todas: Map<string, Linha[]>, nomeAba: string) {
    setAnalise(null); setErro(null); setSucesso(null);
    const [cabecalho, ...linhas] = todas.get(nomeAba)!;
    const col = acharColunas(cabecalho)!;
    const formato = col.setor ? 'hub' : 'huggy';

    const a: Analise = {
      aba: nomeAba, formato, lidas: linhas.length, semNota: 0, semData: 0,
      duplicadasNoArquivo: 0, jaImportadas: 0, novas: [],
      semVinculo: new Map(), setoresDesconhecidos: new Map(), periodo: null,
    };
    const somar = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

    const candidatas: Avaliacao[] = [];
    const vistas = new Set<string>();

    for (const l of linhas) {
      const nota = Number(l[col.nota]);
      // Só avaliações contam. Atendimento sem nota não é assunto da importação.
      if (!(nota >= 1 && nota <= 5)) { a.semNota++; continue; }

      const data = lerData(l[col.data]);
      if (!data) { a.semData++; continue; }

      const protocolo = String(l[col.protocolo] ?? '').trim();
      const chave = `${data}|${protocolo}`;
      if (vistas.has(chave)) { a.duplicadasNoArquivo++; continue; }
      vistas.add(chave);

      let origem: Origem = 'huggy';
      if (col.setor) {
        const setor = String(l[col.setor] ?? '');
        const o = SETORES[normalizar(setor)];
        if (!o) { somar(a.setoresDesconhecidos, setor || '(vazio)'); continue; }
        origem = o;
      }

      const atendente = String(l[col.atendente] ?? '').trim();
      const pessoa = formato === 'hub'
        ? porNomeHub.get(normalizar(atendente))
        : porEmail.get(normalizar(atendente));
      if (!pessoa) { somar(a.semVinculo, atendente || '(sem atendente)'); continue; }

      candidatas.push({
        pessoa_id: pessoa.id, origem, data, protocolo, nota,
        tabulacao: col.tabulacao && l[col.tabulacao] != null ? String(l[col.tabulacao]) : null,
      });
    }

    if (candidatas.length) {
      const datas = candidatas.map((c) => c.data).sort();
      a.periodo = [datas[0], datas[datas.length - 1]];

      // O que já está no banco para o período, para não importar de novo.
      setOcupado('Conferindo o que já foi importado…');
      const existentes = new Set<string>();
      const db = criarClienteNavegador();
      for (let de = 0; ; de += PAGINA) {
        const { data: pag, error } = await db.from('avaliacoes').select('data, protocolo')
          .gte('data', a.periodo[0]).lte('data', a.periodo[1])
          .order('id').range(de, de + PAGINA - 1);
        if (error) { setErro(error.message); setOcupado(null); return; }
        for (const r of pag ?? []) existentes.add(`${r.data}|${r.protocolo}`);
        if ((pag ?? []).length < PAGINA) break;
      }
      for (const c of candidatas) {
        if (existentes.has(`${c.data}|${c.protocolo}`)) a.jaImportadas++;
        else a.novas.push(c);
      }
    }

    setAnalise(a);
    setOcupado(null);
  }

  async function importar() {
    if (!analise || !arquivo || bloqueado) return;
    setOcupado('Importando…'); setErro(null);
    const db = criarClienteNavegador();
    const agora = new Date().toISOString();
    const lote = 500;

    for (let i = 0; i < analise.novas.length; i += lote) {
      const { error } = await db.from('avaliacoes').upsert(
        analise.novas.slice(i, i + lote).map((n) => ({
          ...n, origem_arquivo: arquivo.name, importado_por: importadoPor, importado_em: agora,
        })),
        { onConflict: 'data,protocolo', ignoreDuplicates: true },
      );
      if (error) {
        setErro(`Falha após ${i} avaliações: ${error.message}. Importe o arquivo de novo — `
          + 'as que já entraram são ignoradas.');
        setOcupado(null);
        return;
      }
    }

    setSucesso(`${analise.novas.length} avaliações importadas de "${arquivo.name}".`);
    setAnalise(null); setAbas(null); setArquivo(null);
    setOcupado(null);
    router.refresh();
  }

  // Pessoa sem vínculo NÃO bloqueia: importa o que casou e avisa o que ficou
  // de fora. Depois de cadastrar o nome, reimportar o mesmo arquivo traz só as
  // que faltaram — as já gravadas são ignoradas pela data + protocolo.
  // Setor desconhecido continua bloqueando: costuma ser arquivo errado.
  const bloqueado = !!analise && analise.setoresDesconhecidos.size > 0;
  const semVinculoTotal = analise ? [...analise.semVinculo.values()].reduce((s, q) => s + q, 0) : 0;

  // Resumo por pessoa e origem, com as notas.
  const resumo = useMemo(() => {
    if (!analise) return [];
    const m = new Map<string, { pessoa: string; origem: Origem; notas: number[]; total: number }>();
    for (const n of analise.novas) {
      const k = `${n.pessoa_id}|${n.origem}`;
      if (!m.has(k)) m.set(k, { pessoa: nomePessoa.get(n.pessoa_id) ?? '—', origem: n.origem, notas: [0, 0, 0, 0, 0], total: 0 });
      const r = m.get(k)!; r.notas[n.nota - 1]++; r.total++;
    }
    return [...m.values()].sort((x, y) => x.origem.localeCompare(y.origem) || x.pessoa.localeCompare(y.pessoa));
  }, [analise, nomePessoa]);

  /** Total por semana do ciclo, separado por canal. */
  const porSemana = useMemo(() => {
    const m = new Map<Origem, Map<string, number>>(CANAIS.map((c) => [c, new Map()]));
    for (const n of analise?.novas ?? []) {
      const k = `${mesDeCompetencia(n.data)}|${semanaDoCiclo(n.data)}`;
      const s = m.get(n.origem)!;
      s.set(k, (s.get(k) ?? 0) + 1);
    }
    return m;
  }, [analise]);

  return (
    <Cartao titulo="Importar avaliações">
      <p className="mb-4 text-sm text-slate-600">
        Relatório de atendimentos do Hub (<code>.xlsx</code>). Entram só as avaliações com nota de 1 a 5:
        os setores <strong>Expansão</strong> e <strong>Diretores-Expansão</strong> são contados
        separadamente, mesmo para quem atende os dois. Avaliação com a mesma data e protocolo de uma já importada é ignorada.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Arquivo</span>
          <input
            type="file" accept=".xlsx" disabled={!!ocupado}
            onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </label>
        {abasValidas.length > 1 && (
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Aba</span>
            <select
              value={aba} disabled={!!ocupado}
              onChange={async (e) => { setAba(e.target.value); await analisar(abas!, e.target.value); }}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              {abasValidas.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>

      {ocupado && <p className="mt-4 text-sm text-slate-500">{ocupado}</p>}
      {erro && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>
      )}
      {sucesso && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{sucesso}</p>
      )}

      {analise && (
        <div className="mt-5 space-y-5 border-t border-slate-100 pt-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Formato', analise.formato === 'hub' ? 'Hub' : 'Huggy (e-mail)'],
              ['Período', analise.periodo ? `${formatarData(analise.periodo[0])} a ${formatarData(analise.periodo[1])}` : '—'],
              ['Linhas lidas', analise.lidas],
              ['Sem avaliação', analise.semNota],
              ['Duplicadas / já importadas', analise.duplicadasNoArquivo + analise.jaImportadas],
              ['Novas', analise.novas.length],
            ].map(([rotulo, valor]) => (
              <div key={String(rotulo)} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                <dt className="text-xs text-slate-500">{rotulo}</dt>
                <dd className="font-semibold tabular-nums text-slate-800">{valor}</dd>
              </div>
            ))}
          </dl>

          {analise.semData > 0 && (
            <p className="text-xs text-slate-500">{analise.semData} avaliação(ões) sem data foram ignoradas.</p>
          )}

          {analise.semVinculo.size > 0 && (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
              <p className="font-semibold">
                {semVinculoTotal} avaliação(ões) ficarão de fora — {analise.formato === 'hub' ? 'nome' : 'e-mail'} sem pessoa vinculada
              </p>
              <p className="mt-1">
                {[...analise.semVinculo].map(([n, q]) => `${n} (${q})`).join(', ')}.
              </p>
              <p className="mt-1 text-xs">
                As demais são importadas normalmente.
                {analise.formato === 'hub' && ' Para incluir estas depois, cadastre o "Nome no Hub" em Configuração e importe o mesmo arquivo de novo — só as que faltaram entram.'}
              </p>
            </div>
          )}

          {bloqueado && (
            <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-600/20">
              <p className="font-semibold">Importação bloqueada</p>
              <p className="mt-1">
                Setores desconhecidos: {[...analise.setoresDesconhecidos].map(([n, q]) => `${n} (${q})`).join(', ')}.
                Confira se é o relatório certo.
              </p>
            </div>
          )}

          {/* Um bloco por canal: quem atende os dois aparece nos dois, com os
              números separados. A Tabela tem margem negativa para encostar nas
              bordas do cartão; o py-5 devolve o espaço, senão o texto seguinte
              sobe por cima da última linha. */}
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
                  <p className="px-4 py-4 text-sm text-slate-500">Nenhuma avaliação deste canal no arquivo.</p>
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

          <button
            type="button" onClick={importar}
            disabled={!!ocupado || bloqueado || analise.novas.length === 0}
            className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40"
          >
            {analise.novas.length ? `Importar ${analise.novas.length} avaliações` : 'Nada novo para importar'}
          </button>
        </div>
      )}
    </Cartao>
  );
}
