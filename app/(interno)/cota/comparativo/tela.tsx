'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Link from '@/componentes/Link';
import Abas from '@/componentes/Abas';
import { AbasDeCanal, NoCanal, ProvedorDeCanal, type Canal } from '@/componentes/Canal';
import GraficoDeLinha, { type PontoDaLinha } from '@/componentes/GraficoDeLinha';
import GraficoBarrasELinha from '@/componentes/GraficoBarrasELinha';
import { Painel, Secao, Vazio } from '@/componentes/ui';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { percentual, numeroBR } from '@/lib/formatar';
import { fonteDaSituacao, type SituacaoDoResumo } from '@/lib/fonteDoMes';
import { todas } from '@/lib/consultas';
import { MONITORIAS_PADRAO, monitoriasPorSetor, setorDasPessoas, textoDoPiso } from '@/lib/monitoriasDoSetor';
import { faixasDeCsat, metaDoCsat, textoDaMeta, tomDoCsatPelaMeta } from '@/lib/filasDoSetor';
import { SERIES } from '@/lib/cores';
import AbasLocais from '@/componentes/AbasLocais';



type Tom = 'bom' | 'atencao' | 'ruim' | 'neutro';
type Categoria = 'pts' | 'csat' | 'vol' | 'tme' | 'mon';
/** Uma pessoa numa categoria: o valor de cada mês do período (null = sem dado). */
type Serie = { id: string; nome: string; valores: (number | null)[] };

const PERIODOS = [3, 6, 12];
/** O Comparativo começa aqui: antes de agosto/2026 o sistema não tinha dados —
 *  a não ser os meses importados das planilhas (migração 69), que adiantam o início. */
const PRIMEIRO_MES = '2026-08-01';
const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const inteiro = (v: number) => numeroBR(Math.round(v));
const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');
const media = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
const semNulos = (l: (number | null)[]) => l.filter((v): v is number => v != null);

