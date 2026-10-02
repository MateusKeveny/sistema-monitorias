import Link from '@/componentes/Link';
import { criarClienteServidor, exigirVisaoDoTime } from '@/lib/supabase/servidor';
import { Cartao, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { codigoMonitoria, data as formatarData, hojeNoBrasil, mesDeCompetencia, periodoDaSemana } from '@/lib/formatar';
import {
  COR_SITUACAO, COR_TIPO, ROTULO_QUEM, ROTULO_SITUACAO, ROTULO_TIPO, TIPOS, validade,
  type RegistroDiario, type TipoRegistro,
} from '@/lib/diario';

export const dynamic = 'force-dynamic';

const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');

/**
 * Diário de bordo — consulta de gestão e qualidade (Monitorias 4.13.0).
 *
 * Os registros são feitos no Painel de Performance; aqui a busca é pelo
 * protocolo, antes de monitorar, e cada registro mostra se o protocolo já
 * caiu em monitoria e se o monitor disse que impactou.
 */
const registradoNoDia = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

export default async function ConsultaDoDiario({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; tipo?: string }>;
}) {
  await exigirVisaoDoTime();
  const { busca, tipo } = await searchParams;
  const db = await criarClienteServidor();

  const termo = (busca ?? '').trim();
  const tipoFiltro = TIPOS.some((t) => t.chave === tipo) ? tipo as TipoRegistro : null;

  let consulta = db.from('diario_registros').select('*')
    .order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(300);
  if (termo) {
    // Vírgula e parênteses quebrariam o filtro "or" do PostgREST.
    const t = termo.replace(/[,()]/g, ' ');
    consulta = consulta.or(`protocolo.ilike.%${t}%,assunto.ilike.%${t}%,descricao.ilike.%${t}%`);
  }
  if (tipoFiltro) consulta = consulta.eq('tipo', tipoFiltro);

  const [inicioDoMes] = periodoDaSemana(mesDeCompetencia(hojeNoBrasil()), 1);
  const [{ data: registros }, { data: pessoas }, { data: citacoes }, noMes, aguardando, criticos, { data: subcategorias }] = await Promise.all([
    consulta,
    db.from('pessoas').select('id, nome'),
    db.from('diario_citacoes').select('registro_id, impacta, monitoria_id, monitorias(codigo)'),
    db.from('diario_registros').select('id', { count: 'exact', head: true }).gte('data', inicioDoMes),
    db.from('diario_registros').select('id', { count: 'exact', head: true }).eq('situacao', 'aguardando'),
    db.from('diario_registros').select('id', { count: 'exact', head: true }).gte('data', inicioDoMes).in('tipo', ['autorizacao', 'excecao']),
    // Subcategorias de problema operacional (migração 46).
    db.from('diario_subcategorias').select('id, nome'),
  ]);

  const nome = new Map((pessoas ?? []).map((p) => [p.id as string, nomeCurto(p.nome as string)]));
  type Citacao = { registro_id: string; impacta: boolean; monitoria_id: string; monitorias: { codigo: number | null } | null };
  const todasCitacoes = (citacoes ?? []) as unknown as Citacao[];
  const citacoesDe = (id: string) => todasCitacoes.filter((c) => c.registro_id === id);
  const impactaram = todasCitacoes.filter((c) => c.impacta).length;
  const lista = (registros ?? []) as RegistroDiario[];
  const hoje = hojeNoBrasil();

  const Numero = ({ titulo, valor, detalhe, alerta }: { titulo: string; valor: number; detalhe?: string; alerta?: boolean }) => (
    <div className={`rounded-2xl px-5 py-4 shadow-sm ${alerta ? 'bg-amber-50' : 'bg-superficie'}`}>
      <p className="text-[13px] text-slate-500">{titulo}</p>
      <p className={`text-2xl font-semibold tabular-nums ${alerta ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900'}`}>{valor}</p>
      {detalhe && <p className="text-xs text-slate-500">{detalhe}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-sobre-fundo">Diário de bordo</h1>
        <p className="text-sm text-sobre-fundo-suave">
          Consulta para gestão e qualidade. Os registros são feitos no Painel de Performance.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Numero titulo="Registros no mês" valor={noMes.count ?? 0} />
        <Numero titulo="Aguardando aprovação" valor={aguardando.count ?? 0} alerta={(aguardando.count ?? 0) > 0} />
        <Numero titulo="Autorizações e exceções no mês" valor={criticos.count ?? 0} />
        <Numero titulo="Citados em monitoria" valor={todasCitacoes.length}
                detalhe={todasCitacoes.length ? `${impactaram} impactaram · ${todasCitacoes.length - impactaram} não` : undefined} />
      </div>

      <Cartao titulo="Registros">
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-600">Protocolo, assunto ou texto</span>
            <input name="busca" defaultValue={termo} placeholder="Ex.: 88124"
                   className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Tipo</span>
            <select name="tipo" defaultValue={tipoFiltro ?? ''} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {TIPOS.map((t) => <option key={t.chave} value={t.chave}>{t.rotulo}</option>)}
            </select>
          </label>
          <button className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700">Buscar</button>
          {(termo || tipoFiltro) && <Link href="/diario" className="px-2 py-1.5 text-sm text-slate-500 hover:underline">limpar</Link>}
        </form>

        {lista.length === 0 ? (
          <Vazio>{termo || tipoFiltro ? 'Nenhum registro encontrado.' : 'Nenhum registro no diário ainda.'}</Vazio>
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Data</Th><Th>Protocolo</Th><Th>Tipo</Th><Th>Assunto</Th><Th>Registrado por</Th><Th>Situação</Th><Th>Na monitoria</Th>
              </tr>
            </thead>
            <tbody>
              {lista.map((r) => {
                const cit = citacoesDe(r.id);
                return (
                  <tr key={r.id} className="align-top">
                    <Td className="whitespace-nowrap tabular-nums">
                      {formatarData(r.data)}
                      {/* Dia do ocorrido posto para trás pela gestão: a data original do registro vem junto. */}
                      {registradoNoDia(r.criado_em) !== r.data && (
                        <span className="block text-xs text-slate-500">registrado em {formatarData(registradoNoDia(r.criado_em))}</span>
                      )}
                    </Td>
                    <Td className="font-semibold tabular-nums">{r.protocolo ? `#${r.protocolo}` : '—'}</Td>
                    <Td><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${COR_TIPO[r.tipo]}`}>{ROTULO_TIPO[r.tipo]}{r.tipo === 'problema' && r.subcategoria_id ? ` · ${(subcategorias ?? []).find((s) => s.id === r.subcategoria_id)?.nome ?? "—"}` : ""}</span></Td>
                    <Td>
                      <span className="font-medium text-slate-800">{r.assunto}</span>
                      {validade(r, hoje) && (
                        <span className={`ml-2 rounded-md px-1.5 py-0.5 text-xs ${validade(r, hoje)!.vencido
                          ? 'bg-slate-500/15 text-slate-500' : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'}`}>
                          {validade(r, hoje)!.texto}
                        </span>
                      )}
                      <span className="block max-w-xl whitespace-pre-line text-xs text-slate-500">{r.descricao}</span>
                      {r.autorizado_por && (
                        <span className="block text-xs text-slate-500">
                          Autorizado por {ROTULO_QUEM[r.autorizado_por]}{r.autorizado_por_nome ? ` (${r.autorizado_por_nome})` : ''}
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{nome.get(r.pessoa_id) ?? '—'}</Td>
                    <Td><span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${COR_SITUACAO[r.situacao]}`}>{ROTULO_SITUACAO[r.situacao]}</span></Td>
                    <Td className="whitespace-nowrap text-xs">
                      {cit.length ? cit.map((c) => (
                        <Link key={c.monitoria_id} href={`/monitorias/${c.monitoria_id}`}
                              className={`mb-1 block rounded-md px-2 py-0.5 font-semibold hover:underline ${c.impacta
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-marca-600/15 text-marca-700 dark:text-marca-400'}`}>
                          {codigoMonitoria(c.monitorias?.codigo)} · {c.impacta ? 'impactou' : 'não impactou'}
                        </Link>
                      )) : r.tipo === 'autorizacao' || r.tipo === 'excecao'
                        ? <span className="text-slate-500">ainda não monitorado</span>
                        : <span className="text-slate-400">—</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
