import Link from 'next/link';

export type ResumoDoSetor = { id: number; nome: string; pessoas: number; cargos: number; monitorias: boolean };

/**
 * ① O setor (3.2.0): o primeiro passo das telas de regras.
 *
 * Administrador: um cartão por setor, e o escolhido vale para todas as abas
 * (pesos, filas, faixas, histórico). Gestor: o setor dele, fixo — só para
 * situar, sem trocar.
 */
export default function PassoDoSetor({
  setores, atual, administrador, caminho, cat,
}: {
  setores: ResumoDoSetor[];
  atual: number;
  administrador: boolean;
  /** A tela onde o passo está (o link mantém a aba aberta). */
  caminho: string;
  cat?: string;
}) {
  const escolhido = setores.find((s) => s.id === atual);
  if (!administrador || setores.length < 2) {
    return escolhido ? (
      <p className="flex flex-wrap items-center gap-2 text-sm text-sobre-fundo-suave">
        <span className="text-xs font-semibold uppercase tracking-wider">Setor</span>
        <span className="rounded-full bg-superficie px-3.5 py-1.5 font-semibold text-slate-800 shadow-sm">{escolhido.nome}</span>
        <span className="text-xs">{escolhido.pessoas} pessoas · {escolhido.cargos} cargos</span>
      </p>
    ) : null;
  }
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-sobre-fundo-suave">Setor</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {setores.map((s) => {
          const ativo = s.id === atual;
          return (
            <Link key={s.id} href={`${caminho}?setor=${s.id}${cat ? `&cat=${cat}` : ''}`} aria-current={ativo ? 'true' : undefined}
                  className={`rounded-2xl border bg-superficie px-4 py-3 shadow-sm transition ${ativo
                    ? 'border-marca-600 ring-2 ring-marca-600/25' : 'border-transparent hover:border-slate-300'}`}>
              <span className="block truncate font-semibold text-slate-900">{s.nome}</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {s.pessoas} pessoas · {s.cargos} cargos{s.monitorias ? ' · com monitorias' : ''}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
