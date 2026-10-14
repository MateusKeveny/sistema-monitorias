import BotaoDesfazer from '@/componentes/agenda/BotaoDesfazer';
import { Painel, Vazio } from '@/componentes/ui';
import { criarServidorDaAgenda, exigirUsuario } from '@/lib/agenda/db-servidor';
import { diaLocal, hoje, horaLocal, rotuloDoDia, somarDias } from '@/lib/agenda/tempo';
import { categoria, type Concluido } from '@/lib/agenda/tipos';

export const dynamic = 'force-dynamic';

const DIAS = 30;

/** O que foi feito nos últimos 30 dias, dia a dia, com "Desfazer". */
export default async function Feitos() {
  await exigirUsuario();
  const db = await criarServidorDaAgenda();
  const desde = somarDias(hoje(), -DIAS);
  const { data } = await db.from('agenda_concluidos')
    .select('id, item_id, titulo, categoria, vence_em, concluido_em')
    .gte('concluido_em', `${desde}T00:00:00-03:00`)
    .order('concluido_em', { ascending: false }).limit(500);
  const feitos = (data ?? []) as Concluido[];

  const porDia = new Map<string, Concluido[]>();
  for (const f of feitos) {
    const d = diaLocal(f.concluido_em);
    porDia.set(d, [...(porDia.get(d) ?? []), f]);
  }
  const naSemana = feitos.filter((f) => diaLocal(f.concluido_em) > somarDias(hoje(), -7)).length;

  return (
    <div className="space-y-4">
      <header className="text-sobre-fundo">
        <h1 className="text-2xl font-bold tracking-tight">Feitos</h1>
        <p className="text-sm text-sobre-fundo-suave">
          {naSemana} nos últimos 7 dias · {feitos.length} nos últimos {DIAS}
        </p>
      </header>

      <Painel>
        {!feitos.length && <Vazio>Nada concluído nos últimos {DIAS} dias.</Vazio>}
        {[...porDia.entries()].map(([dia, lista]) => (
          <section key={dia} className="px-4 py-5 sm:px-6">
            <header className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-slate-800">{rotuloDoDia(dia)}</h2>
              <span className="text-xs text-slate-500">{lista.length}</span>
            </header>
            <ul className="divide-y divide-slate-100">
              {lista.map((f) => {
                const cat = categoria(f.categoria);
                return (
                  <li key={f.id} className="flex items-center gap-3 py-2">
                    <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-marca-600 text-white">
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 10.5 3.2 3.2L15 6.5" /></svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-700">{f.titulo}</p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        às {horaLocal(f.concluido_em)}
                        {f.categoria !== 'geral' && <span className={`rounded px-1.5 py-px font-medium ${cat.cor}`}>{cat.rotulo}</span>}
                      </p>
                    </div>
                    {f.item_id && <BotaoDesfazer id={f.id} />}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </Painel>
    </div>
  );
}
