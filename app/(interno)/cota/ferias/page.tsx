import Link from '@/componentes/Link';
import CalendarioDeFerias from '@/componentes/CalendarioDeFerias';
import GestaoDeFerias, { type FeriasCadastrada } from '@/componentes/GestaoDeFerias';
import { Painel, Secao } from '@/componentes/ui';
import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
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
 * Férias da equipe (migração 61): calendário do mês, cadastro e o prazo de
 * cada pessoa pela CLT. A Agenda da Gestão lê daqui e avisa.
 */
export default async function Ferias({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await exigirGestor();
  const { mes } = await searchParams;
  const hoje = hojeNoBrasil();
  const mesAtual = mesValido(mes) ? `${mes}-01` : `${hoje.slice(0, 7)}-01`;
  const db = await criarClienteServidor();

  const [{ data: pessoas }, { data: ferias }, { data: prazos }] = await Promise.all([
    db.from('pessoas').select('id, nome').eq('ativo', true).is('desligado_em', null).neq('papel', 'gestor').order('nome'),
    db.from('ferias').select('id, pessoa_id, inicio, fim, situacao, observacao, pessoas!ferias_pessoa_id_fkey(nome)')
      .gte('fim', somar(hoje, -400)).order('inicio'),
    db.rpc('ferias_prazos'),
  ]);

  const lista: FeriasCadastrada[] = (ferias ?? []).map((f) => ({
    id: f.id as string, pessoa_id: f.pessoa_id as string,
    pessoa: ((f.pessoas as unknown as { nome: string } | null)?.nome) ?? '—',
    inicio: f.inicio as string, fim: f.fim as string,
    situacao: f.situacao as 'planejada' | 'aprovada', observacao: f.observacao as string | null,
  }));
  const todosPrazos = (prazos ?? []) as Prazo[];
  const prazosDoAviso: PrazoDeFerias[] = todosPrazos.filter((z) => z.saldo != null && z.limite)
    .map((z) => ({ pessoa: z.nome, limite: z.limite!, saldo: z.saldo!, dias: z.dias_ate_limite!, completo: !!z.completo }));
  const avisos = avisosDeFerias(lista, prazosDoAviso, hoje);
  const foraHoje = foraNoDia(lista, hoje);

  const tom = (z: Prazo) => z.saldo == null ? 'text-slate-400'
    : z.saldo === 0 ? 'text-slate-500'
    : z.dias_ate_limite! < 0 || z.dias_ate_limite! <= 30 ? 'text-rose-700 font-semibold'
    : z.dias_ate_limite! <= 90 ? 'text-amber-700 font-semibold' : 'text-emerald-700';

  return (
    <div className="space-y-6">
      <header className="text-sobre-fundo">
        <h1 className="text-2xl font-bold tracking-tight">Férias</h1>
        <p className="text-sm text-sobre-fundo-suave">
          {foraHoje.length ? `De férias hoje: ${foraHoje.map((f) => f.pessoa.split(/\s+/)[0]).join(', ')}` : 'Ninguém de férias hoje'}
          {' · '}os avisos chegam na Agenda da Gestão
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
          <div className="space-y-6">
            <CalendarioDeFerias periodos={lista} mes={mesAtual} hoje={hoje} />
            <CalendarioDeFerias periodos={lista} mes={mesSeguinte(mesAtual, 1)} hoje={hoje} />
          </div>
        </Secao>
        <Secao titulo="Cadastro">
          <GestaoDeFerias pessoas={(pessoas ?? []) as { id: string; nome: string }[]} ferias={lista} hoje={hoje} />
        </Secao>
      </Painel>

      <Painel>
        <Secao titulo="Prazo de cada pessoa (CLT)"
               subtitulo="30 dias por ano trabalhado, a tirar nos 12 meses seguintes; depois disso, pagamento em dobro. Conta pela data de entrada e pelas férias cadastradas aqui.">
          <div className="-mx-6 overflow-x-auto sm:-mx-7">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="px-6 py-2 font-medium sm:px-7">Pessoa</th>
                  <th className="py-2 font-medium">Entrada</th>
                  <th className="py-2 font-medium">Período aquisitivo</th>
                  <th className="py-2 font-medium">Sair até</th>
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
                        : z.saldo === 0 ? 'em dia'
                        : z.dias_ate_limite! < 0 ? `vencidas · ${z.saldo} dias`
                        : `${z.saldo} dias · ${z.dias_ate_limite} dias de prazo`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
      </Painel>
    </div>
  );
}
