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

/**
 * Uma superfície para a tela inteira, com seções separadas por linha fina.
 *
 * Substitui a caixa por quadro na tela inicial (1.15.0): com um cartão para
 * cada coisa, a tela virava um mosaico de bordas e sombras iguais, e nada
 * tinha mais peso que o resto. A arte de fundo continua aparecendo nas
 * margens.
 */
export function Painel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`divide-y divide-slate-200 rounded-2xl bg-superficie shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Secao({
  titulo, subtitulo, acao, children,
}: {
  titulo?: string;
  subtitulo?: React.ReactNode;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="px-6 py-6 sm:px-7">
      {(titulo || acao) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            {titulo && <h2 className="text-base font-semibold text-slate-800">{titulo}</h2>}
            {subtitulo && <p className="text-sm text-slate-500">{subtitulo}</p>}
          </div>
          {acao}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Um quadro no formato novo (1.18.0): superfície com seção, no mesmo uso do
 * Cartao. As telas do Performance trocam Cartao por Quadro; as Monitorias
 * seguem com o Cartao, que é outro sistema com outro público.
 */
export function Quadro({ titulo, subtitulo, acao, children, className = '' }: {
  titulo?: string;
  subtitulo?: React.ReactNode;
  acao?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Painel className={className}>
      <Secao titulo={titulo} subtitulo={subtitulo} acao={acao}>{children}</Secao>
    </Painel>
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
  const fracao = (v: number) => Math.max(0, Math.min(1, v / fim));
  return (
    <div className="flex items-center gap-3">
      <span className="relative h-2 flex-1 rounded-full bg-slate-100">
        {/* Largura cheia encolhida por scaleX: cresce ao aparecer (crescer-x). */}
        <span className={`crescer-x absolute inset-0 origin-left rounded-full ${bateu ? 'bg-marca-600' : 'bg-amber-500'}`}
              style={{ transform: `scaleX(${fracao(atingimento)})` }} />
        <span aria-hidden title="Meta"
              className="absolute -inset-y-1 w-0.5 rounded-full bg-slate-500"
              style={{ left: `${fracao(1) * 100}%` }} />
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

/**
 * Tabela que encosta nas bordas do quadro. As margens negativas desfazem o
 * recuo de quem a contém: o Cartao (p-5) ou, com `noQuadro`, o Quadro
 * (px-6/7, com o título acima e às vezes um botão abaixo — por isso só nas
 * laterais).
 */
export function Tabela({ children, noQuadro = false }: { children: React.ReactNode; noQuadro?: boolean }) {
  return (
    <div className={noQuadro ? '-mx-6 overflow-x-auto sm:-mx-7' : '-mx-5 -my-5 overflow-x-auto'}>
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