/** Segundos → "12:34" ou "1h02". */
function tempo(seg: number) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.round(seg % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** '2026-09-01' → 'Set/26'. */
const rotuloMes = (c: string) => `${NOMES_MES[Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;

/** Os `n` meses até `fim`, do mais antigo ao mais recente. */
function mesesAte(fim: string, n: number) {
  const ano = Number(fim.slice(0, 4)), mes = Number(fim.slice(5, 7)) - 1;
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  });
}

const COR_CELULA: Record<Tom, string> = {
  bom: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300/90',
  atencao: 'bg-amber-500/10 text-amber-700 dark:text-amber-300/90',
  ruim: 'bg-rose-500/10 text-rose-700 dark:text-rose-300/90',
  neutro: 'text-slate-700',
};

/**
 * Comparativo entre meses (1.17.0): cada categoria mês a mês.
 *
 * O resto do painel compara com o mês anterior; aqui aparecem vários meses
 * lado a lado — a pergunta é "estamos melhorando?". Para cada categoria
 * (Pontuação, C-SAT, Volume, TME, Monitoria): um resumo do período, a linha
 * dos meses com a referência e, para quem vê o time, a tabela por atendente
 * com os meses nas colunas.
 *
 * O operador vê a própria evolução: as consultas respeitam a RLS, então os
 * dados já chegam só dele, e a tabela por atendente nem é montada. O Pleno,
 * por enquanto, também — ver a equipe aqui depende da migração 31.
 *
 * Pontuação de mês fechado sai do fechamento (o que foi entregue); de mês
 * aberto, do cálculo ao vivo — a mesma regra do extrato.
 */

/** O que a página (servidor) passa: só quem é e qual mês, sem consulta pesada. */
export type EntradaDoComparativo = {
  n?: string;
  cat?: string;
  perfil: { id: string; papel: string };
  /** A competência padrão (resolverCompetencia). */
  fim: string;
  /** A situação do resumo (migração 58), para escolher resumo ou cálculo ao vivo. */
  situacoes: SituacaoDoResumo[];
  /** O setor escolhido no menu (cookie). */
  setorPedido?: string;
};

/**
 * As consultas do Comparativo, pelo navegador (4.1.0, erro 1102): montar esta
 * tela no servidor da Cloudflare era das mais pesadas do plano gratuito. As
 * mesmas consultas, com a mesma regra de acesso (RLS) da sessão de quem vê.
 */
async function carregar(db: SupabaseClient, { n, perfil, fim, situacoes, setorPedido }: EntradaDoComparativo) {
  // O mês importado mais antigo (1.52.0). Antes da migração 69 a tabela não
  // existe e a consulta volta vazia, sem derrubar a tela.
  // Sai junto com o piso da monitoria: o do setor de quem vê (Monitorias 6.0; a Expansão: 85%).
  const [importado, porSetorMon, setorNoMes] = await Promise.all([
    db.from('importacoes_mes').select('mes_competencia').order('mes_competencia').limit(1).maybeSingle()
      .then((r) => (r.data as { mes_competencia: string } | null)?.mes_competencia ?? null),
    monitoriasPorSetor(db), setorDasPessoas(db, fim),
  ]);
  const inicio = importado && importado < PRIMEIRO_MES ? importado : PRIMEIRO_MES;
  const periodo = PERIODOS.includes(Number(n)) ? Number(n) : 6;
  const veOTime = perfil.papel !== 'operador';
  const pisoMon = porSetorMon.get(setorNoMes.get(perfil.id) ?? 1)?.piso ?? MONITORIAS_PADRAO.piso;
  // Só a partir de agosto/2026, o primeiro mês com dados do sistema (decisão
  // do gestor, 14/10/2026): os meses antes disso apareciam como "sem dado" e
  // custavam ~1 s de cálculo ao vivo.
  const meses = mesesAte(fim, periodo).filter((m) => m >= inicio);
  const de = meses[0];

  // Aba Volume (3.9.0): as filas do setor escolhido no menu e o volume da Sol
  // (migração 99). Vale para qualquer setor da árvore, pelo número da fila.
  const [filasDb, setoresDb, setorEscolhido, solDb] = await todas([
    db.from('canais_do_setor').select('id, apelido, nome, ordem, setor_id, grupo_csat').eq('ativo', true).order('ordem').then((r) => r.data ?? []),
    db.from('setores').select('id').eq('ativo', true).order('ordem').then((r) => r.data ?? []),
    Promise.resolve(setorPedido),
    veOTime ? db.from('volume_ia').select('setor_id, mes_competencia, semana, total, resolvidos_ia')
      .gte('mes_competencia', de).lte('mes_competencia', fim).then((r) => r.data ?? []) : Promise.resolve([]),
  ]);
  const setorDaAba = (setoresDb as { id: number }[]).find((x) => String(x.id) === setorEscolhido)?.id
    ?? (setoresDb as { id: number }[])[0]?.id ?? 1;
  const filasDoSetor = (filasDb as { id: number; apelido: string | null; nome: string; setor_id?: number }[])
    .filter((f) => f.apelido && (f.setor_id ?? 1) === setorDaAba) as { id: number; apelido: string; nome: string }[];
  // A Sol é do setor inteiro (a resolução da IA não sai por canal).
  const todoSol = (solDb as LinhaSol[]).filter((x) => x.setor_id === setorDaAba);
  const [pessoas, fechados, csat, volume, monitorias, lancados, presenciais, chamados] = await todas([
    db.from('pessoas').select('id, nome, exibir_no_painel, conta_nas_medias'),
    db.from('fechamentos_cota').select('pessoa_id, mes_competencia, resultado, meta')
      .gte('mes_competencia', de).lte('mes_competencia', fim),
    db.from('vw_csat_semanal').select('pessoa_id, origem, mes_competencia, avaliacoes, positivas')
      .gte('mes_competencia', de).lte('mes_competencia', fim),
    db.from('volume_semanal').select('pessoa_id, canal, mes_competencia, finalizados, tme_seg')
      .gte('mes_competencia', de).lte('mes_competencia', fim),
    db.from('vw_monitorias').select('operador_id, mes_referencia, nota_final')
      .gte('mes_referencia', de).lte('mes_referencia', fim),
    // Só os meses com lançamento, presencial e chamado: com volume, C-SAT e
    // monitorias, dizem quais meses têm algo para calcular (1.41.2).
    db.from('lancamentos').select('mes_competencia').gte('mes_competencia', de).lte('mes_competencia', fim),
    db.from('vw_presenciais').select('mes_competencia').gte('mes_competencia', de).lte('mes_competencia', fim),
    db.from('chamados_elo').select('mes_competencia').gte('mes_competencia', de).lte('mes_competencia', fim),
  ]);

  // Meses sem fechamento nenhum: a pontuação vem do cálculo ao vivo.
  type Ponto = { pessoa_id: string; mes_competencia: string; resultado: number; meta: number | null };
  const doFechamento = (fechados.data ?? []) as Ponto[];
  const abertos = meses.filter((m) => !doFechamento.some((f) => f.mes_competencia === m));
  // Os que estão no resumo do mês (migração 58) saem dele; os demais, da view
  // — mas só se o mês tem algum dado de origem. Maio a julho/2026, antes do
  // sistema, iam ao cálculo ao vivo (~1 s) para voltar vazios (1.41.2).
  const comDado = new Set([
    ...((csat.data ?? []) as { mes_competencia: string }[]).map((x) => x.mes_competencia),
    ...((volume.data ?? []) as { mes_competencia: string }[]).map((x) => x.mes_competencia),
    ...((monitorias.data ?? []) as { mes_referencia: string }[]).map((x) => x.mes_referencia),
    ...[lancados, presenciais, chamados].flatMap((r) => ((r.data ?? []) as { mes_competencia: string }[])
      .map((x) => x.mes_competencia)),
  ]);
  const fontes = abertos.map((m) => fonteDaSituacao(situacoes, m));
  const doResumo = abertos.filter((_, i) => fontes[i].resumo);
  const daView = abertos.filter((m, i) => !fontes[i].resumo && comDado.has(m));
  const [{ data: resumidos }, { data: aoVivo }] = await todas([
    doResumo.length
      ? db.from('resumo_cota_mensal').select('pessoa_id, mes_competencia, resultado, meta').in('mes_competencia', doResumo)
      : Promise.resolve({ data: [] }),
    daView.length
      ? db.from('vw_cota_mensal').select('pessoa_id, mes_competencia, resultado, meta').in('mes_competencia', daView)
      : Promise.resolve({ data: [] }),
  ]);
  const pontuacoes = [...doFechamento, ...((resumidos ?? []) as Ponto[]), ...((aoVivo ?? []) as Ponto[])];

  // 4.4.0: só quem está no setor da tela (antes vinham os de todos os setores)
  // e a meta de C-SAT da faixa dele (Expansão 95%, Telecom 94%).
  const doSetor = (id: string) => (setorNoMes.get(id) ?? 1) === setorDaAba;
  const filtra = <T extends { data: unknown }>(r: T, campo: string): T =>
    ({ ...r, data: ((r.data ?? []) as Record<string, unknown>[]).filter((x) => doSetor(String(x[campo]))) });
  const faixas = await faixasDeCsat(db, (filasDb as { setor_id?: number; grupo_csat?: string | null }[])
    .filter((f) => (f.setor_id ?? 1) === setorDaAba).map((f) => f.grupo_csat ?? null));
  const metaCsat = metaDoCsat(Object.values(faixas)[0]);
  return { inicio, periodo, veOTime, pisoMon, meses, de, filasDoSetor, todoSol, metaCsat,
    pessoas: filtra(pessoas, 'id'), csat: filtra(csat, 'pessoa_id'), volume: filtra(volume, 'pessoa_id'),
    monitorias: filtra(monitorias, 'operador_id'), pontuacoes: pontuacoes.filter((p) => doSetor(p.pessoa_id)) };
}

type Dados = Awaited<ReturnType<typeof carregar>>;

export default function TelaComparativo(entrada: EntradaDoComparativo) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const { n, perfil, fim, setorPedido } = entrada;
  const chave = JSON.stringify(entrada.situacoes);

  useEffect(() => {
    let vivo = true;
    const db = criarClienteNavegador();
    const ler = () => carregar(db, entrada)
      .then((d) => { if (vivo) { setDados(d); setErro(null); } })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    ler();
    // A atualização automática (4.0.0) avisa quando algo mudou no banco.
    window.addEventListener('dados-mudaram', ler);
    return () => { vivo = false; window.removeEventListener('dados-mudaram', ler); };
  }, [n, perfil.id, perfil.papel, fim, setorPedido, chave]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro && !dados) {
    return (
      <Painel>
        <p className="text-sm text-rose-700">Não foi possível carregar o Comparativo: {erro}</p>
        <button type="button" onClick={() => location.reload()}
                className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:border-marca-600">
          Tentar de novo
        </button>
      </Painel>
    );
  }
  if (!dados) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Carregando o Comparativo">
        <div className="h-24 animate-pulse rounded-[22px] bg-slate-200/60" />
        <div className="h-10 w-96 animate-pulse rounded-xl bg-slate-200/60" />
        <div className="h-80 animate-pulse rounded-2xl bg-slate-200/60" />
      </div>
    );
  }
  return <Visao entrada={entrada} dados={dados} />;
}

function Visao({ entrada: { cat, fim }, dados }: { entrada: EntradaDoComparativo; dados: Dados }) {
  const { periodo, veOTime, pisoMon, meses, de, filasDoSetor, todoSol, metaCsat, pessoas, csat, volume, monitorias, pontuacoes } = dados;
  // As filas do setor da tela (4.4.0), no lugar das duas da Expansão.
  const CANAIS: Canal[] = filasDoSetor.map((f) => f.apelido);
  const nomeDaFilaC = (c: string) => filasDoSetor.find((f) => f.apelido === c)?.nome ?? c;
  const meta = { valor: metaCsat, rotulo: `meta ${textoDaMeta(metaCsat)}` };

  const nome = new Map((pessoas.data ?? []).map((p) => [p.id as string, nomeCurto(p.nome as string)]));
  // As mesmas duas decisões da tela inicial: aparecer na lista e entrar na média.
  const naoExibe = new Set((pessoas.data ?? []).filter((p) => p.exibir_no_painel === false).map((p) => p.id as string));
  const naoConta = new Set((pessoas.data ?? []).filter((p) => p.conta_nas_medias === false).map((p) => p.id as string));
  const exibe = (id: string) => !naoExibe.has(id);
  const conta = (id: string) => !naoConta.has(id);

  const todoCsat = (csat.data ?? []) as { pessoa_id: string; origem: Canal; mes_competencia: string; avaliacoes: number; positivas: number }[];
  const todoVolume = (volume.data ?? []) as { pessoa_id: string; canal: Canal; mes_competencia: string; finalizados: number; tme_seg: number | null }[];
  const todasNotas = ((monitorias.data ?? []) as { operador_id: string; mes_referencia: string; nota_final: number }[])
    .filter((m) => m.nota_final != null);

  /** Uma série por pessoa, a partir de uma função que dá o valor dela num mês. */
  const series = (ids: string[], valor: (id: string, m: string) => number | null): Serie[] =>
    [...new Set(ids)].filter(exibe).map((id) => ({ id, nome: nome.get(id) ?? '—', valores: meses.map((m) => valor(id, m)) }))
      .filter((s) => s.valores.some((v) => v != null))
      .sort((a, b) => (b.valores.at(-1) ?? -Infinity) - (a.valores.at(-1) ?? -Infinity));

  // ------------------------------------------------------------ Pontuação
  const pontoDe = (id: string, m: string) => pontuacoes.find((p) => p.pessoa_id === id && p.mes_competencia === m);
  const seriesPts = series(pontuacoes.map((p) => p.pessoa_id), (id, m) => {
    const p = pontoDe(id, m); return p ? Number(p.resultado) : null;
  });
  const equipePts = meses.map((m) => media(pontuacoes.filter((p) => p.mes_competencia === m && p.meta && conta(p.pessoa_id))
    .map((p) => Number(p.resultado))));
  const metaDe = (id: string, m: string) => { const p = pontoDe(id, m); return p?.meta ? Number(p.meta) : null; };
  const metaGeral = pontuacoes.find((p) => p.meta)?.meta ?? null;
  const naMetaNoFim = pontuacoes.filter((p) => p.mes_competencia === fim && p.meta && conta(p.pessoa_id));

  // Os dados são indexados uma vez, por pessoa e mês (e canal), e a equipe
  // somada junto. Filtrar a lista inteira para cada pessoa e mês estourava o
  // limite de processamento do Worker em 12 meses.
  const EQUIPE = '*';
  // Todos, sem a regra de quem entra nas médias: os totais da aba Geral
  // (3.7.0) são o panorama do que aconteceu, e toda avaliação conta.
  const TODOS = '**';
  type Acumulado = { positivas: number; avaliacoes: number; finalizados: number; volumes: number; tmes: number[]; notas: number[] };
  const indice = new Map<string, Acumulado>();
  const acumular = (chave: string) => {
    let a = indice.get(chave);
    if (!a) { a = { positivas: 0, avaliacoes: 0, finalizados: 0, volumes: 0, tmes: [], notas: [] }; indice.set(chave, a); }
    return a;
  };
  const em = (quem: string, c: string, m: string) => `${quem}|${c}|${m}`;
  for (const x of todoCsat) {
    for (const quem of conta(x.pessoa_id) ? [x.pessoa_id, EQUIPE, TODOS] : [x.pessoa_id, TODOS]) {
      const a = acumular(em(quem, x.origem, x.mes_competencia));
      a.positivas += x.positivas; a.avaliacoes += x.avaliacoes;
    }
  }
  for (const x of todoVolume) {
    for (const quem of conta(x.pessoa_id) ? [x.pessoa_id, EQUIPE, TODOS] : [x.pessoa_id, TODOS]) {
      const a = acumular(em(quem, x.canal, x.mes_competencia));
      a.finalizados += x.finalizados; a.volumes += 1;
      if ((x.tme_seg ?? 0) > 0) a.tmes.push(Number(x.tme_seg));
    }
  }
  for (const x of todasNotas) {
    for (const quem of conta(x.operador_id) ? [x.operador_id, EQUIPE] : [x.operador_id]) {
      acumular(em(quem, '-', x.mes_referencia)).notas.push(Number(x.nota_final));
    }
  }
  const csatDe = (c: Canal, quem: string, m: string) => {
    const a = indice.get(em(quem, c, m)); return a?.avaliacoes ? a.positivas / a.avaliacoes : null;
  };
  const volDe = (c: Canal, quem: string, m: string) => {
    const a = indice.get(em(quem, c, m)); return a?.volumes ? a.finalizados : null;
  };
  // TME como a regra usa: média simples dos TMEs lançados.
  const tmeDe = (c: Canal, quem: string, m: string) => media(indice.get(em(quem, c, m))?.tmes ?? []);
  const notaDe = (quem: string, m: string) => media(indice.get(em(quem, '-', m))?.notas ?? []);

  // ------------------------------------------------------------- montagem
  // 4.7.0: a cor pela meta do setor (no Expansão, 90% e 85% como antes).
  const tomDoCsat = (v: number): Tom => tomDoCsatPelaMeta(v, metaCsat);
  const tomDaNota = (v: number): Tom => (v >= pisoMon ? 'bom' : v >= 0.70 ? 'atencao' : 'ruim');
  const TOM_LINHA = { bom: 'bom', atencao: 'atencao', ruim: 'ruim', neutro: 'bom' } as const;

  /** Variação do último mês contra o anterior, no formato de cada categoria. */
  const variacao = (k: Categoria, atual: number | null, antes: number | null) => {
    if (atual == null || antes == null) return null;
    const d = atual - antes;
    const s = d >= 0 ? '▲' : '▼';
    const texto = k === 'csat' || k === 'mon' ? `${s} ${numeroBR(Math.abs(d) * 100, 1)} pt`
      : k === 'tme' ? `${s} ${tempo(Math.abs(d))}`
        : `${s} ${antes ? numeroBR(Math.abs(d / antes) * 100, 1) : '—'}%`;
    // TME: subir é piorar.
    return { texto, melhor: k === 'tme' ? d <= 0 : d >= 0 };
  };

  const Vista = ({ k, equipe, pessoas: lista, formatar, tom, referencia, min, max, titulo, subtitulo, resumoExtra }: {
    k: Categoria;
    equipe: (number | null)[];
    pessoas: Serie[];
    formatar: (v: number) => string;
    tom: (v: number, i: number, id?: string) => Tom;
    referencia?: { valor: number; rotulo: string };
    min?: number; max?: number;
    titulo: string; subtitulo: string;
    resumoExtra?: { rotulo: string; valor: string };
  }) => {
    const valores = semNulos(equipe);
    if (!valores.length) return <Painel><Secao><Vazio>Sem dados neste período.</Vazio></Secao></Painel>;
    const ultimo = equipe.at(-1) ?? null;
    const v = variacao(k, ultimo, equipe.at(-2) ?? null);
    const maiorMelhor = k !== 'tme';
    const iMelhor = equipe.reduce<number>((m, x, i) => x != null && (equipe[m] == null
      || (maiorMelhor ? x > equipe[m]! : x < equipe[m]!)) ? i : m, 0);
    const quem = veOTime ? (k === 'vol' ? 'Equipe' : 'Média da equipe') : 'Você';
    const resumo = [
      ...(resumoExtra ? [resumoExtra] : []),
      { rotulo: `${quem} em ${rotuloMes(fim)}`, valor: ultimo != null ? formatar(ultimo) : '—' },
      { rotulo: `Contra ${rotuloMes(meses.at(-2)!)}`, valor: v?.texto ?? '—', tom: v ? (v.melhor ? 'melhor' : 'pior') : undefined },
      { rotulo: `Média dos ${periodo} meses`, valor: formatar(media(valores)!) },
      { rotulo: 'Melhor mês do período', valor: `${rotuloMes(meses[iMelhor])} · ${formatar(equipe[iMelhor]!)}` },
    ].slice(0, 4);

    return (
      <div className="space-y-4">
        {/* Os números do período numa faixa só, dividida por linhas finas (visual 3.0). */}
        <div className="grid divide-y divide-slate-200 rounded-[20px] border border-slate-200 bg-superficie shadow-sm sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
          {resumo.map((r) => (
            <div key={r.rotulo} className="px-6 py-5">
              <p className="text-sm text-slate-500">{r.rotulo}</p>
              {'tom' in r && r.tom ? (
                <p className="mt-1.5">
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xl font-semibold tracking-tight tabular-nums ${
                    r.tom === 'melhor' ? 'bg-emerald-500/10 text-marca-700 dark:text-marca-400' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'}`}>{r.valor}</span>
                </p>
              ) : (
                <p className="mt-1 text-[1.65rem] font-semibold tracking-tight tabular-nums text-slate-900">{r.valor}</p>
              )}
            </div>
          ))}
        </div>

        <Painel>
          <Secao titulo={veOTime ? titulo : titulo.replace('da equipe', 'sua')} subtitulo={subtitulo}>
            {/* O SVG estica até a largura do quadro, que aqui é a tela inteira:
                com 640 de base, textos e pontos ficavam mais que o dobro do
                tamanho. Com base próxima da largura real, a escala fica perto
                de 1. */}
            <GraficoDeLinha largura={Math.max(1400, meses.length * 120)} rotulos={meses.map(rotuloMes)}
                            formatar={formatar} referencia={referencia} min={min} max={max}
                            pontos={equipe.map((x, i): PontoDaLinha => x == null ? null : { valor: x, tom: TOM_LINHA[tom(x, i)] })} />
          </Secao>
        </Painel>

        {veOTime && (
          <Painel>
            <Secao titulo="Por atendente"
                   subtitulo="Os meses nas colunas; a variação compara o mês mais recente com o anterior. O link no fim da linha abre o detalhe da pessoa nesta categoria.">
              {lista.length === 0 ? <Vazio>Ninguém com dado neste período.</Vazio> : (
                <div className="-mx-6 overflow-x-auto sm:-mx-7">
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="text-xs text-slate-500">
                        <th className="py-2.5 pl-6 pr-3 text-left font-medium sm:pl-7">Pessoa</th>
                        {meses.map((m, i) => (
                          <th key={m} className={`px-2 py-2.5 text-right ${i === meses.length - 1 ? 'font-semibold text-slate-800' : 'font-medium'}`}>{rotuloMes(m)}</th>
                        ))}
                        <th className="px-3 py-2.5 text-right font-medium">Variação</th>
                        <th className="py-2.5 pl-3 pr-6 sm:pr-7"><span className="sr-only">Histórico</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((p) => {
                        const vp = variacao(k, p.valores.at(-1) ?? null, p.valores.at(-2) ?? null);
                        return (
                          <tr key={p.id} className="border-t border-slate-100 transition-colors hover:bg-slate-50">
                            <td className="whitespace-nowrap py-2 pl-6 pr-3 font-medium text-slate-800 sm:pl-7">{p.nome}</td>
                            {p.valores.map((x, i) => (
                              <td key={i} className="px-2 py-2 text-right">
                                {x == null ? <span className="text-slate-300">—</span> : (
                                  <span className={`inline-block min-w-16 rounded-full px-2.5 py-0.5 ${COR_CELULA[tom(x, i, p.id)]} ${
                                    i === p.valores.length - 1 ? 'font-semibold' : ''}`}>{formatar(x)}</span>
                                )}
                              </td>
                            ))}
                            <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${
                              !vp ? 'text-slate-300' : vp.melhor ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700'}`}>
                              {vp?.texto ?? '—'}
                            </td>
                            <td className="whitespace-nowrap py-2 pl-3 pr-6 text-right sm:pr-7">
                              {/* O link leva ao detalhe da própria categoria: as
                                  monitorias do atendente, o extrato (semana a
                                  semana) ou o histórico da cota. */}
                              {k === 'mon' ? (
                                <Link href={`/cota/monitorias?pessoa=${p.id}`}
                                      className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-marca-600">
                                  monitorias ›
                                </Link>
                              ) : (
                                <Link href={k === 'pts' ? `/cota/historico?pessoa=${p.id}` : `/cota/extrato?pessoa=${p.id}&mes=${fim.slice(0, 7)}`}
                                      className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-marca-600">
                                  {k === 'pts' ? 'histórico ›' : 'extrato ›'}
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-slate-200 font-semibold text-slate-900">
                        <td className="py-2 pl-6 pr-3 sm:pl-7">{k === 'vol' ? 'Equipe (soma)' : 'Equipe (média)'}</td>
                        {equipe.map((x, i) => <td key={i} className="px-2 py-2 text-right">{x == null ? '—' : formatar(x)}</td>)}
                        <td colSpan={2} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Secao>
          </Painel>
        )}
      </div>
    );
  };

  /** Categoria por canal: as abas de canal ficam dentro dela, onde fazem sentido. */
  const porCanal = (conteudo: (c: Canal) => React.ReactNode) => (
    <div className="space-y-4">
      <AbasDeCanal naSuperficie />
      {CANAIS.map((c) => <NoCanal key={c} canal={c}>{conteudo(c)}</NoCanal>)}
    </div>
  );

  const ids = (l: { pessoa_id: string }[]) => l.map((x) => x.pessoa_id);

  // ---------------------------------------------------------- Geral (3.7.0)
  // Tudo junto, mês a mês: atendimentos lançados (todas as filas) ×
  // avaliações, a taxa de avaliação, C-SAT, monitoria e pontuação. Os mesmos
  // números das outras abas, somados entre as filas.
  const filasNosDados = [...new Set<string>([...todoCsat.map((x) => x.origem), ...todoVolume.map((x) => x.canal)])];
  type Geral = { atendimentos: number; avaliacoes: number; positivas: number };
  const geralDe = (quem: string, m: string): Geral => {
    const g = { atendimentos: 0, avaliacoes: 0, positivas: 0 };
    for (const c of filasNosDados) {
      const a = indice.get(em(quem, c, m));
      if (a) { g.atendimentos += a.finalizados; g.avaliacoes += a.avaliacoes; g.positivas += a.positivas; }
    }
    return g;
  };
  const taxaDe = (g: Geral) => (g.atendimentos ? g.avaliacoes / g.atendimentos : null);
  const csatDoGeral = (g: Geral) => (g.avaliacoes ? g.positivas / g.avaliacoes : null);
  const geralEquipe = meses.map((m) => geralDe(TODOS, m));
  const notaEquipe = meses.map((m) => notaDe(EQUIPE, m));
  const monitoriasNoMes = meses.map((m) => indice.get(em(EQUIPE, '-', m))?.notas.length ?? 0);
  const iFim = meses.length - 1;
  const tilesGeral: { rotulo: string; valor: string; v: ReturnType<typeof variacao> }[] = [
    { rotulo: 'Atendimentos lançados', valor: inteiro(geralEquipe[iFim].atendimentos),
      v: variacao('vol', geralEquipe[iFim].atendimentos || null, geralEquipe[iFim - 1]?.atendimentos || null) },
    { rotulo: 'Avaliações', valor: inteiro(geralEquipe[iFim].avaliacoes),
      v: variacao('vol', geralEquipe[iFim].avaliacoes || null, geralEquipe[iFim - 1]?.avaliacoes || null) },
    { rotulo: 'Taxa de avaliação', valor: taxaDe(geralEquipe[iFim]) == null ? '—' : percentual(taxaDe(geralEquipe[iFim])!),
      v: variacao('csat', taxaDe(geralEquipe[iFim]), iFim ? taxaDe(geralEquipe[iFim - 1]) : null) },
    { rotulo: 'C-SAT (todas as filas)', valor: csatDoGeral(geralEquipe[iFim]) == null ? '—' : percentual(csatDoGeral(geralEquipe[iFim])!),
      v: variacao('csat', csatDoGeral(geralEquipe[iFim]), iFim ? csatDoGeral(geralEquipe[iFim - 1]) : null) },
    { rotulo: 'Nota de monitoria', valor: notaEquipe[iFim] == null ? '—' : percentual(notaEquipe[iFim]!),
      v: variacao('mon', notaEquipe[iFim], notaEquipe[iFim - 1] ?? null) },
    { rotulo: veOTime ? 'Pontuação média' : 'Sua pontuação', valor: equipePts[iFim] == null ? '—' : inteiro(equipePts[iFim]!),
      v: variacao('pts', equipePts[iFim], equipePts[iFim - 1] ?? null) },
  ];
  // As linhas do quadro mês a mês: o valor de cada mês já formatado.
  const linhasGeral: { rotulo: string; valores: (string | null)[]; tom?: (i: number) => Tom; destaque?: boolean }[] = [
    { rotulo: 'Atendimentos lançados', valores: geralEquipe.map((g) => (g.atendimentos ? inteiro(g.atendimentos) : null)), destaque: true },
    ...filasNosDados.map((c) => ({
      rotulo: `· ${nomeDaFilaC(c)}`,
      valores: meses.map((m) => { const v = volDe(c as Canal, TODOS, m); return v ? inteiro(v) : null; }),
    })),
    { rotulo: 'Avaliações', valores: geralEquipe.map((g) => (g.avaliacoes ? inteiro(g.avaliacoes) : null)), destaque: true },
    { rotulo: 'Taxa de avaliação', valores: geralEquipe.map((g) => (taxaDe(g) == null ? null : percentual(taxaDe(g)!))) },
    { rotulo: 'C-SAT', valores: geralEquipe.map((g) => (csatDoGeral(g) == null ? null : percentual(csatDoGeral(g)!))),
      tom: (i) => (csatDoGeral(geralEquipe[i]) == null ? 'neutro' : tomDoCsat(csatDoGeral(geralEquipe[i])!)) },
    { rotulo: 'Notas 1 a 3', valores: geralEquipe.map((g) => (g.avaliacoes ? inteiro(g.avaliacoes - g.positivas) : null)) },
    { rotulo: 'Monitorias', valores: monitoriasNoMes.map((n) => (n ? inteiro(n) : null)) },
    { rotulo: 'Nota de monitoria', valores: notaEquipe.map((v) => (v == null ? null : percentual(v))),
      tom: (i) => (notaEquipe[i] == null ? 'neutro' : tomDaNota(notaEquipe[i]!)) },
    { rotulo: veOTime ? 'Pontuação média' : 'Pontuação', valores: equipePts.map((v) => (v == null ? null : inteiro(v))), destaque: true },
  ];
  // A ficha do mês mais recente, por atendente: tudo numa linha.
  const fichas = !veOTime ? [] : [...new Set([...todoVolume, ...todoCsat].filter((x) => x.mes_competencia === fim).map((x) => x.pessoa_id)
    .concat(pontuacoes.filter((p) => p.mes_competencia === fim).map((p) => p.pessoa_id)))]
    .filter(exibe)
    .map((id) => {
      const g = geralDe(id, fim);
      const p = pontoDe(id, fim);
      return { id, nome: nome.get(id) ?? '—', g, nota: notaDe(id, fim), monitorias: indice.get(em(id, '-', fim))?.notas.length ?? 0,
               pontos: p ? Number(p.resultado) : null, meta: p?.meta ? Number(p.meta) : null };
    })
    .filter((f) => f.g.atendimentos || f.g.avaliacoes || f.pontos != null)
    .sort((a, b) => (b.pontos ?? -1) - (a.pontos ?? -1));

  const geral = (
    <div className="space-y-4">
      <div className="grid divide-y divide-slate-200 rounded-[20px] border border-slate-200 bg-superficie shadow-sm sm:grid-cols-3 sm:divide-y-0 xl:grid-cols-6 xl:divide-x">
        {tilesGeral.map((t) => (
          <div key={t.rotulo} className="px-5 py-4">
            <p className="text-sm text-slate-500">{t.rotulo}</p>
            <p className="mt-1 text-[1.5rem] font-semibold tracking-tight tabular-nums text-slate-900">{t.valor}</p>
            <p className={`text-xs font-semibold tabular-nums ${!t.v ? 'text-slate-400' : t.v.melhor ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700 dark:text-rose-300'}`}>
              {t.v ? `${t.v.texto} contra ${rotuloMes(meses[iFim - 1])}` : 'sem o mês anterior'}
            </p>
          </div>
        ))}
      </div>

      {/* Gráficos no visual 3.0, cada série com a sua cor e legenda. */}
      <Painel>
        <Secao titulo="Atendimentos × avaliações" subtitulo="Barras: atendimentos lançados (todas as filas) e avaliações do Hub. Linha: a taxa de avaliação, no eixo da direita.">
          <GraficoBarrasELinha largura={Math.max(1400, meses.length * 120)} rotulos={meses.map(rotuloMes)}
                               formatar={inteiro} formatarDir={percentual} minDir={0}
                               barras={[
                                 { nome: 'Atendimentos', cor: 'var(--color-slate-400)', valores: geralEquipe.map((g) => g.atendimentos || null) },
                                 { nome: 'Avaliações', cor: SERIES[0], valores: geralEquipe.map((g) => g.avaliacoes || null) },
                               ]}
                               linhas={[{ nome: 'Taxa de avaliação', cor: SERIES[2], direita: true, valores: geralEquipe.map(taxaDe) }]} />
        </Secao>
      </Painel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Painel>
          <Secao titulo="Taxa de avaliação por fila" subtitulo="Quanto de cada fila foi avaliado: avaliações ÷ atendimentos.">
            <GraficoBarrasELinha largura={760} rotulos={meses.map(rotuloMes)} formatar={percentual} min={0}
                                 linhas={filasNosDados.map((c, k) => ({
                                   nome: nomeDaFilaC(c),
                                   cor: SERIES[k % SERIES.length],
                                   valores: meses.map((m) => {
                                     const a = indice.get(em(TODOS, c, m));
                                     // Sem avaliação importada no mês (planilhas antigas): sem dado, não 0%.
                                     return a?.finalizados && a.avaliacoes ? a.avaliacoes / a.finalizados : null;
                                   }),
                                 }))} />
          </Secao>
        </Painel>
        <Painel>
          <Secao titulo="C-SAT e monitoria" subtitulo={`C-SAT de todas as filas e a nota média de monitoria. Tracejada: a meta de ${textoDaMeta(metaCsat)}.`}>
            <GraficoBarrasELinha largura={760} rotulos={meses.map(rotuloMes)} formatar={percentual} min={0.7} max={1}
                                 referencia={meta}
                                 linhas={[
                                   { nome: 'C-SAT', cor: SERIES[0], valores: geralEquipe.map(csatDoGeral) },
                                   { nome: 'Monitoria', cor: SERIES[4], valores: notaEquipe },
                                 ]} />
          </Secao>
        </Painel>
      </div>

      <Painel>
        <Secao titulo="Mês a mês" subtitulo={veOTime ? 'A equipe em cada mês do período, com a cor da escala do painel em C-SAT e monitoria. Atendimentos, avaliações e C-SAT contam todo mundo; nota de monitoria e pontuação média seguem quem entra nas médias (na ficha da pessoa, em Usuários e setores).' : 'Você em cada mês do período.'}>
          <div className="-mx-6 overflow-x-auto sm:-mx-7">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="py-2.5 pl-6 pr-3 text-left font-medium sm:pl-7" />
                  {meses.map((m, i) => (
                    <th key={m} className={`px-3 py-2.5 text-right ${i === iFim ? 'font-semibold text-slate-800' : 'font-medium'}`}>{rotuloMes(m)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhasGeral.map((l) => (
                  <tr key={l.rotulo} className="border-t border-slate-100">
                    <td className={`whitespace-nowrap py-2 pl-6 pr-3 sm:pl-7 ${l.destaque ? 'font-semibold text-slate-900' : l.rotulo.startsWith('·') ? 'pl-9 text-slate-500 sm:pl-10' : 'font-medium text-slate-700'}`}>{l.rotulo}</td>
                    {l.valores.map((v, i) => (
                      <td key={i} className="px-3 py-2 text-right">
                        {v == null ? <span className="text-slate-300">—</span> : l.tom ? (
                          <span className={`inline-block min-w-14 rounded-full px-2 py-0.5 ${COR_CELULA[l.tom(i)]} ${i === iFim ? 'font-semibold' : ''}`}>{v}</span>
                        ) : <span className={i === iFim || l.destaque ? 'font-semibold text-slate-900' : 'text-slate-700'}>{v}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
      </Painel>

      {veOTime && (
        <Painel>
          <Secao titulo={`Por atendente em ${rotuloMes(fim)}`}
                 subtitulo="Tudo numa linha: atendimentos × avaliações, C-SAT, monitoria e pontos. O nome abre o C-SAT da pessoa.">
            {fichas.length === 0 ? <Vazio>Ninguém com dado no mês.</Vazio> : (
              <div className="-mx-6 overflow-x-auto sm:-mx-7">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-xs text-slate-500">
                      <th className="py-2.5 pl-6 pr-3 text-left font-medium sm:pl-7">Pessoa</th>
                      <th className="px-3 py-2.5 text-right font-medium">Atendimentos</th>
                      <th className="px-3 py-2.5 text-right font-medium">Avaliações</th>
                      <th className="px-3 py-2.5 text-right font-medium">Taxa</th>
                      <th className="px-3 py-2.5 text-right font-medium">C-SAT</th>
                      <th className="px-3 py-2.5 text-right font-medium">Notas 1–3</th>
                      <th className="px-3 py-2.5 text-right font-medium">Monitoria</th>
                      <th className="px-3 py-2.5 pr-6 text-right font-medium sm:pr-7">Pontos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fichas.map((f) => {
                      const c = csatDoGeral(f.g);
                      return (
                        <tr key={f.id} className="border-t border-slate-100 transition-colors hover:bg-slate-50">
                          <td className="whitespace-nowrap py-2 pl-6 pr-3 sm:pl-7">
                            <Link href={`/cota/csat?mes=${fim.slice(0, 7)}&pessoa=${f.id}`} className="font-medium text-slate-800 hover:text-marca-700 hover:underline dark:hover:text-marca-400">{f.nome}</Link>
                          </td>
                          <td className="px-3 py-2 text-right">{f.g.atendimentos ? inteiro(f.g.atendimentos) : '—'}</td>
                          <td className="px-3 py-2 text-right">{f.g.avaliacoes ? inteiro(f.g.avaliacoes) : '—'}</td>
                          <td className="px-3 py-2 text-right">{taxaDe(f.g) == null ? '—' : percentual(taxaDe(f.g)!)}</td>
                          <td className="px-3 py-2 text-right">
                            {c == null ? <span className="text-slate-300">—</span>
                              : <span className={`inline-block min-w-14 rounded-full px-2 py-0.5 ${COR_CELULA[tomDoCsat(c)]}`}>{percentual(c)}</span>}
                          </td>
                          <td className={`px-3 py-2 text-right ${f.g.avaliacoes - f.g.positivas ? 'text-rose-700 dark:text-rose-300' : 'text-slate-300'}`}>
                            {f.g.avaliacoes - f.g.positivas || '—'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {f.nota == null ? <span className="text-slate-300">—</span> : (
                              <span className={`inline-block min-w-14 rounded-full px-2 py-0.5 ${COR_CELULA[tomDaNota(f.nota)]}`}
                                    title={`${f.monitorias} monitoria${f.monitorias === 1 ? '' : 's'}`}>{percentual(f.nota)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 pr-6 text-right font-semibold sm:pr-7">
                            {f.pontos == null ? '—' : (
                              <span className={f.meta ? (f.pontos >= f.meta ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700 dark:text-rose-300') : 'text-slate-900'}>
                                {inteiro(f.pontos)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Secao>
        </Painel>
      )}
    </div>
  );

  const itens = [
    { chave: 'geral', rotulo: 'Geral', conteudo: geral },
    {
      chave: 'pts', rotulo: 'Pontuação',
      conteudo: (
        <Vista k="pts" equipe={equipePts} pessoas={seriesPts} formatar={inteiro}
               titulo="Pontuação média da equipe por mês"
               subtitulo={`Média dos pontos de quem tem meta.${metaGeral ? ` Linha tracejada: a meta de ${inteiro(Number(metaGeral))}.` : ''} Mês fechado vem do fechamento; mês aberto, do cálculo de hoje.`}
               referencia={metaGeral ? { valor: Number(metaGeral), rotulo: `meta ${inteiro(Number(metaGeral))}` } : undefined}
               tom={(v, i, id) => {
                 const meta = id ? metaDe(id, meses[i]) : metaGeral ? Number(metaGeral) : null;
                 if (!meta) return 'neutro';
                 return v >= meta ? 'bom' : v >= meta * 0.9 ? 'atencao' : 'ruim';
               }}
               resumoExtra={veOTime && naMetaNoFim.length
                 ? { rotulo: `Na meta em ${rotuloMes(fim)}`, valor: `${naMetaNoFim.filter((p) => Number(p.resultado) >= Number(p.meta)).length} de ${naMetaNoFim.length}` }
                 : undefined} />
      ),
    },
    {
      chave: 'csat', rotulo: 'C-SAT',
      conteudo: porCanal((c) => (
        <Vista k="csat" formatar={percentual} min={0.75} max={1} tom={(v) => tomDoCsat(v)}
               titulo="C-SAT da equipe por mês" subtitulo={`Positivas sobre avaliações. Linha tracejada: a meta de ${textoDaMeta(metaCsat)}.`}
               referencia={meta}
               equipe={meses.map((m) => csatDe(c, EQUIPE, m))}
               pessoas={series(ids(todoCsat.filter((x) => x.origem === c)), (id, m) => csatDe(c, id, m))} />
      )),
    },
    {
      chave: 'vol', rotulo: 'Volume',
      // 3.9.0: Geral (as filas somadas, com o atendimento da Sol do setor) e
      // uma aba por fila do setor, com os finalizados.
      conteudo: (
        <AbasLocais rotulo="Fila" abas={[
          { chave: 'geral', rotulo: 'Geral', filas: filasDoSetor },
          ...filasDoSetor.map((f) => ({ chave: String(f.id), rotulo: f.nome, filas: [f] })),
        ].map((aba) => {
          const equipe = meses.map((m) => {
            const vs = aba.filas.map((f) => volDe(f.apelido as Canal, EQUIPE, m)).filter((v): v is number => v != null);
            return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
          });
          const med = media(semNulos(equipe));
          const apelidos = new Set(aba.filas.map((f) => f.apelido));
          return {
            chave: aba.chave, rotulo: aba.rotulo,
            conteudo: (
              <div className="space-y-4">
                {/* A Sol só no Geral: ela vem do setor inteiro, sem divisão por fila. */}
                {veOTime && aba.chave === 'geral' && <QuadroDaSol meses={meses} rotulos={meses.map(rotuloMes)} linhas={todoSol} equipe={equipe} />}
                <Vista k="vol" formatar={inteiro} tom={() => 'neutro'} equipe={equipe}
                       titulo={aba.chave === 'geral' ? 'Finalizados da equipe por mês, todas as filas' : 'Finalizados da equipe por mês'}
                       subtitulo="Os finalizados lançados da equipe. Linha tracejada: a média do período."
                       referencia={med != null ? { valor: med, rotulo: `média ${inteiro(med)}` } : undefined}
                       pessoas={series(ids(todoVolume.filter((x) => apelidos.has(x.canal))), (id, m) => {
                         const vs = aba.filas.map((f) => volDe(f.apelido as Canal, id, m)).filter((v): v is number => v != null);
                         return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
                       })} />
              </div>
            ),
          };
        })} />
      ),
    },
    {
      chave: 'tme', rotulo: 'TME',
      conteudo: porCanal((c) => {
        const equipe = meses.map((m) => tmeDe(c, EQUIPE, m));
        const med = media(semNulos(equipe));
        return (
          <Vista k="tme" formatar={tempo} equipe={equipe}
                 // Por atendente: âmbar acima da média da equipe no mês. Na linha
                 // da equipe: âmbar acima da média do período.
                 tom={(v, i, id) => {
                   const ref = id ? equipe[i] : med;
                   return ref != null && v > ref ? 'atencao' : 'bom';
                 }}
                 titulo="TME médio da equipe por mês" subtitulo="Linha tracejada: a média do período. Subir é piorar."
                 referencia={med != null ? { valor: med, rotulo: `média ${tempo(med)}` } : undefined}
                 pessoas={series(ids(todoVolume.filter((x) => x.canal === c && (x.tme_seg ?? 0) > 0)), (id, m) => tmeDe(c, id, m))} />
        );
      }),
    },
    {
      chave: 'mon', rotulo: 'Monitoria',
      conteudo: (
        <Vista k="mon" formatar={percentual} min={0.7} max={1} tom={(v) => tomDaNota(v)}
               titulo="Nota média de monitoria da equipe por mês" subtitulo={`Linha tracejada: ${textoDoPiso(pisoMon)}, o piso para a monitoria pontuar.`}
               referencia={{ valor: pisoMon, rotulo: `piso ${textoDoPiso(pisoMon)}` }}
               equipe={meses.map((m) => notaDe(EQUIPE, m))}
               pessoas={series(todasNotas.map((x) => x.operador_id), (id, m) => notaDe(id, m))} />
      ),
    },
  ];

  return (
    <ProvedorDeCanal canais={filasDoSetor.map((f) => ({ chave: f.apelido, rotulo: f.nome }))}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Comparativo entre meses</h1>
            <p className="mt-1 text-sm text-sobre-fundo-suave">
              {veOTime ? 'A equipe mês a mês, em cada categoria.' : 'A sua evolução mês a mês, em cada categoria.'}
              {' '}De {rotuloMes(de)} a {rotuloMes(fim)}.
            </p>
          </div>
          {/* Período: navegação, porque muda o que se consulta. */}
          <div className="inline-flex gap-1 rounded-full bg-pilula p-1">
            {PERIODOS.map((p) => (
              <Link key={p} href={`/cota/comparativo?n=${p}${cat ? `&cat=${cat}` : ''}`}
                    aria-current={p === periodo ? 'true' : undefined}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                      p === periodo ? 'bg-superficie text-slate-900 shadow-sm' : 'text-sobre-fundo-suave hover:text-sobre-fundo'}`}>
                {p} meses
              </Link>
            ))}
          </div>
        </div>

        <Abas itens={itens} inicial={cat} />
      </div>
    </ProvedorDeCanal>
  );
}

type LinhaSol = { setor_id: number; mes_competencia: string; semana: number; total: number | null; resolvidos_ia: number | null };

// Cores da paleta (lib/cores): a Sol em ciano (a IA), a equipe e o resto em verde (a marca).
const COR_SOL = SERIES[1];
const COR_EQUIPE = SERIES[0];
const inteiroSol = (v: number) => numeroBR(Math.round(v));

/** Uma coluna empilhada: a Sol embaixo, a equipe e o resto em cima; o total e a % da Sol no topo. */
function ColunaDaSol({ rotulo, total, sol, maior, destaque = false }: { rotulo: string; total: number; sol: number; maior: number; destaque?: boolean }) {
  const altura = maior ? (total / maior) * 100 : 0;
  const fatia = total ? sol / total : 0;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <span className="text-sm font-semibold tabular-nums text-slate-900">{total ? inteiroSol(total) : '—'}</span>
      <span className="h-4 text-xs font-semibold tabular-nums" style={{ color: COR_SOL }}>{total ? percentual(fatia) : ''}</span>
      <div className="mt-1.5 flex h-44 w-full max-w-20 items-end">
        {total > 0 ? (
          <div className="crescer-y flex w-full origin-bottom flex-col overflow-hidden rounded-t-lg" style={{ height: `${Math.max(altura, 3)}%` }}
               title={`${rotulo}: ${inteiroSol(total)} no total, ${inteiroSol(sol)} pela Sol (${percentual(fatia)})`}>
            <div className="flex-1" style={{ background: COR_EQUIPE }} />
            <div style={{ height: `${fatia * 100}%`, background: COR_SOL }} />
          </div>
        ) : <div className="h-px w-full bg-slate-200" />}
      </div>
      <span className={`mt-1.5 text-xs ${destaque ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>{rotulo}</span>
    </div>
  );
}

/**
 * Atendimento da Sol (3.9.0, migração 99): o que a gestão lança em
 * Lançamentos — o número geral e quantos a Sol (a IA) resolveu. Em destaque, o
 * mês mais recente lançado: os números, a fatia da Sol no total e as semanas;
 * abaixo, mês a mês. Colunas empilhadas (Sol × equipe e demais), nas cores da
 * paleta. Para comparar, os finalizados da equipe (da importação). Só informação.
 */
function QuadroDaSol({ meses, rotulos, linhas, equipe }: {
  meses: string[]; rotulos: string[]; linhas: LinhaSol[]; equipe: (number | null)[];
}) {
  const doMes = (m: string) => linhas.filter((x) => x.mes_competencia === m);
  const soma = (ls: LinhaSol[]) => ({ total: ls.reduce((t, x) => t + (x.total ?? 0), 0), sol: ls.reduce((t, x) => t + (x.resolvidos_ia ?? 0), 0) });
  const porMes = meses.map((m, i) => ({ m, i, ...soma(doMes(m)), lancado: doMes(m).length > 0 }));
  const comDado = porMes.filter((x) => x.lancado);
  if (!comDado.length) {
    return (
      <Painel><Secao titulo="Atendimento da Sol">
        <Vazio>Nada lançado ainda. A gestão lança por semana em Lançamentos › Atendimento da Sol: o número geral e quantos a Sol resolveu.</Vazio>
      </Secao></Painel>
    );
  }
  const ult = comDado[comDado.length - 1];
  const fatia = ult.total ? ult.sol / ult.total : 0;
  const demais = Math.max(0, ult.total - ult.sol);
  const equipeUlt = equipe[ult.i];
  const semanas = [1, 2, 3, 4].map((sem) => ({ sem, ...soma(doMes(ult.m).filter((x) => x.semana === sem)) }));
  const maiorSemana = Math.max(...semanas.map((x) => x.total), 1);
  const maiorMes = Math.max(...porMes.map((x) => x.total), 1);
  const numeros: { rotulo: string; valor: string; nota?: string; cor?: string }[] = [
    { rotulo: `Número geral · ${rotulos[ult.i]}`, valor: inteiroSol(ult.total) },
    { rotulo: 'Resolvidos pela Sol', valor: inteiroSol(ult.sol), nota: `${percentual(fatia)} do número geral`, cor: COR_SOL },
    { rotulo: 'Equipe e demais', valor: inteiroSol(demais), nota: `${percentual(ult.total ? demais / ult.total : 0)} do número geral`, cor: COR_EQUIPE },
    { rotulo: 'Finalizados pela equipe', valor: equipeUlt == null ? '—' : inteiroSol(equipeUlt), nota: 'da importação, para comparar' },
  ];
  const Legenda = () => (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_SOL }} />Resolvidos pela Sol</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_EQUIPE }} />Equipe e demais</span>
    </div>
  );
  return (
    <Painel>
      <Secao titulo="Atendimento da Sol" subtitulo="Lançado pela gestão em Lançamentos: o número geral e quantos a Sol resolveu. Só informação: não entra na pontuação.">
        <div className="grid divide-y divide-slate-200 rounded-2xl border border-slate-200 sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
          {numeros.map((n) => (
            <div key={n.rotulo} className="px-5 py-4">
              <p className="text-sm text-slate-500">{n.rotulo}</p>
              <p className="mt-1 text-[1.5rem] font-semibold tracking-tight tabular-nums text-slate-900" style={n.cor ? { color: n.cor } : undefined}>{n.valor}</p>
              {n.nota && <p className="text-xs text-slate-500">{n.nota}</p>}
            </div>
          ))}
        </div>

        {/* A fatia da Sol no número geral do mês mais recente. */}
        <div className="mt-5 space-y-2">
          <div className="flex h-9 w-full overflow-hidden rounded-full text-xs font-semibold text-white">
            {ult.sol > 0 && (
              <div className="crescer-x flex origin-left items-center justify-center" style={{ width: `${fatia * 100}%`, background: COR_SOL }}>
                {fatia >= 0.12 ? `Sol · ${percentual(fatia)}` : ''}
              </div>
            )}
            {demais > 0 && (
              <div className="flex flex-1 items-center justify-center" style={{ background: COR_EQUIPE }}>
                {1 - fatia >= 0.12 ? `Equipe e demais · ${percentual(1 - fatia)}` : ''}
              </div>
            )}
          </div>
          <Legenda />
        </div>

        <div className="mt-7 grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div>
            <p className="mb-3 text-sm font-semibold text-slate-800">Semana a semana · {rotulos[ult.i]}</p>
            <div className="flex items-end gap-3">
              {semanas.map((x) => <ColunaDaSol key={x.sem} rotulo={`${x.sem}ª sem`} total={x.total} sol={x.sol} maior={maiorSemana} />)}
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold text-slate-800">Mês a mês</p>
            <div className="flex items-end gap-3">
              {porMes.map((x) => <ColunaDaSol key={x.m} rotulo={rotulos[x.i]} total={x.total} sol={x.sol} maior={maiorMes} destaque={x.m === ult.m} />)}
            </div>
          </div>
        </div>
      </Secao>
    </Painel>
  );
}
