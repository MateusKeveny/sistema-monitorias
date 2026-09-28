import { CORES_FAIXA, faixa, nota as formatarNota, percentual } from '@/lib/formatar';

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

/**
 * Atingimento da meta em barra, com a meta marcada.
 *
 * A meta é a porta do pagamento — abaixo dela não se calcula valor, e um só
 * com direito abaixo derruba o bônus de todos —, então a barra existe para
 * responder "passou ou não passou". Por isso:
 *   - a meta é um traço fixo na barra, não o fim dela; a barra vai além, e
 *     152% e 118% deixam de parecer iguais;
 *   - abaixo da meta a barra muda de cor, e o texto diz, para não depender só
 *     da cor.
 *
 * `escala` é o atingimento que enche a barra inteira. Numa tabela, passe o
 * mesmo valor para todas as linhas, senão as barras não se comparam.
 */
export function BarraDeMeta({ atingimento, escala = 1.5 }: { atingimento: number; escala?: number }) {
  const fim = Math.max(1.1, escala);
  const bateu = atingimento >= 1;
  const largura = (v: number) => `${Math.max(0, Math.min(100, (v / fim) * 100))}%`;
  return (
    <div className="flex items-center gap-3">
      <span className="relative h-2 flex-1 rounded-full bg-slate-100">
        <span className={`absolute inset-y-0 left-0 rounded-full ${bateu ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: largura(atingimento) }} />
        <span aria-hidden title="Meta"
              className="absolute -inset-y-1 w-0.5 rounded-full bg-slate-500"
              style={{ left: largura(1) }} />
      </span>
      <Atingimento valor={atingimento} className="w-24" />
    </div>
  );
}

/** Percentual da meta; abaixo dela, em destaque e dito por escrito. */
export function Atingimento({ valor, className = '' }: { valor: number; className?: string }) {
  const bateu = valor >= 1;
  return (
    <span className={`inline-flex items-baseline justify-end gap-1.5 text-right tabular-nums ${className}`}>
      {!bateu && <span className="text-xs font-normal text-amber-700">abaixo</span>}
      <span className={`text-xs font-semibold ${bateu ? 'text-slate-700' : 'text-amber-700'}`}>
        {percentual(valor)}
      </span>
    </span>
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

export const Td = ({ children, className = '', colSpan }:
  { children?: React.ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan}
      className={`border-b border-slate-100 px-4 py-2.5 align-top text-slate-700 ${className}`}>
    {children}
  </td>
);
