import PainelGestor from '@/componentes/PainelGestor';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Cartao, EtiquetaNota, Vazio } from '@/componentes/ui';
import Relogio from '@/componentes/Relogio';
import AlternadorCanal from '@/componentes/AlternadorCanal';
import GraficoCsat, { type PontoCsat } from '@/componentes/GraficoCsat';
import { corDoCsat, codigoMonitoria, data as formatarData, hojeNoBrasil, mesDeCompetencia, mesRotulo, percentual } from '@/lib/formatar';
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

/** "Allana Castro da Silva" → "Allana Castro". */
const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');

const pontos = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

/** Meta de C-SAT exibida no gráfico: a faixa máxima da cota. */
const META_CSAT = 0.95;

type Monitoria = {
  id: string; codigo: number; protocolo: string; data_atendimento: string;
  semana_mes: number; nota_final: number; zerado: boolean; parecer: string | null;
};
type Apontamento = { monitoria_id: string; criterio: string; observacao: string | null };
type CsatSemana = { semana: number; avaliacoes: number; positivas: number };

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
  searchParams: Promise<{ canal?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { canal: canalPedido } = await searchParams;
  const competencia = mesDeCompetencia(hojeNoBrasil());

  // Gestor: mesmo cabeçalho, com a visão da equipe no lugar da própria cota.
  if (perfil.papel === 'gestor') {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-sobre-fundo">
              {saudacao()}, {nomeCurto(perfil.nome)}
            </h1>
            <p className="text-sm text-sobre-fundo-suave">{mesRotulo(competencia)} · Visão da equipe</p>
          </div>
          <Relogio />
        </div>
        <PainelGestor competencia={competencia} canal={canalPedido === 'diretores' ? 'diretores' : 'huggy'} />
      </div>
    );
  }

  const db = await criarClienteServidor();

  // Média da equipe por semana. A função devolve só o agregado, então o
  // operador vê a média sem enxergar a nota de nenhum colega.
  // Busca a média dos dois canais de uma vez: o canal exibido só é conhecido
  // depois de contar as avaliações, e esperar por isso custaria uma ida a mais.
  const equipe = Promise.all(CANAIS.flatMap(({ chave }) => [1, 2, 3, 4].map((semana) =>
    db.rpc('csat_da_equipe', { p_mes: competencia, p_semana: semana, p_origem: chave }))));

  const [cota, csat, monitorias, csatEquipe] = await Promise.all([
    db.from('vw_cota_mensal').select('resultado, meta, atingimento, cargo')
      .eq('pessoa_id', perfil.id).eq('mes_competencia', competencia).maybeSingle(),
    db.from('vw_csat_semanal').select('origem, semana, avaliacoes, positivas')
      .eq('pessoa_id', perfil.id).eq('mes_competencia', competencia),
    db.from('vw_monitorias')
      .select('id, codigo, protocolo, data_atendimento, semana_mes, nota_final, zerado, parecer')
      .eq('operador_id', perfil.id)
      .order('data_atendimento', { ascending: false }).order('codigo', { ascending: false })
      .limit(20),
    equipe,
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

  const todas = (csat.data ?? []) as (CsatSemana & { origem: Canal })[];
  const avaliacoesDo = (c: Canal) => todas.filter((s) => s.origem === c).reduce((n, s) => n + s.avaliacoes, 0);

  // Canal pedido na URL; sem pedido, o canal onde a pessoa mais atende.
  const canal: Canal = CANAIS.some((c) => c.chave === canalPedido)
    ? canalPedido as Canal
    : avaliacoesDo('diretores') > avaliacoesDo('huggy') ? 'diretores' : 'huggy';
  // Os dois canais já vêm montados; o botão só alterna, sem ir ao servidor.
  const graficoDo = (c: Canal) => {
    const indice = CANAIS.findIndex((x) => x.chave === c);
    const semanas = todas.filter((s) => s.origem === c);
    const porSemana = new Map(semanas.map((s) => [s.semana, s]));
    const totalAval = semanas.reduce((s, x) => s + x.avaliacoes, 0);
    const csatMes = totalAval ? semanas.reduce((s, x) => s + x.positivas, 0) / totalAval : null;
    const pontosCsat: PontoCsat[] = [1, 2, 3, 4].map((n, i) => {
      const s = porSemana.get(n);
      const eq = csatEquipe[indice * 4 + i].data;
      return {
        semana: n,
        pessoa: s && s.avaliacoes ? s.positivas / s.avaliacoes : null,
        equipe: eq == null ? null : Number(eq),
      };
    });
    if (!pontosCsat.some((p) => p.pessoa != null || p.equipe != null)) {
      return <Vazio>Sem avaliações nesta competência.</Vazio>;
    }
    return (
      <div className="space-y-2">
        {csatMes != null && (
          <p className="text-sm text-slate-600">
            No mês: <span className={`text-lg font-semibold tabular-nums ${corDoCsat(csatMes)}`}>
              {percentual(csatMes)}
            </span>
          </p>
        )}
        <GraficoCsat pontos={pontosCsat} meta={META_CSAT} />
      </div>
    );
  };

  const resultado = cota.data ? Number(cota.data.resultado) : null;
  const meta = cota.data?.meta != null ? Number(cota.data.meta) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-sobre-fundo">
            {saudacao()}, {nomeCurto(perfil.nome)}
          </h1>
          <p className="text-sm text-sobre-fundo-suave">
            {mesRotulo(competencia)}{cota.data?.cargo ? ` · ${cota.data.cargo}` : ''}
          </p>
        </div>
        <Relogio />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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
                  <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-marca-600"
                      style={{ width: `${Math.min(100, Math.max(0, (resultado / meta) * 100))}%` }}
                    />
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

        {/* C-SAT */}
        <Cartao titulo="C-SAT atual">
          <AlternadorCanal
            compacto
            inicial={canal}
            extras={{ huggy: avaliacoesDo('huggy'), diretores: avaliacoesDo('diretores') }}
            paineis={{ huggy: graficoDo('huggy'), diretores: graficoDo('diretores') }}
          />
        </Cartao>
      </div>

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
