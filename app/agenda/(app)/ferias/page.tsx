import CalendarioDeFerias from '@/componentes/CalendarioDeFerias';
import MinhasFerias from '@/componentes/agenda/MinhasFerias';
import { Painel, Secao } from '@/componentes/ui';
import { criarServidorDaAgenda, exigirUsuario } from '@/lib/agenda/db-servidor';
import { feriasDoPerformance } from '@/lib/agenda/ponte';
import { hoje as hojeNoBrasil } from '@/lib/agenda/tempo';
import { avisosDeFerias, ddmm, foraNoDia, type PeriodoDeFerias } from '@/lib/ferias';
import { ENDERECO_PERFORMANCE } from '@/lib/sistema';

export const dynamic = 'force-dynamic';

const mesMais = (m: string, n: number) => {
  const [a, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(a, mm - 1 + n, 1)).toISOString().slice(0, 10);
};

/**
 * Férias: as da equipe (cadastradas no Performance, lidas pela ponte) e as
 * suas (no banco da agenda), no mesmo calendário, com os avisos.
 */
export default async function FeriasDaAgenda() {
  const usuario = await exigirUsuario();
  const db = await criarServidorDaAgenda();
  const hoje = hojeNoBrasil();
  const [{ data: minhas }, equipe] = await Promise.all([
    db.from('minhas_ferias').select('id, inicio, fim, observacao').gte('fim', mesMais(hoje.slice(0, 8) + '01', -2)).order('inicio'),
    usuario.ve_pendencias ? feriasDoPerformance() : Promise.resolve(null),
  ]);

  const minhasLista = (minhas ?? []) as { id: string; inicio: string; fim: string; observacao: string | null }[];
  const periodosMeus: PeriodoDeFerias[] = minhasLista.map((m) => ({ id: m.id, pessoa: usuario.nome, inicio: m.inicio, fim: m.fim, minha: true }));
  const periodosEquipe = equipe?.ferias ?? [];
  const todos = [...periodosMeus, ...periodosEquipe];
  const avisos = avisosDeFerias(todos, equipe?.prazos ?? [], hoje);
  const foraHoje = foraNoDia(periodosEquipe, hoje);
  const mes = `${hoje.slice(0, 8)}01`;

  return (
    <div className="space-y-4">
      <header className="text-sobre-fundo">
        <h1 className="text-2xl font-bold tracking-tight">Férias</h1>
        <p className="text-sm text-sobre-fundo-suave">
          {equipe
            ? foraHoje.length ? `Fora hoje: ${foraHoje.map((f) => f.pessoa.split(/\s+/)[0]).join(', ')}` : 'Ninguém da equipe fora hoje'
            : 'Só as suas férias: a equipe aparece para quem vê as pendências do Performance.'}
        </p>
      </header>

      {avisos.length > 0 && (
        <Painel>
          <Secao titulo="Avisos">
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
        <Secao titulo="Calendário" acao={equipe ? (
          <a href={`${ENDERECO_PERFORMANCE}/cota/ferias`} target="_blank" rel="noopener"
             className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Cadastrar a equipe ↗
          </a>) : undefined}>
          <div className="space-y-6">
            <CalendarioDeFerias periodos={todos} mes={mes} hoje={hoje} />
            <CalendarioDeFerias periodos={todos} mes={mesMais(mes, 1)} hoje={hoje} />
            <CalendarioDeFerias periodos={todos} mes={mesMais(mes, 2)} hoje={hoje} />
          </div>
          {equipe && !equipe.ok && <p className="mt-3 text-xs text-amber-700">Não deu para ler as férias da equipe agora; mostrando só as suas.</p>}
        </Secao>

        <Secao titulo="Minhas férias" subtitulo="Ficam só na agenda, no seu banco.">
          <MinhasFerias minhas={minhasLista} equipe={periodosEquipe} hoje={hoje} />
        </Secao>

        {equipe && equipe.prazos.length > 0 && (
          <Secao titulo="Prazos da CLT" subtitulo="Quem precisa sair de férias nos próximos 120 dias para não pagar em dobro.">
            <ul className="divide-y divide-slate-100 text-sm">
              {equipe.prazos.map((z) => (
                <li key={z.pessoa} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium text-slate-800">{z.pessoa}</span>
                  <span className={z.dias < 0 || z.dias <= 30 ? 'font-semibold text-rose-700' : z.dias <= 90 ? 'font-semibold text-amber-700' : 'text-slate-600'}>
                    {z.dias < 0 ? `vencidas desde ${ddmm(z.limite)}` : `sair até ${ddmm(z.limite)} · ${z.dias} dias`} · {z.saldo} dias a tirar
                  </span>
                </li>
              ))}
            </ul>
            {equipe.semEntrada > 0 && (
              <p className="mt-2 text-xs text-slate-500">{equipe.semEntrada} pessoa{equipe.semEntrada > 1 ? 's' : ''} sem data de entrada no Performance: sem prazo calculado.</p>
            )}
          </Secao>
        )}
      </Painel>
    </div>
  );
}
