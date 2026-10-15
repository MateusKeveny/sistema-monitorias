import Link from '@/componentes/Link';
import { foraNoDia, type PeriodoDeFerias } from '@/lib/ferias';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/**
 * O ano inteiro de férias, ao lado do calendário do mês: doze mini-meses com
 * a mesma sinalização — verde aprovada, amarelo só planejada, contorno rosa
 * com duas ou mais pessoas fora. Cada mês leva ao calendário dele.
 */
export default function QuadroDoAno({ periodos, ano, hoje, mesAberto, linkDoMes }: {
  periodos: PeriodoDeFerias[];
  ano: number;
  hoje: string;
  /** 'AAAA-MM' do mês aberto no calendário, para destacar. */
  mesAberto: string;
  /** Endereço do calendário daquele mês. */
  linkDoMes: (mes: string) => string;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-slate-800">{ano}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
        {MESES.map((rotulo, i) => {
          const mes = `${ano}-${String(i + 1).padStart(2, '0')}`;
          const total = new Date(Date.UTC(ano, i + 1, 0)).getUTCDate();
          const vazios = new Date(Date.UTC(ano, i, 1)).getUTCDay();
          const dias = Array.from({ length: total }, (_, d) => `${mes}-${String(d + 1).padStart(2, '0')}`);
          const comFerias = periodos.some((p) => p.inicio <= `${mes}-31` && p.fim >= `${mes}-01`);
          return (
            <Link key={mes} href={linkDoMes(mes)} aria-label={`Abrir ${rotulo} de ${ano}`}
                  className={`rounded-lg p-1.5 transition-colors hover:bg-slate-50 ${mes === mesAberto ? 'ring-1 ring-marca-600/60' : ''}`}>
              <p className={`mb-1 text-[11px] font-semibold ${comFerias ? 'text-slate-800' : 'text-slate-400'}`}>{rotulo}</p>
              <div className="grid grid-cols-7 gap-[2px]">
                {LETRAS.map((l, k) => <span key={k} className="text-center text-[7px] leading-none text-slate-400">{l}</span>)}
                {Array.from({ length: vazios }, (_, k) => <span key={`v${k}`} />)}
                {dias.map((d) => {
                  const fora = foraNoDia(periodos, d);
                  const aprovada = fora.some((p) => p.minha || p.situacao !== 'planejada');
                  const cor = !fora.length ? (d === hoje ? 'bg-slate-300' : 'bg-slate-100')
                    : aprovada ? 'bg-marca-600' : 'bg-amber-400';
                  return (
                    <span key={d} title={fora.length ? `${d.slice(8)}/${d.slice(5, 7)}: ${fora.map((p) => p.pessoa.split(/\s+/)[0]).join(', ')}` : undefined}
                          className={`block aspect-square rounded-[2px] ${cor} ${fora.length > 1 ? 'ring-1 ring-rose-500' : ''}`} />
                  );
                })}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
