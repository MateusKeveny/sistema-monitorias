import Link from 'next/link';
import PainelGestor from '@/componentes/PainelGestor';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import SetasDeCompetencia from '@/componentes/SetasDeCompetencia';
import { AbasDeCanal, ProvedorDeCanal } from '@/componentes/Canal';
import PainelAtendente from '@/componentes/PainelAtendente';
import PainelPleno from '@/componentes/PainelPleno';
import { data as formatarData, hojeNoBrasil, mesRotulo } from '@/lib/formatar';
import { mesAnterior, resolverCompetencia } from '@/lib/competencia';
import { limiteDeRenovacao } from '@/lib/diario';

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

/**
 * Tela inicial do Painel de Performance: painel de acompanhamento.
 *
 * O gestor vê a equipe (PainelGestor); quem recebe por média, a própria conta
 * e a equipe (PainelPleno); o operador, a própria competência
 * (PainelAtendente). As views respeitam a RLS, então o operador não tem como
 * ver o dado de outra pessoa por aqui.
 */
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

  // Operador (1.16.0): o mesmo painel de acompanhamento, sobre a própria
  // competência. O selo diz só em que dia do ciclo estamos — nada de fechamento,
  // que é assunto do gestor.
  const seloOperador = competencia === atual
    ? <Selo tom="neutro">Dia {diaDoCiclo(atual).dia} de {diaDoCiclo(atual).total} do ciclo</Selo>
    : undefined;

  // Quem recebe pela média de outros cargos — o Pleno (1.21.0): a conta dela
  // aberta e, para quem enxerga o time (a Suyara é Qualidade, o suporte do
  // gestor), a equipe com o mesmo acompanhamento do gestor, sem as pendências
  // que levam a telas só dele. Nada aqui grava: a gestão continua só do gestor,
  // e a RLS garante isso no banco.
  const db = await criarClienteServidor();
  const { data: cargos } = await db.from('cargos_da_pessoa').select('cargo_id, desde')
    .eq('pessoa_id', perfil.id).lte('desde', competencia).order('desde', { ascending: false }).limit(1);
  const cargoId = cargos?.[0]?.cargo_id as number | undefined;
  const { data: media } = cargoId
    ? await db.from('pesos_por_cargo').select('ativo').eq('cargo_id', cargoId).eq('regra', 'media_da_equipe').maybeSingle()
    : { data: null };

  if (cargoId && media?.ativo) {
    const veOTime = perfil.papel !== 'operador';
    // O Pleno aprova os registros do diário que aguardam (migração 33) e
    // renova os que vencem em até 7 dias (37) — as pendências do gestor que
    // também são dele.
    const { data: aprova } = await db.rpc('aprova_diario');
    const [{ count: aguardando }, { count: vencendo }] = aprova === true
      ? await Promise.all([
          db.from('diario_registros').select('id', { count: 'exact', head: true })
            .eq('situacao', 'aguardando').neq('pessoa_id', perfil.id),
          db.from('diario_registros').select('id', { count: 'exact', head: true })
            .gte('valido_ate', hojeNoBrasil()).lte('valido_ate', limiteDeRenovacao(hojeNoBrasil())),
        ])
      : [{ count: 0 }, { count: 0 }];
    const pendenciasDoDiario = [
      aguardando && { texto: `${aguardando} registro${aguardando > 1 ? 's' : ''} do diário aguardando aprovação`,
                      acao: 'Revisar', href: '/cota/diario?filtro=aguardando' },
      vencendo && { texto: `${vencendo} registro${vencendo > 1 ? 's' : ''} do diário vence${vencendo > 1 ? 'm' : ''} em até 7 dias`,
                    acao: 'Renovar', href: '/cota/diario?filtro=vencendo' },
    ].filter(Boolean) as { texto: string; acao: string; href: string }[];
    return (
      <ProvedorDeCanal inicial={canalPedido === 'diretores' ? 'diretores' : 'huggy'}>
        <div className="space-y-6">
          <Topo selo={seloOperador} />
          {pendenciasDoDiario.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm font-semibold text-sobre-fundo">Precisa de você</span>
              {pendenciasDoDiario.map((p) => (
                <Link key={p.href} href={p.href}
                      className="inline-flex items-center gap-2 rounded-xl bg-superficie py-1.5 pl-3 pr-1.5 text-sm text-slate-800
                                 shadow-sm transition hover:ring-2 hover:ring-marca-600/40">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  {p.texto}
                  <span className="rounded-md bg-marca-50 px-2 py-0.5 text-xs font-semibold text-marca-700 dark:text-marca-400">
                    {p.acao} ›
                  </span>
                </Link>
              ))}
            </div>
          )}
          <PainelPleno pessoaId={perfil.id} cargoId={cargoId} competencia={competencia} />
          {veOTime && (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
                <h2 className="text-base font-semibold text-sobre-fundo">
                  A equipe
                  <span className="ml-2 text-xs font-normal text-sobre-fundo-suave">
                    o mesmo acompanhamento do gestor — clique num destaque para abrir o detalhe
                  </span>
                </h2>
                <AbasDeCanal />
              </div>
              <PainelGestor competencia={competencia} atual={atual} comPendencias={false} />
            </>
          )}
        </div>
      </ProvedorDeCanal>
    );
  }

  return (
    <PainelAtendente pessoaId={perfil.id} competencia={competencia} atual={atual} canalPedido={canalPedido}
                     topo={<Topo selo={seloOperador} direita={<AbasDeCanal />} />} />
  );
}
