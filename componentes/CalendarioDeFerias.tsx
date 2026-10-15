import { ddmm, foraNoDia, type PeriodoDeFerias } from '@/lib/ferias';

const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];

const nomeCurto = (p: PeriodoDeFerias) => (p.minha ? 'Você' : p.pessoa.trim().split(/\s+/).slice(0, 2).join(' '));

/**
 * Calendário de férias de um mês: uma linha por pessoa, um quadradinho por
 * dia. Dia com duas ou mais pessoas fora fica marcado no topo (âmbar), para a
 * falta de cobertura saltar aos olhos. Servidor puro, sem script; no celular
 * a grade rola de lado.
 *
 * Usado no Performance (/cota/ferias) e na agenda (/agenda/ferias).
 */
export default function CalendarioDeFerias({ periodos, mes, hoje }: {
  periodos: PeriodoDeFerias[];
  /** Primeiro dia do mês, 'AAAA-MM-01'. */
  mes: string;
  hoje: string;
}) {
  const [a, m] = mes.split('-').map(Number);
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const dias = Array.from({ length: total }, (_, i) => `${mes.slice(0, 8)}${String(i + 1).padStart(2, '0')}`);
  const fimDoMes = dias[dias.length - 1];

  const doMes = periodos.filter((p) => p.inicio <= fimDoMes && p.fim >= mes);
  // Uma linha por pessoa (você primeiro), na ordem da primeira saída.
  const linhas = [...new Map(doMes
    .sort((x, y) => Number(!!y.minha) - Number(!!x.minha) || x.inicio.localeCompare(y.inicio))
    .map((p) => [`${p.minha ? 'eu' : p.pessoa}`, doMes.filter((q) => q.pessoa === p.pessoa && !!q.minha === !!p.minha)])).values()];

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-slate-800">
        {MESES[m - 1].replace(/^./, (c) => c.toUpperCase())} de {a}
      </p>
      {!linhas.length ? (
        <p className="py-6 text-center text-sm text-slate-500">Ninguém de férias neste mês.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <table className="border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-superficie pr-3 text-left font-medium text-slate-500" />
                {dias.map((d) => {
                  const fora = foraNoDia(doMes, d).length;
                  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
                  return (
                    <th key={d} title={fora > 1 ? `${fora} pessoas fora em ${ddmm(d)}` : undefined}
                        className={`w-6 min-w-6 px-0 pb-1 text-center font-normal tabular-nums ${
                          d === hoje ? 'text-marca-700 dark:text-marca-400 font-bold' : dow === 0 || dow === 6 ? 'text-slate-400' : 'text-slate-500'}`}>
                      <span className="block text-[9px]">{LETRAS[dow]}</span>
                      <span className={`mx-auto block w-5 rounded ${fora > 1 ? 'bg-amber-100 text-amber-800 font-semibold' : ''}`}>
                        {Number(d.slice(8))}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {linhas.map((ps) => (
                <tr key={`${ps[0].minha ? 'eu' : ps[0].pessoa}`}>
                  <td className="sticky left-0 z-10 max-w-36 truncate bg-superficie py-0.5 pr-3 font-medium text-slate-700">
                    {nomeCurto(ps[0])}
                  </td>
                  {dias.map((d) => {
                    const p = ps.find((q) => q.inicio <= d && q.fim >= d);
                    const cor = !p ? '' : p.minha ? 'bg-sky-500' : p.situacao === 'planejada'
                      ? 'bg-marca-500/40 ring-1 ring-inset ring-marca-600/50' : 'bg-marca-600';
                    return (
                      <td key={d} className="px-[1px] py-0.5">
                        <span title={p ? `${nomeCurto(p)}: ${ddmm(p.inicio)} a ${ddmm(p.fim)}` : undefined}
                              className={`block h-4 rounded-sm ${cor || (d === hoje ? 'bg-slate-200' : 'bg-slate-100')}`} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-marca-600" /> aprovadas</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-marca-500/40 ring-1 ring-inset ring-marca-600/50" /> planejadas</span>
        {periodos.some((p) => p.minha) && <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" /> você</span>}
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-100 ring-1 ring-amber-300" /> 2+ pessoas fora</span>
      </p>
    </div>
  );
}
