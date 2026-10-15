import Link from '@/componentes/Link';
import CalendarioDeFerias from '@/componentes/CalendarioDeFerias';
import QuadroDoAno from '@/componentes/QuadroDoAno';
import PeriodoForaDoSistema from '@/componentes/PeriodoForaDoSistema';
import GestaoDeFerias, { type FeriasCadastrada } from '@/componentes/GestaoDeFerias';
import { Painel, Secao } from '@/componentes/ui';
import { redirect } from 'next/navigation';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { hojeNoBrasil, mesValido } from '@/lib/formatar';
import { avisosDeFerias, ddmm, foraNoDia, somar, type PrazoDeFerias } from '@/lib/ferias';

export const dynamic = 'force-dynamic';

type Prazo = {
  pessoa_id: string; nome: string; admitido_em: string | null; aquisitivo_inicio: string | null;
  aquisitivo_fim: string | null; limite: string | null; saldo: number | null; dias_ate_limite: number | null; completo: boolean | null;
};

const mesSeguinte = (m: string, n: number) => {
  const [a, mm] = m.split('-').map(Number);
  const d = new Date(Date.UTC(a, mm - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};

/**
 * Férias da equipe (migrações 61 e 62): calendário do mês, cadastro e o
 * prazo de cada pessoa pela CLT. A Agenda da Gestão lê daqui e avisa.
 *
 * Veem o calendário e os avisos: gestor, Qualidade, Pleno e Analista
 * (ve_ferias). Cadastro e prazo da CLT: só o gestor.
 */
export default async function Ferias({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const perfil = await exigirPerfil();
  const db = await criarClienteServidor();
  const gestor = perfil.papel === 'gestor';
  if (!gestor && !(await db.rpc('ve_ferias')).data) redirect('/cota');
  const { mes } = await searchParams;
  const hoje = hojeNoBrasil();
  const mesAtual = mesValido(mes) ? `${mes}-01` : `${hoje.slice(0, 7)}-01`;

  // Os nomes vêm de nomes_das_pessoas: Pleno e Analista não leem o cadastro.
  const [{ data: pessoas }, { data: ferias }, { data: prazos }, { data: nomes }] = await Promise.all([
    gestor
      ? db.from('pessoas').select('id, nome, ferias_dias_fora').eq('ativo', true).is('desligado_em', null).order('nome')
      : Promise.resolve({ data: [] }),
    db.from('ferias').select('id, pessoa_id, inicio, fim, situacao, observacao')
      .gte('fim', somar(hoje, -400)).order('inicio'),
    gestor ? db.rpc('ferias_prazos') : Promise.resolve({ data: [] }),
    db.rpc('nomes_das_pessoas'),
  ]);
  const nome = new Map(((nomes ?? []) as { id: string; nome: string }[]).map((p) => [p.id, p.nome]));

  const lista: FeriasCadastrada[] = (ferias ?? []).map((f) => ({
    id: f.id as string, pessoa_id: f.pessoa_id as string,
    pessoa: nome.get(f.pessoa_id as string) ?? '—',
    inicio: f.inicio as string, fim: f.fim as string,
    situacao: f.situacao as 'planejada' | 'aprovada', observacao: f.observacao as string | null,
  }));
  const todosPrazos = (prazos ?? []) as Prazo[];
  // Atenção só para quem completa 1 ano de casa até o fim deste ano (63).
  const fimDoAno = `${hoje.slice(0, 4)}-12-31`;
  const umAno = (z: Prazo) => !!z.admitido_em
    && `${Number(z.admitido_em.slice(0, 4)) + 1}${z.admitido_em.slice(4)}` <= fimDoAno;
  const prazosDoAviso: PrazoDeFerias[] = todosPrazos.filter((z) => z.saldo != null && z.limite && umAno(z))
    .map((z) => ({ pessoa: z.nome, limite: z.limite!, saldo: z.saldo!, dias: z.dias_ate_limite!, completo: !!z.completo }));
  const avisos = avisosDeFerias(lista, prazosDoAviso, hoje);
  const foraHoje = foraNoDia(lista, hoje);
  // O último dia para sair, marcado no calendário e no quadro do ano (64).
  const prazosNoCalendario = prazosDoAviso.filter((z) => z.saldo > 0).map((z) => ({ pessoa: z.pessoa, limite: z.limite }));
  const diasFora = new Map(((pessoas ?? []) as { id: string; ferias_dias_fora: number | null }[])
    .map((p) => [p.id, p.ferias_dias_fora ?? 0]));

  const tom = (z: Prazo) => z.saldo == null || !umAno(z) ? 'text-slate-400'
    : z.saldo === 0 ? 'text-slate-500'
    : z.dias_ate_limite! < 0 || z.dias_ate_limite! <= 30 ? 'text-rose-700 font-semibold'
    : z.dias_ate_limite! <= 90 ? 'text-amber-700 font-semibold' : 'text-emerald-700';

  return (
    <div className="space-y-6">
      <header className="text-sobre-fundo">
        <h1 className="text-2xl font-bold tracking-tight">Férias</h1>
        <p className="text-sm text-sobre-fundo-suave">
          {foraHoje.length ? `De férias hoje: ${foraHoje.map((f) => f.pessoa.split(/\s+/)[0]).join(', ')}` : 'Ninguém de férias hoje'}
          {gestor && ' · os avisos chegam na Agenda da Gestão'}
        </p>
      </header>

      {avisos.length > 0 && (
        <Painel>
          <Secao titulo="Atenção">
            <ul className="space-y-1.5 text-sm">
              {avisos.map((a) => (
                <li key={a.chave} className="flex gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.grave ? 'bg-rose-500' : 'bg-amber-500'}`} />
                  <span className="text-slate-700">{a.texto}</span>
                </li>
              ))}
            </ul>
          </Secao>
        </Painel>
      )}

      <Painel>
        <Secao titulo="Calendário" acao={
          <div className="flex items-center gap-1 text-sm">
            <Link href={`/cota/ferias?mes=${mesSeguinte(mesAtual, -1).slice(0, 7)}`} className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100" aria-label="Mês anterior">‹</Link>
            <Link href="/cota/ferias" className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">hoje</Link>
            <Link href={`/cota/ferias?mes=${mesSeguinte(mesAtual, 1).slice(0, 7)}`} className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100" aria-label="Próximo mês">›</Link>
          </div>}>
          {/* O mês (e o seguinte) e, ao lado, o ano inteiro com a mesma sinalização. */}
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-6">
              <CalendarioDeFerias periodos={lista} mes={mesAtual} hoje={hoje} prazos={prazosNoCalendario} />
              <CalendarioDeFerias periodos={lista} mes={mesSeguinte(mesAtual, 1)} hoje={hoje} prazos={prazosNoCalendario} />
            </div>
            <QuadroDoAno periodos={lista} prazos={prazosNoCalendario} ano={Number(mesAtual.slice(0, 4))} hoje={hoje}
                         mesAberto={mesAtual.slice(0, 7)} linkDoMes={(m) => `/cota/ferias?mes=${m}`} />
          </div>
        </Secao>
        {gestor && (
          <Secao titulo="Cadastro">
            <GestaoDeFerias pessoas={(pessoas ?? []) as { id: string; nome: string }[]} ferias={lista} hoje={hoje} />
          </Secao>
        )}
      </Painel>

      {gestor && (
      <Painel>
        <Secao titulo="Prazo de cada pessoa (CLT)"
               subtitulo="30 dias por ano trabalhado, a tirar nos 12 meses seguintes; as férias têm de terminar dentro deles, então a saída é até 30 dias antes do fim (ou menos, se já tirou parte). Dias depois do fim saem em dobro. Conta da admissão na empresa (ou, sem ela, da entrada na equipe) e das férias cadastradas aqui. Só sinaliza quem completa 1 ano de casa até o fim do ano.">
          <div className="-mx-6 overflow-x-auto sm:-mx-7">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="px-6 py-2 font-medium sm:px-7">Pessoa</th>
                  <th className="py-2 font-medium">Admissão</th>
                  <th className="py-2 font-medium">Período aquisitivo</th>
                  <th className="py-2 font-medium">Sair até (último dia)</th>
                  <th className="py-2 pr-6 text-right font-medium sm:pr-7">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {todosPrazos.map((z) => (
                  <tr key={z.pessoa_id}>
                    <td className="px-6 py-2 font-medium text-slate-800 sm:px-7">{z.nome}</td>
                    <td className="py-2 tabular-nums text-slate-600">{z.admitido_em ? ddmm(z.admitido_em) + '/' + z.admitido_em.slice(2, 4) : '—'}</td>
                    <td className="py-2 tabular-nums text-slate-600">
                      {z.aquisitivo_inicio ? `${ddmm(z.aquisitivo_inicio)}/${z.aquisitivo_inicio.slice(2, 4)} a ${ddmm(z.aquisitivo_fim!)}/${z.aquisitivo_fim!.slice(2, 4)}` : '—'}
                      {z.completo === false && <span className="ml-1 text-xs text-slate-400">(correndo)</span>}
                    </td>
                    <td className="py-2 tabular-nums text-slate-600">{z.limite ? `${ddmm(z.limite)}/${z.limite.slice(2, 4)}` : '—'}</td>
                    <td className={`py-2 pr-6 text-right sm:pr-7 ${tom(z)}`}>
                      {z.saldo == null ? <Link href="/cota/atendentes" className="underline-offset-2 hover:underline">sem data de entrada</Link>
                        : !umAno(z) ? `menos de 1 ano em ${hoje.slice(0, 4)}`
                        : z.saldo === 0 ? 'em dia'
                        : z.dias_ate_limite! < 0 ? `prazo de saída passou · ${z.saldo} dias`
                        : `${z.saldo} dias · ${z.dias_ate_limite} dias para sair`}
                      {z.saldo != null && (
                        <PeriodoForaDoSistema pessoaId={z.pessoa_id} nome={z.nome} diasFora={diasFora.get(z.pessoa_id) ?? 0}
                                              mostrarBotao={!!z.completo && z.saldo > 0} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
      </Painel>
      )}
    </div>
  );
}
