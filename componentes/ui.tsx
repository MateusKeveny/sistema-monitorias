import { CORES_FAIXA, faixa, nota as formatarNota } from '@/lib/formatar';

export function Cartao({
  titulo, acao, children, className = '',
}: {
  titulo?: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-superficie shadow-sm ${className}`}>
      {(titulo || acao) && (
        <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-3">
          {titulo && <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>}
          {acao}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Indicador({
  rotulo, valor, detalhe, tom = 'neutro',
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  tom?: 'neutro' | 'bom' | 'alerta' | 'ruim';
}) {
  const tons = {
    neutro: 'text-slate-900',
    bom: 'text-emerald-700',
    alerta: 'text-amber-700',
    ruim: 'text-rose-700',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-superficie px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tons[tom]}`}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-slate-500">{detalhe}</p>}
    </div>
  );
}

/** Nota colorida pela faixa de desempenho. Usada em todas as tabelas. */
export function EtiquetaNota({ valor, zerado = false }: { valor: number | null; zerado?: boolean }) {
  const cor = zerado ? CORES_FAIXA.critico : CORES_FAIXA[faixa(valor)];
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs
                      font-semibold tabular-nums ring-1 ring-inset ${cor}`}>
      {formatarNota(valor)}
      {zerado && <span className="ml-1 font-normal">zerada</span>}
    </span>
  );
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-10 text-center text-sm text-slate-500">{children}</p>
  );
}

export function Tabela({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-5 -my-5 overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export const Th = ({ children, className = '' }:
  { children?: React.ReactNode; className?: string }) => (
  <th className={`whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5
                  text-left text-xs font-semibold uppercase tracking-wide
                  text-slate-600 ${className}`}>
    {children}
  </th>
);

export const Td = ({ children, className = '' }:
  { children?: React.ReactNode; className?: string }) => (
  <td className={`border-b border-slate-100 px-4 py-2.5 align-top text-slate-700 ${className}`}>
    {children}
  </td>
);
