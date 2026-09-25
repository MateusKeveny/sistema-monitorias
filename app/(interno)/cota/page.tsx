import PainelGestor from '@/componentes/PainelGestor';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Cartao, EtiquetaNota, Vazio } from '@/componentes/ui';
import Relogio from '@/componentes/Relogio';
import PainelAtendente from '@/componentes/PainelAtendente';
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
