import PainelGestor from '@/componentes/PainelGestor';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { BarraDeMeta, Cartao, EtiquetaNota, Vazio } from '@/componentes/ui';
import SetasDeCompetencia from '@/componentes/SetasDeCompetencia';
import { AbasDeCanal, ProvedorDeCanal } from '@/componentes/Canal';
import PainelAtendente from '@/componentes/PainelAtendente';
import { codigoMonitoria, data as formatarData, hojeNoBrasil, mesRotulo, percentual } from '@/lib/formatar';
import { mesAnterior, resolverCompetencia } from '@/lib/competencia';
import { ENDERECO_MONITORIAS } from '@/lib/sistema';

export const dynamic = 'force-dynamic';

const FUSO = 'America/Sao_Paulo';

function saudacao() {
  const hora = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', hour12: false })
    .format(new Date()));
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Selo da situação do mês, sobre a arte de fundo — legível no verde e no preto. */
function Selo({ tom, children }: { tom: 'bom' | 'atencao' | 'neutro'; children: React.ReactNode }) {
  const cores = {
    bom: 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200',
    atencao: 'border-amber-400/40 bg-amber-500/20 text-amber-200',
    neutro: 'border-white/25 bg-white/10 text-sobre-fundo-suave',
  };
  const ponto = { bom: 'bg-emerald-400', atencao: 'bg-amber-400', neutro: 'bg-white/60' };
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${cores[tom]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${ponto[tom]}`} />
      {children}
    </span>
  );
}

/** Em que dia do ciclo (26 → 25) estamos: 'dia 12 de 30'. */
function diaDoCiclo(atual: string) {
  const inicio = Date.parse(`${mesAnterior(atual).slice(0, 8)}26T12:00:00Z`);
  const fim = Date.parse(`${atual.slice(0, 8)}25T12:00:00Z`);
  const hoje = Date.parse(`${hojeNoBrasil()}T12:00:00Z`);
  const dia = 86_400_000;
  return { dia: Math.round((hoje - inicio) / dia) + 1, total: Math.round((fim - inicio) / dia) + 1 };
}

/** "Allana Castro da Silva" → "Allana Castro". */
const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');

const pontos = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

type Monitoria = {
  id: string; codigo: number; protocolo: string; data_atendimento: string;
  semana_mes: number; nota_final: number; zerado: boolean; parecer: string | null;
};
type Apontamento = { monitoria_id: string; criterio: string; observacao: string | null };

/**
 * Tela inicial do Painel de Performance: a visão da própria pessoa.
 *
 * Tudo é da pessoa logada — as views respeitam a RLS, então não há como uma
 * pessoa ver o dado de outra por aqui.
 */
type Canal = 'huggy' | 'diretores';
const CANAIS: { chave: Canal; rotulo: string }[] = [
  { chave: 'huggy', rotulo: 'Expansão' },
  { chave: 'diretores', rotulo: 'Diretores-Expansão' },
];

export default async function InicioCota({
  searchParams,
}: {
  searchParams: Promise<{ canal?: string; mes?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { canal: canalPedido, mes } = await searchParams;
  const { competencia, atual, emAberto } = await resolverCompetencia(mes);
  const outroMes = competencia !== atual;

  /**
   * Topo da tela (1.15.0): a saudação primeiro; embaixo, o mês com as setas;
   * depois o selo com a situação do mês e, bem discreta, a nota de que o mês
   * seguinte ainda não tem lançamentos. O relógio saiu — ocupava o lugar mais
   * visível da tela sem ajudar em nenhuma decisão.
   *
   * O selo fala do fechamento, que é trabalho do gestor: só ele vê.
   */
  const Topo = ({ selo, direita }: { selo?: React.ReactNode; direita?: React.ReactNode }) => (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">
          {saudacao()}, {nomeCurto(perfil.nome).split(' ')[0]}
        </h1>
        <div className="mt-1.5">
          <SetasDeCompetencia competencia={competencia} atual={atual} caminho="/cota" compacto
                              manter={{ canal: canalPedido }} />
        </div>
        {(selo || emAberto || outroMes) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {selo}
            {emAberto && (
              <span className="text-xs text-sobre-fundo-suave opacity-75">
                {mesRotulo(atual)} ainda sem lançamentos
              </span>
            )}
            {!emAberto && outroMes && !selo && (
              <span className="text-xs text-sobre-fundo-suave opacity-75">Competência anterior</span>
            )}
          </div>
        )}
      </div>
      {direita}
    </div>
  );

  // Gestor: mesmo topo, com a visão da equipe no lugar da própria cota.
  if (perfil.papel === 'gestor') {
    const db = await criarClienteServidor();
    const { data: fechados } = await db.from('fechamentos_cota').select('fechado_em')
      .eq('mes_competencia', competencia).order('fechado_em', { ascending: false }).limit(1);
    const fechadoEm = fechados?.[0]?.fechado_em as string | undefined;

    const selo = fechadoEm ? (
      <Selo tom="bom">Fechado em {formatarData(fechadoEm.slice(0, 10))}</Selo>
    ) : competencia === atual ? (
      <Selo tom="neutro">Mês atual · dia {diaDoCiclo(atual).dia} de {diaDoCiclo(atual).total} do ciclo</Selo>
    ) : (
      <Selo tom="atencao">Em aberto · aguardando fechamento</Selo>
    );

    return (
      <ProvedorDeCanal inicial={canalPedido === 'diretores' ? 'diretores' : 'huggy'}>
        <div className="space-y-6">
          <Topo selo={selo} direita={<AbasDeCanal />} />
          <PainelGestor competencia={competencia} atual={atual} />
        </div>
      </ProvedorDeCanal>
    );
  }

  const db = await criarClienteServidor();

  const [cota, monitorias] = await Promise.all([
    db.from('vw_cota_mensal').select('resultado, meta, atingimento, cargo')
      .eq('pessoa_id', perfil.id).eq('mes_competencia', competencia).maybeSingle(),
    db.from('vw_monitorias')
      .select('id, codigo, protocolo, data_atendimento, semana_mes, nota_final, zerado, parecer')
      .eq('operador_id', perfil.id)
      .order('data_atendimento', { ascending: false }).order('codigo', { ascending: false })
      .limit(20),
  ]);

  const lista = (monitorias.data ?? []) as Monitoria[];
  const { data: itens } = lista.length
    ? await db.from('vw_feedback_individual').select('monitoria_id, criterio, observacao')
      .in('monitoria_id', lista.map((m) => m.id)).eq('conforme', false)
      .order('criterio_ordem')
    : { data: [] };

  const apontamentos = new Map<string, Apontamento[]>();
  for (const a of (itens ?? []) as Apontamento[]) {
    apontamentos.set(a.monitoria_id, [...(apontamentos.get(a.monitoria_id) ?? []), a]);
  }

  const resultado = cota.data ? Number(cota.data.resultado) : null;
  const meta = cota.data?.meta != null ? Number(cota.data.meta) : null;

  return (
    <div className="space-y-6">
      <Topo />

      <div className="grid gap-6">
        {/* Pontuação */}
        <Cartao titulo="Pontuação atual">
          {resultado == null ? (
            <Vazio>Sem pontos lançados nesta competência.</Vazio>
          ) : (
            <div>
              <p className="text-4xl font-semibold tabular-nums text-slate-900">
                {pontos(resultado)} <span className="text-lg font-normal text-slate-500">pts</span>
              </p>
              {meta != null && (
                <>
                  <div className="mt-4">
                    <BarraDeMeta atingimento={resultado / meta}
                                 escala={Math.max(1.25, resultado / meta)} />
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {percentual(resultado / meta)} da meta de {pontos(meta)} pts
                    {resultado < meta && ` · faltam ${pontos(meta - resultado)} pts`}
                  </p>
                </>
              )}
            </div>
          )}
        </Cartao>

      </div>

      <PainelAtendente
        pessoaId={perfil.id}
        competencia={competencia}
        canalPedido={canalPedido}
      />

      {/* Monitorias */}
      <Cartao titulo={`Monitorias (últimas ${lista.length})`}>
        {lista.length === 0 ? (
          <Vazio>Nenhuma monitoria registrada.</Vazio>
        ) : (
          <ul className="-my-2 divide-y divide-slate-100">
            {lista.map((m) => {
              const falhas = apontamentos.get(m.id) ?? [];
              return (
                <li key={m.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <a
                      href={`${ENDERECO_MONITORIAS}/monitorias/${m.id}`} target="_blank" rel="noreferrer"
                      className="font-semibold tabular-nums text-emerald-700 hover:underline dark:text-emerald-400"
                    >
                      {m.protocolo}
                    </a>
                    <span className="tabular-nums text-slate-400/70">{codigoMonitoria(m.codigo)}</span>
                    <span className="tabular-nums text-slate-500">{formatarData(m.data_atendimento)}</span>
                    <span className="text-slate-400">{m.semana_mes}ª semana</span>
                    <span className="ml-auto"><EtiquetaNota valor={Number(m.nota_final)} zerado={m.zerado} /></span>
                  </div>
                  {falhas.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5 text-sm text-slate-600">
                      {falhas.map((f) => (
                        <li key={f.criterio}>
                          <span className="text-rose-600">✕</span> {f.criterio}
                          {f.observacao && <span className="text-slate-500"> — {f.observacao}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-sm text-emerald-700">Todos os critérios atendidos.</p>
                  )}
                  {m.parecer && <p className="mt-1 text-xs italic text-slate-500">{m.parecer}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>
    </div>
  );
}
