import Link from '@/componentes/Link';
import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import BotaoFecharCiclo from '@/componentes/BotaoFecharCiclo';
import AjusteDeFechamento from '@/componentes/AjusteDeFechamento';
import ValorDaCota from '@/componentes/ValorDaCota';
import PagamentoDoMes from '@/componentes/PagamentoDoMes';
import type {
  AlteracaoDeValor, PagamentoMensal, ValorDaCota as ValorDaCotaTipo,
} from '@/lib/tipos';
import { Atingimento, Quadro, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { dataHora, hojeNoBrasil, mesRotulo, semanaDoCiclo } from '@/lib/formatar';
import SetasDeCompetencia from '@/componentes/SetasDeCompetencia';
import { resolverCompetencia } from '@/lib/competencia';

export const dynamic = 'force-dynamic';

type Aberto = { pessoa_id: string; pessoa: string; cargo: string | null; resultado: number; meta: number | null };
type Alteracao = {
  id: number; pessoa_nome: string | null; campo: string;
  valor_anterior: string | null; valor_novo: string | null;
  motivo: string; autor_nome: string | null; criado_em: string;
};

type Fechado = {
  id: string;
  pessoa_id: string; pessoa_nome: string; cargo: string | null;
  resultado: number; meta: number | null; fechado_por_nome: string | null; fechado_em: string;
};

const num = (v: number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

/**
 * Fechamento do ciclo: congela o que foi entregue ao outro departamento.
 *
 * O extrato é vivo e reflete sempre a regra atual; o fechamento guarda o
 * resultado e cada linha do extrato como estavam no dia. É o que permite
 * explicar meses depois de onde veio cada ponto.
 */
export default async function Fechamento({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  await exigirGestor();
  const { mes } = await searchParams;
  const { competencia, atual } = await resolverCompetencia(mes);

  const db = await criarClienteServidor();
  const [abertos, fechados, semCargo, conferir, alteracoes, valor, pagamento, correcoes, volumes, monitorias, avaliados]
    = await Promise.all([
    db.from('vw_cota_mensal').select('pessoa_id, pessoa, cargo, resultado, meta')
      .eq('mes_competencia', competencia).order('resultado', { ascending: false }),
    db.from('fechamentos_cota')
      .select('id, pessoa_id, pessoa_nome, cargo, resultado, meta, fechado_por_nome, fechado_em')
      .eq('mes_competencia', competencia).order('resultado', { ascending: false }),
    db.from('vw_sem_cargo').select('nome').eq('mes_competencia', competencia),
    db.from('vw_lancamentos_a_conferir').select('bloco').eq('mes_competencia', competencia),
    db.from('fechamento_alteracoes')
      .select('id, pessoa_nome, campo, valor_anterior, valor_novo, motivo, autor_nome, criado_em')
      .eq('mes_competencia', competencia).order('criado_em', { ascending: false }),
    db.from('valores_da_cota').select('*').eq('mes_competencia', competencia).maybeSingle(),
    db.from('vw_pagamento_mensal').select('*')
      .eq('mes_competencia', competencia).order('valor', { ascending: false, nullsFirst: false }),
    db.from('valores_alteracoes').select('*')
      .eq('mes_competencia', competencia).order('alterado_em', { ascending: false }),
    // Para "Antes de fechar": semanas com volume e a cobertura das monitorias.
    db.from('volume_semanal').select('semana, canal').eq('mes_competencia', competencia),
    db.from('vw_monitorias').select('operador_id, semana_mes').eq('mes_referencia', competencia),
    db.from('pessoas').select('id, nome').eq('avaliado', true).eq('ativo', true).order('nome'),
  ]);

  const lista = (abertos.data ?? []) as Aberto[];
  const congelados = (fechados.data ?? []) as Fechado[];
  const jaFechados = new Set(congelados.map((f) => f.pessoa_id));
  const pendentes = lista.filter((p) => !jaFechados.has(p.pessoa_id));

  const avisos: string[] = [];
  if ((semCargo.data ?? []).length) {
    avisos.push(`Sem cargo definido, fora do fechamento: ${(semCargo.data ?? [])
      .map((p) => p.nome as string).join(', ')}.`);
  }
  if ((conferir.data ?? []).length) {
    avisos.push(`${(conferir.data ?? []).length} lançamento(s) com faixas que não fecham com o total.`);
  }

  // ------------------------------------------------------- Antes de fechar
  // O que ainda falta para o mês estar pronto, cada item com o caminho de onde
  // se resolve. Semana e monitoria só cobram o que já terminou: num ciclo em
  // andamento, semana que ainda não aconteceu não é pendência.
  const semanasEncerradas = competencia < atual ? 4 : Math.max(0, semanaDoCiclo(hojeNoBrasil()) - 1);
  const comVolume = new Set(((volumes.data ?? []) as { semana: number; canal: string }[])
    .filter((v) => v.canal === 'huggy').map((v) => v.semana));
  const semVolume = [1, 2, 3, 4].slice(0, semanasEncerradas).filter((s) => !comVolume.has(s));
  const POR_SEMANA = 4;
  const esperadas = POR_SEMANA * semanasEncerradas;
  const feitasPor = new Map<string, number>();
  for (const m of (monitorias.data ?? []) as { operador_id: string; semana_mes: number }[]) {
    if (m.semana_mes <= semanasEncerradas) feitasPor.set(m.operador_id, (feitasPor.get(m.operador_id) ?? 0) + 1);
  }
  const monitoriasIncompletas = esperadas === 0 ? [] : ((avaliados.data ?? []) as { id: string; nome: string }[])
    .map((p) => ({ ...p, feitas: feitasPor.get(p.id) ?? 0 }))
    .filter((p) => p.feitas < esperadas);
  const mesCurto = competencia.slice(0, 7);
  const antesDeFechar: { texto: React.ReactNode; grave?: boolean; acao?: { rotulo: string; href: string } }[] = [];
  if ((semCargo.data ?? []).length) {
    antesDeFechar.push({ grave: true, acao: { rotulo: 'Definir', href: '/cota/configuracao' },
      texto: <>Sem cargo, ficam fora do fechamento: <b>{(semCargo.data ?? []).map((p) => p.nome as string).join(', ')}</b></> });
  }
  if ((conferir.data ?? []).length) {
    antesDeFechar.push({ acao: { rotulo: 'Conferir', href: `/cota/lancamentos?mes=${mesCurto}` },
      texto: <>{(conferir.data ?? []).length} lançamento(s) com faixas que não fecham com o total</> });
  }
  if (semVolume.length) {
    antesDeFechar.push({ acao: { rotulo: 'Importar', href: '/cota/importar' },
      texto: <>{semVolume.length === 1 ? `Semana ${semVolume[0]}` : `Semanas ${semVolume.join(', ')}`} sem volume lançado</> });
  }
  if (monitoriasIncompletas.length) {
    antesDeFechar.push({
      texto: <>Monitorias incompletas ({esperadas} por pessoa até agora):{' '}
        <b>{monitoriasIncompletas.map((p) => `${p.nome.split(/\s+/)[0]} ${p.feitas}`).join(', ')}</b></> });
  }
  if (competencia === atual) {
    antesDeFechar.push({ texto: <>O ciclo ainda está correndo: termina em 25/{competencia.slice(5, 7)}.</> });
  }

  const quando = congelados[0]?.fechado_em;
  const historico = (alteracoes.data ?? []) as Alteracao[];
  const NOME_CAMPO: Record<string, string> = {
    resultado: 'Pontos', meta: 'Meta', reabertura: 'Fechamento reaberto',
  };

  return (
    <div className="space-y-6">
      {/* Topo no padrão das telas novas (1.18.0): o mês com setas e a situação dele. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Fechamento</h1>
          <div className="mt-1.5">
            <SetasDeCompetencia competencia={competencia} atual={atual} caminho="/cota/fechamento" compacto />
          </div>
          <p className="mt-2 text-xs text-sobre-fundo-suave">
            {congelados.length
              ? <span className="font-semibold text-emerald-200">
                  {congelados.length} pessoa(s) fechadas por {congelados[0].fechado_por_nome ?? '—'}
                  {quando ? ` em ${dataHora(quando)}` : ''}
                </span>
              : <span className="font-semibold text-amber-200">Ainda aberto</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <a href={`/api/cota/exportar?mes=${mesCurto}&formato=detalhado`}
             className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                        font-medium text-slate-700 hover:bg-slate-50">
            Relatório detalhado
          </a>
          <a href={`/api/cota/exportar?mes=${mesCurto}`}
             className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                        font-medium text-slate-700 hover:bg-slate-50">
            Resumo para importação
          </a>
        </div>
      </div>

      {/* Antes de fechar: só enquanto há gente para fechar. */}
      {pendentes.length > 0 && (
        <Quadro titulo="Antes de fechar"
                subtitulo={antesDeFechar.length ? 'O que ainda falta para o mês estar pronto.' : undefined}>
          {antesDeFechar.length === 0 ? (
            <p className="text-sm font-medium text-marca-700 dark:text-marca-400">
              ✓ Tudo pronto para fechar: todos com cargo, volume das semanas lançado e monitorias completas.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {antesDeFechar.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${p.grave ? 'bg-rose-500' : 'bg-amber-500'}`} />
                  <span className="flex-1 text-slate-700">{p.texto}</span>
                  {p.acao && (
                    <Link href={p.acao.href}
                          className="rounded-md bg-marca-50 px-2 py-0.5 text-xs font-semibold text-marca-700 dark:text-marca-400">
                      {p.acao.rotulo} ›
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Quadro>
      )}

      {congelados.length > 0 && (
        <Quadro
          titulo={`Congelado (${congelados.length})`}
          acao={<span className="text-xs text-slate-500">valores entregues, não mudam mais</span>}
        >
          <Tabela noQuadro>
            <thead>
              <tr>
                <Th>Pessoa</Th><Th>Cargo</Th>
                <Th className="text-right">Pontos</Th>
                <Th className="text-right">Meta</Th>
                <Th className="text-right">Atingimento</Th>
                <Th>Extrato</Th>
                <Th>Correção</Th>
              </tr>
            </thead>
            <tbody>
              {congelados.map((f) => (
                <tr key={f.pessoa_id}>
                  <Td className="font-medium text-slate-800">{f.pessoa_nome}</Td>
                  <Td className="text-xs text-slate-500">{f.cargo ?? '—'}</Td>
                  <Td className="text-right font-semibold tabular-nums">{num(f.resultado)}</Td>
                  <Td className="text-right tabular-nums text-slate-500">{f.meta ? num(f.meta) : '—'}</Td>
                  <Td className="text-right">
                    {f.meta ? <Atingimento valor={Number(f.resultado) / Number(f.meta)} /> : '—'}
                  </Td>
                  <Td>
                    <Link href={`/cota/extrato?pessoa=${f.pessoa_id}&mes=${competencia.slice(0, 7)}`}
                          className="text-xs text-marca-700 hover:underline dark:text-marca-400">
                      ver
                    </Link>
                  </Td>
                  <Td>
                    <AjusteDeFechamento
                      fechamentoId={f.id}
                      pessoa={f.pessoa_nome}
                      resultado={Number(f.resultado)}
                      meta={f.meta == null ? null : Number(f.meta)}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Quadro>
      )}

      {congelados.length > 0 && (
        <>
          <ValorDaCota
            competencia={competencia}
            valor={(valor.data ?? null) as ValorDaCotaTipo | null}
            alteracoes={(correcoes.data ?? []) as AlteracaoDeValor[]}
          />
          <PagamentoDoMes
            competencia={competencia}
            linhas={(pagamento.data ?? []) as PagamentoMensal[]}
          />
        </>
      )}

      <Quadro
        titulo={congelados.length ? `Ainda em aberto (${pendentes.length})` : `Prévia do fechamento (${pendentes.length})`}
      >
        {pendentes.length === 0 ? (
          <Vazio>
            {congelados.length
              ? 'Todo mundo desta competência já está fechado.'
              : 'Ninguém com pontuação nesta competência.'}
          </Vazio>
        ) : (
          <div className="space-y-5">
            <Tabela noQuadro>
              <thead>
                <tr>
                  <Th>Pessoa</Th><Th>Cargo</Th>
                  <Th className="text-right">Pontos</Th>
                  <Th className="text-right">Meta</Th>
                  <Th className="text-right">Atingimento</Th>
                  <Th>Extrato</Th>
                </tr>
              </thead>
              <tbody>
                {pendentes.map((p) => (
                  <tr key={p.pessoa_id}>
                    <Td className="font-medium text-slate-800">{p.pessoa}</Td>
                    <Td className="text-xs text-slate-500">{p.cargo ?? '—'}</Td>
                    <Td className="text-right font-semibold tabular-nums">{num(p.resultado)}</Td>
                    <Td className="text-right tabular-nums text-slate-500">{p.meta ? num(p.meta) : '—'}</Td>
                    <Td className="text-right">
                      {p.meta ? <Atingimento valor={Number(p.resultado) / Number(p.meta)} /> : '—'}
                    </Td>
                    <Td>
                      <Link href={`/cota/extrato?pessoa=${p.pessoa_id}&mes=${competencia.slice(0, 7)}`}
                            className="text-xs text-marca-700 hover:underline dark:text-marca-400">
                        conferir
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>

            <div className="border-t border-slate-100 pt-5">
              <BotaoFecharCiclo competencia={competencia} pessoas={pendentes.length} avisos={avisos} />
            </div>
          </div>
        )}
      </Quadro>

      {historico.length > 0 && (
        <Quadro titulo={`Correções feitas (${historico.length})`}>
          <Tabela noQuadro>
            <thead>
              <tr>
                <Th>Quando</Th><Th>Pessoa</Th><Th>O que mudou</Th>
                <Th className="text-right">De</Th><Th className="text-right">Para</Th>
                <Th>Motivo</Th><Th>Autor</Th>
              </tr>
            </thead>
            <tbody>
              {historico.map((h) => (
                <tr key={h.id}>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{dataHora(h.criado_em)}</Td>
                  <Td>{h.pessoa_nome ?? '—'}</Td>
                  <Td className={h.campo === 'reabertura' ? 'text-amber-700' : ''}>
                    {NOME_CAMPO[h.campo] ?? h.campo}
                  </Td>
                  <Td className="text-right tabular-nums text-slate-500">
                    {h.valor_anterior ? num(Number(h.valor_anterior)) : '—'}
                  </Td>
                  <Td className="text-right font-semibold tabular-nums">
                    {h.valor_novo ? num(Number(h.valor_novo)) : '—'}
                  </Td>
                  <Td className="text-xs text-slate-600">{h.motivo}</Td>
                  <Td className="text-xs text-slate-500">{h.autor_nome ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Quadro>
      )}

      <p className="text-xs leading-relaxed text-sobre-fundo-suave">
        Fechar guarda, para cada pessoa, o resultado, a meta e <strong>cada linha do extrato</strong> como
        estão agora. Depois disso, mudar peso, volume ou lançamento não altera o que foi fechado. Quem
        ainda não tinha pontuação no dia do fechamento pode ser fechado depois, e quem já está fechado
        não é refeito. Se precisar corrigir depois, use <strong>corrigir</strong> na linha da pessoa:
        o motivo é obrigatório e toda correção fica registrada abaixo, com valor anterior, valor novo,
        autor e data. Reabrir devolve a pessoa para a prévia, e o valor que estava entregue fica no
        histórico.
      </p>
    </div>
  );
}
