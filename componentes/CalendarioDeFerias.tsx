import { ddmm, foraNoDia, type PeriodoDeFerias } from '@/lib/ferias';

const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];

const curto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');
const nomeCurto = (p: PeriodoDeFerias) => (p.minha ? 'Você' : curto(p.pessoa));

/** Último dia para sair de férias (prazo da CLT, migração 64). */
export type PrazoNoCalendario = { pessoa: string; limite: string };

type Linha = { chave: string; nome: string; periodos: PeriodoDeFerias[]; prazo?: string };

/**
 * Calendário de férias de um mês: uma linha por pessoa, um quadradinho por
 * dia. Verde aprovada, amarelo planejada; dia com duas ou mais pessoas fora
 * fica marcado no topo em rosa, para a falta de cobertura saltar aos olhos.
 * O último dia para sair (prazo da CLT) aparece com contorno vermelho — e a
 * pessoa ganha uma linha no mês do prazo mesmo sem férias marcadas.
 *
 * Servidor puro, sem script; no celular a grade rola de lado. Usado no
 * Performance (/cota/ferias) e na agenda (/agenda/ferias).
 */
export default function CalendarioDeFerias({ periodos, mes, hoje, prazos = [] }: {
  periodos: PeriodoDeFerias[];
  /** Primeiro dia do mês, 'AAAA-MM-01'. */
  mes: string;
  hoje: string;
  prazos?: PrazoNoCalendario[];
}) {
  const [a, m] = mes.split('-').map(Number);
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const dias = Array.from({ length: total }, (_, i) => `${mes.slice(0, 8)}${String(i + 1).padStart(2, '0')}`);
  const fimDoMes = dias[dias.length - 1];

  const doMes = periodos.filter((p) => p.inicio <= fimDoMes && p.fim >= mes);
  const prazosDoMes = prazos.filter((z) => z.limite >= mes && z.limite <= fimDoMes);

  // Uma linha por pessoa (você primeiro), na ordem da primeira saída; depois
  // quem só tem o prazo neste mês.
  const mapa = new Map<string, Linha>();
  for (const p of [...doMes].sort((x, y) => Number(!!y.minha) - Number(!!x.minha) || x.inicio.localeCompare(y.inicio))) {
    const chave = p.minha ? 'eu' : p.pessoa;
    const l = mapa.get(chave) ?? { chave, nome: nomeCurto(p), periodos: [] };
    l.periodos.push(p);
    mapa.set(chave, l);
  }
  for (const z of prazosDoMes) {
    const l = mapa.get(z.pessoa) ?? { chave: z.pessoa, nome: curto(z.pessoa), periodos: [] };
    l.prazo = z.limite;
    mapa.set(z.pessoa, l);
  }
  const linhas = [...mapa.values()];

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
                      <span className={`mx-auto block w-5 rounded ${fora > 1 ? 'bg-rose-100 text-rose-800 font-semibold' : ''}`}>
                        {Number(d.slice(8))}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave}>
                  <td className="sticky left-0 z-10 max-w-36 truncate bg-superficie py-0.5 pr-3 font-medium text-slate-700">
                    {l.nome}
                  </td>
                  {dias.map((d) => {
                    const p = l.periodos.find((q) => q.inicio <= d && q.fim >= d);
                    const ehPrazo = l.prazo === d;
                    const cor = !p ? '' : p.minha ? 'bg-sky-500' : p.situacao === 'planejada' ? 'bg-amber-400' : 'bg-marca-600';
                    const titulo = [p ? `${nomeCurto(p)}: ${ddmm(p.inicio)} a ${ddmm(p.fim)}` : null,
                      ehPrazo ? `${l.nome}: último dia para sair de férias (${ddmm(d)})` : null].filter(Boolean).join(' · ');
                    return (
                      <td key={d} className="px-[1px] py-0.5">
                        <span title={titulo || undefined}
                              className={`block h-4 rounded-sm ${cor || (d === hoje ? 'bg-slate-200' : 'bg-slate-100')} ${
                                ehPrazo ? 'ring-2 ring-inset ring-rose-600' : ''}`} />
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
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> planejadas</span>
        {periodos.some((p) => p.minha) && <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" /> você</span>}
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-100 ring-1 ring-rose-300" /> 2+ pessoas fora</span>
        {prazos.length > 0 && <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-100 ring-2 ring-inset ring-rose-600" /> último dia para sair</span>}
      </p>
    </div>
  );
}
