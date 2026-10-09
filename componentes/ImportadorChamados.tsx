'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro } from '@/componentes/ui';
import { mesRotulo } from '@/lib/formatar';
import { dataHoraDoExcel, lerPlanilha, type Linha } from '@/lib/xlsx-navegador';

/** Coluna do ELO → campo do chamado. O nome da coluna é o do cabeçalho. */
const COLUNAS: Record<string, string> = {
  'Protocolo': 'protocolo',
  'Título': 'titulo',
  'Categoria': 'categoria',
  'Status': 'status',
  'Prioridade': 'prioridade',
  'Aberto por': 'aberto_por',
  'Responsável': 'responsavel',
  'Data de abertura': 'aberto_em',
  'Data de conclusão': 'concluido_em',
  'Aberto no ClickUp': 'aberto_clickup_em',
  'Tempo (dias úteis)': 'tempo_util',
  'Tempo interno (dias úteis)': 'tempo_interno',
  'Tempo do TI (dias úteis)': 'tempo_ti',
  'Motivo do atraso': 'motivo_atraso',
  'Observação': 'observacao',
};
const OBRIGATORIAS = ['Protocolo', 'Status', 'Responsável', 'Data de abertura', 'Data de conclusão', 'Tempo (dias úteis)'];
const DATAS = new Set(['aberto_em', 'concluido_em', 'aberto_clickup_em']);
const NUMEROS = new Set(['tempo_util', 'tempo_interno', 'tempo_ti']);

type Chamado = Record<string, string | number | null>;
type Resultado = { novos: number; atualizados: number; sem_mudanca: number; sem_pessoa: number; meses: string[] | null; manuais: number };
type Conferencia = {
  novos: number; atualizados: number; sem_mudanca: number; sem_pessoa: number; de_mes_fechado: number;
  cancelados: number; em_aberto: number; resolvidos: number; no_prazo: number; atrasados: number;
  meses: string[] | null;
};

const meses = (m: string[] | null) => (m ?? []).slice().sort().map((x) => mesRotulo(x)).join(', ');
const s = (n: number) => (n === 1 ? '' : 's');

/** A aba "Chamados (260)" do ELO em linhas prontas para o banco. */
async function lerChamados(arquivo: File): Promise<Chamado[]> {
  const abas = await lerPlanilha(arquivo);
  // O número no nome da aba muda a cada exportação.
  const aba = [...abas.keys()].find((n) => /^chamados\b/i.test(n.trim()));
  if (!aba) throw new Error('O arquivo não tem a aba "Chamados". Use a exportação do painel ELO.');
  const [cabecalho, ...linhas] = abas.get(aba)!;
  const coluna = new Map(Object.entries(cabecalho).map(([letra, nome]) => [String(nome).trim(), letra]));
  const faltam = OBRIGATORIAS.filter((c) => !coluna.has(c));
  if (faltam.length) throw new Error(`Faltam colunas na aba "${aba}": ${faltam.join(', ')}.`);

  const chamados = linhas
    .filter((l: Linha) => l[coluna.get('Protocolo')!] !== undefined && l[coluna.get('Data de abertura')!] !== undefined)
    .map((l: Linha) => Object.fromEntries(Object.entries(COLUNAS).map(([nome, campo]): [string, string | number | null] => {
      const letra = coluna.get(nome);
      const v = letra ? l[letra] : undefined;
      if (v === undefined || v === '') return [campo, null];
      if (DATAS.has(campo)) return [campo, typeof v === 'number' ? dataHoraDoExcel(v) : null];
      if (NUMEROS.has(campo)) return [campo, Number(v)];
      return [campo, String(v).trim()];
    })));
  if (!chamados.length) throw new Error(`A aba "${aba}" está vazia.`);
  return chamados;
}

/**
 * Importação dos chamados do painel ELO (migrações 53 e 54), no modelo do
 * Hub, em três passos: escolher, conferir, importar. A planilha é lida aqui no
 * navegador (o Worker não tem CPU para isso); `conferir_chamados` compara com
 * o que já está no banco sem gravar, e só o botão Importar chama
 * `importar_chamados` — protocolo é a chave, o que mudou é atualizado.
 */
export default function ImportadorChamados() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [lidos, setLidos] = useState<Chamado[] | null>(null);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function conferir(f: File) {
    setErro(null); setResultado(null); setConferencia(null); setLidos(null);
    setArquivo(f.name); setOcupado(`Lendo ${f.name}…`);
    try {
      const chamados = await lerChamados(f);
      setOcupado(`Conferindo ${chamados.length} chamados…`);
      const { data, error } = await criarClienteNavegador().rpc('conferir_chamados', { p_linhas: chamados });
      if (error) throw new Error(error.message);
      setLidos(chamados);
      setConferencia(data as Conferencia);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setArquivo(null);
    } finally {
      setOcupado(null);
    }
  }

  async function importar() {
    if (!lidos) return;
    setErro(null); setOcupado(`Importando ${lidos.length} chamados…`);
    const { data, error } = await criarClienteNavegador().rpc('importar_chamados', { p_linhas: lidos });
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    setResultado(data as Resultado);
    setConferencia(null); setLidos(null);
    router.refresh();
  }

  function cancelar() {
    setConferencia(null); setLidos(null); setArquivo(null); setErro(null);
  }

  // Três passos, como no Hub: escolher, conferir, importar.
  const passo = resultado ? 3 : conferencia ? 2 : 1;
  const Passo = ({ n, rotulo }: { n: number; rotulo: string }) => (
    <span className={`flex items-center gap-2 text-sm ${n === passo && !resultado ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
      <b className={`grid h-6 w-6 place-items-center rounded-full text-xs ${n < passo || resultado
        ? 'bg-marca-600 text-white' : n === passo ? 'bg-slate-800 text-superficie' : 'bg-slate-100 text-slate-600'}`}>
        {n < passo || resultado ? '✓' : n}
      </b>
      {rotulo}
    </span>
  );
  const aImportar = conferencia ? conferencia.novos + conferencia.atualizados : 0;

  return (
    <Quadro titulo="Importar a exportação do ELO">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Passo n={1} rotulo="Escolher arquivo" />
        <span aria-hidden className="h-px w-7 bg-slate-300" />
        <Passo n={2} rotulo="Conferir" />
        <span aria-hidden className="h-px w-7 bg-slate-300" />
        <Passo n={3} rotulo="Importar" />
      </div>
      <p className="mb-4 text-sm text-slate-600">
        Lê a aba <strong>Chamados</strong> da exportação do painel ELO. O protocolo é a chave: chamado novo entra,
        chamado que já existe é atualizado só no que mudou. Nada é gravado antes de você conferir.
      </p>

      <label className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-slate-300
                        px-6 py-6 text-center text-sm text-slate-500 hover:border-marca-600">
        {arquivo
          ? <span><strong className="text-slate-800">{arquivo}</strong> · clique para trocar</span>
          : <span><strong className="text-slate-800">Escolha a exportação do painel ELO</strong> (.xlsx)</span>}
        <input type="file" accept=".xlsx" disabled={!!ocupado} className="sr-only"
               onChange={(e) => { const f = e.target.files?.[0]; if (f) conferir(f); e.target.value = ''; }} />
      </label>

      {ocupado && <p className="mt-4 text-sm text-slate-500">{ocupado}</p>}
      {erro && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}

      {conferencia && (
        <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
          <div className="grid gap-6 md:grid-cols-2">
            <dl className="grid grid-cols-[1fr_auto] content-start gap-y-1.5 text-sm tabular-nums">
              <dt className="col-span-2 mb-1 text-xs font-semibold text-slate-500">No arquivo</dt>
              <dt className="text-slate-600">Chamados novos</dt><dd className="text-right font-semibold">{conferencia.novos}</dd>
              <dt className="text-slate-600">Já existem e mudaram</dt><dd className="text-right font-semibold">{conferencia.atualizados}</dd>
              <dt className="text-slate-600">Já existem, sem mudança</dt><dd className="text-right">{conferencia.sem_mudanca}</dd>
            </dl>
            <dl className="grid grid-cols-[1fr_auto] content-start gap-y-1.5 text-sm tabular-nums">
              <dt className="col-span-2 mb-1 text-xs font-semibold text-slate-500">
                Na cota{conferencia.meses?.length ? ` · ${meses(conferencia.meses)}` : ''}
              </dt>
              <dt className="text-slate-600">Resolvidos que contam</dt><dd className="text-right font-semibold">{conferencia.resolvidos}</dd>
              <dt className="pl-3 text-slate-500">no prazo</dt><dd className="text-right">{conferencia.no_prazo}</dd>
              <dt className="pl-3 text-slate-500">fora do prazo, vão para a fila</dt><dd className="text-right">{conferencia.atrasados}</dd>
              <dt className="text-slate-600">Em aberto (contam quando resolverem)</dt><dd className="text-right">{conferencia.em_aberto}</dd>
              <dt className="text-slate-600">Cancelados (não contam)</dt><dd className="text-right">{conferencia.cancelados}</dd>
              {conferencia.de_mes_fechado > 0 && (
                <><dt className="text-slate-600">De mês já fechado (não mudam)</dt><dd className="text-right">{conferencia.de_mes_fechado}</dd></>
              )}
              <dt className="text-slate-600">Responsável fora da cota (redistribuição)</dt><dd className="text-right">{conferencia.sem_pessoa}</dd>
            </dl>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={importar} disabled={!!ocupado || aImportar === 0}
                    className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
              {aImportar ? `Importar ${aImportar} chamado${s(aImportar)}` : 'Nada novo para importar'}
            </button>
            <button onClick={cancelar} disabled={!!ocupado}
                    className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {!!resultado?.manuais && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20">
          Há {resultado.manuais} lançamento{s(resultado.manuais)} manua{resultado.manuais > 1 ? 'is' : 'l'} de chamados
          no mesmo mês: eles somam junto com o importado. Apague-os em Lançamentos para não contar em dobro.
        </p>
      )}
      {resultado && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
          Importado: {resultado.novos} novo{s(resultado.novos)} e {resultado.atualizados} atualizado{s(resultado.atualizados)}
          {resultado.meses?.length ? ` · cota refeita em ${meses(resultado.meses)}` : ''}.
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        A cota do Analista sai daqui: tratativas (fechados e recusados), no prazo (dentro de 2 dias úteis completos)
        e os atrasos que a gestão mantiver. Cancelados e chamados em aberto não contam. Mês já fechado não muda.
      </p>
    </Quadro>
  );
}
