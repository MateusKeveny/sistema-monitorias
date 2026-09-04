import Link from '@/componentes/Link';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Cartao, EtiquetaNota, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { data as formatarData, mesRotulo, codigoMonitoria } from '@/lib/formatar';
import type { Monitoria, Operador } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

type Busca = {
  operador?: string; mes?: string; zeradas?: string; pagina?: string;
  ordenar?: string; direcao?: string; busca?: string;
};

const POR_PAGINA = 100;

/**
 * Colunas por onde a lista pode ser ordenada.
 *
 * A relação é fechada de propósito: o nome vem da URL e vai direto para a
 * consulta, então aceitar texto livre deixaria qualquer um ordenar por coluna
 * que a tela não expõe. `crescentePadrao` é a direção que faz sentido no
 * primeiro clique — data começa da mais recente, nome começa de A.
 */
const ORDENAVEIS = {
  codigo: { crescentePadrao: false },
  data_atendimento: { crescentePadrao: false },
  protocolo: { crescentePadrao: true },
  operador: { crescentePadrao: true },
  canal: { crescentePadrao: true },
  semana_mes: { crescentePadrao: true },
  numero_monitoria: { crescentePadrao: true },
  nota_final: { crescentePadrao: true },
} as const;

type ColunaOrdenavel = keyof typeof ORDENAVEIS;

export default async function ListaMonitorias({
  searchParams,
}: {
  searchParams: Promise<Busca>;
}) {
  const perfil = await exigirPerfil();
  const filtros = await searchParams;
  const db = await criarClienteServidor();

  const pagina = Math.max(1, Number(filtros.pagina) || 1);
  const inicio = (pagina - 1) * POR_PAGINA;

  const ordenar: ColunaOrdenavel =
    filtros.ordenar && filtros.ordenar in ORDENAVEIS
      ? filtros.ordenar as ColunaOrdenavel
      : 'data_atendimento';
  const crescente = filtros.direcao
    ? filtros.direcao === 'asc'
    : ORDENAVEIS[ordenar].crescentePadrao;

  // count: 'exact' devolve o total real junto com a página. Antes a lista
  // cortava em 500 sem avisar; agora o total é sempre visível.
  // O segundo critério é fixo, para linhas empatadas não trocarem de posição
  // entre uma página e outra.
  let consulta = db.from('vw_monitorias').select('*', { count: 'exact' })
    .order(ordenar, { ascending: crescente })
    .order('id')
    .range(inicio, inicio + POR_PAGINA - 1);

  if (filtros.operador) consulta = consulta.eq('operador_id', filtros.operador);
  if (filtros.mes) consulta = consulta.eq('mes_referencia', filtros.mes);
  if (filtros.zeradas === 'sim') consulta = consulta.eq('zerado', true);

  /**
   * Busca por código da monitoria ou protocolo do atendimento.
   *
   * O termo é limpo antes de entrar no filtro: vírgula, ponto e parênteses são
   * sintaxe para o PostgREST, e um termo com esses caracteres não faria uma
   * busca — mudaria a consulta. Sobram letras, números, espaço e hífen, que é
   * tudo que protocolo e código podem ter.
   *
   * O `#` e os zeros à esquerda são só apresentação, então "#0042", "0042" e
   * "42" chegam todos na mesma monitoria.
   */
  const termo = (filtros.busca ?? '').trim().replace(/[^A-Za-z0-9 \-#]/g, '');
  if (termo) {
    const numero = Number(termo.replace(/^#/, ''));
    const alternativas = [`protocolo.ilike.*${termo.replace(/^#/, '')}*`];
    if (Number.isSafeInteger(numero) && numero > 0) alternativas.push(`codigo.eq.${numero}`);
    consulta = consulta.or(alternativas.join(','));
  }

  const [{ data: lista, count }, { data: operadores }, { data: meses }] = await Promise.all([
    consulta,
    db.from('pessoas').select('id, nome').eq('avaliado', true).eq('ativo', true).order('nome'),
    db.from('vw_monitorias').select('mes_referencia').order('mes_referencia', { ascending: false }),
  ]);

  const monitorias = (lista ?? []) as Monitoria[];
  const total = count ?? monitorias.length;
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA));

  /** Monta o endereço preservando o que já estava aplicado. */
  const link = (mudancas: Partial<Busca>) => {
    const p = new URLSearchParams();
    const atual: Busca = { ...filtros, ...mudancas };
    if (atual.operador) p.set('operador', atual.operador);
    if (atual.mes) p.set('mes', atual.mes);
    if (atual.zeradas) p.set('zeradas', atual.zeradas);
    if (atual.busca) p.set('busca', atual.busca);
    if (atual.ordenar) p.set('ordenar', atual.ordenar);
    if (atual.direcao) p.set('direcao', atual.direcao);
    if (atual.pagina && atual.pagina !== '1') p.set('pagina', atual.pagina);
    const q = p.toString();
    return q ? `/monitorias?${q}` : '/monitorias';
  };

  const linkPagina = (n: number) => link({ pagina: String(n) });

  /**
   * Clicar numa coluna ordena por ela; clicar de novo inverte. Volta sempre
   * para a primeira página, senão a pessoa continuaria na página 3 de uma
   * ordenação que não existe mais.
   */
  const linkOrdem = (coluna: ColunaOrdenavel) => link({
    ordenar: coluna,
    direcao: ordenar === coluna
      ? (crescente ? 'desc' : 'asc')
      : (ORDENAVEIS[coluna].crescentePadrao ? 'asc' : 'desc'),
    pagina: '1',
  });

  const seta = (coluna: ColunaOrdenavel) =>
    ordenar !== coluna ? '' : crescente ? ' ↑' : ' ↓';
  const mesesUnicos = [...new Set(((meses ?? []) as { mes_referencia: string }[])
    .map((m) => m.mes_referencia))];

  const estilo = `rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                  outline-none focus:border-marca-600`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-sobre-fundo">Monitorias</h1>
          <p className="text-sm text-sobre-fundo-suave">
            {total} registro{total === 1 ? '' : 's'}
            {ultimaPagina > 1 && ` · página ${pagina} de ${ultimaPagina}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/api/exportar?formato=xlsx"
            className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                       font-medium text-slate-700 hover:bg-slate-50">
            Exportar Excel
          </Link>
          {perfil.papel !== 'operador' && (
            <Link href="/monitorias/excluidas"
              className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                         font-medium text-slate-700 hover:bg-slate-50">
              Excluídas
            </Link>
          )}
          {perfil.papel !== 'operador' && (
            <Link href="/monitorias/nova"
              className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white
                         hover:bg-marca-700">
              Nova monitoria
            </Link>
          )}
        </div>
      </div>

      <form className="flex flex-wrap items-center gap-2">
        {/* Filtrar não desfaz a ordenação escolhida. */}
        <input type="hidden" name="ordenar" value={ordenar} />
        <input type="hidden" name="direcao" value={crescente ? 'asc' : 'desc'} />

        {/* Vem primeiro porque é o caminho mais curto até um registro: quem
            sabe o número não precisa de filtro nenhum. */}
        <input
          type="search"
          name="busca"
          defaultValue={filtros.busca ?? ''}
          placeholder="Código ou protocolo"
          aria-label="Buscar por código da monitoria ou protocolo do atendimento"
          className={`${estilo} w-48`}
        />

        {perfil.papel !== 'operador' && (
          <select name="operador" defaultValue={filtros.operador ?? ''} className={estilo}>
            <option value="">Todos os operadores</option>
            {((operadores ?? []) as Operador[]).map((o) => (
              <option key={o.id} value={o.id}>{o.nome}</option>
            ))}
          </select>
        )}

        <select name="mes" defaultValue={filtros.mes ?? ''} className={estilo}>
          <option value="">Todos os meses</option>
          {mesesUnicos.map((m) => <option key={m} value={m}>{mesRotulo(m)}</option>)}
        </select>

        <select name="zeradas" defaultValue={filtros.zeradas ?? ''} className={estilo}>
          <option value="">Todas as notas</option>
          <option value="sim">Somente zeradas</option>
        </select>

        <button type="submit"
          className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                     font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
        <Link href="/monitorias" className="px-2 text-sm text-sobre-fundo-suave hover:underline">
          limpar
        </Link>
      </form>

      <Cartao>
        {monitorias.length === 0 ? (
          <Vazio>Nenhuma monitoria encontrada com esses filtros.</Vazio>
        ) : (
          <Tabela>
            <thead>
              <tr>
                {([
                  ['codigo', 'Código', ''],
                  ['data_atendimento', 'Data', ''],
                  ['protocolo', 'Protocolo', 'text-center'],
                  ['operador', 'Operador', ''],
                  ['canal', 'Canal', ''],
                  ['semana_mes', 'Semana', 'text-center'],
                  ['numero_monitoria', 'Nº', 'text-center'],
                  ['nota_final', 'Nota', 'text-right'],
                ] as [ColunaOrdenavel, string, string][]).map(([coluna, rotulo, alinha]) => (
                  <Th key={coluna} className={alinha}>
                    <Link
                      href={linkOrdem(coluna)}
                      className={`hover:text-slate-900 ${
                        ordenar === coluna ? 'text-slate-900' : ''}`}
                      title={`Ordenar por ${rotulo.toLowerCase()}`}
                    >
                      {rotulo}
                      <span className="tabular-nums">{seta(coluna)}</span>
                    </Link>
                  </Th>
                ))}
                {/* A coluna "abrir" saiu: a linha inteira é o link agora, e
                    duas coisas clicáveis para o mesmo destino confundem. */}
                <Th>Parecer</Th>
              </tr>
            </thead>
            <tbody>
              {monitorias.map((m) => (
                /* A linha inteira abre a monitoria, e o código é o link
                   visível — é por ele que se identifica um registro.

                   O clique vem de um link de verdade, esticado sobre a linha
                   por um `::after`, e não de um `onClick`. Assim ctrl+clique,
                   botão do meio e "abrir em nova aba" continuam funcionando, e
                   o teclado alcança a linha pela tabulação normal. Um
                   manipulador de clique perderia as quatro coisas. */
                <tr key={m.id} className="relative cursor-pointer hover:bg-slate-50
                                          has-[a:focus-visible]:bg-slate-100">
                  <Td className="whitespace-nowrap font-mono tabular-nums">
                    <Link
                      href={`/monitorias/${m.id}`}
                      aria-label={`Abrir monitoria ${codigoMonitoria(m.codigo)}, de ${m.operador}`}
                      className="font-medium text-marca-700 after:absolute after:inset-0
                                 hover:underline focus:outline-none dark:text-marca-400"
                    >
                      {codigoMonitoria(m.codigo)}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">{formatarData(m.data_atendimento)}</Td>
                  {/* Sem tratamento especial: a linha inteira se comporta igual,
                      e só o código é o link. Para copiar o protocolo, o detalhe
                      da monitoria. */}
                  <Td className="whitespace-nowrap text-center font-mono text-xs">
                    {m.protocolo}
                  </Td>
                  <Td className="whitespace-nowrap font-medium text-slate-900">{m.operador}</Td>
                  <Td className="whitespace-nowrap text-slate-500">{m.canal ?? '—'}</Td>
                  <Td className="text-center tabular-nums">{m.semana_mes}ª</Td>
                  <Td className="text-center tabular-nums">{m.numero_monitoria}ª</Td>
                  <Td className="text-right">
                    <EtiquetaNota valor={Number(m.nota_final)} zerado={m.zerado} />
                  </Td>
                  <Td className="max-w-md">
                    <span className="line-clamp-2 text-xs text-slate-500">{m.parecer ?? '—'}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Cartao>

      {ultimaPagina > 1 && (
        <nav className="flex items-center justify-between gap-4">
          {pagina > 1 ? (
            <Link href={linkPagina(pagina - 1)}
              className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                         font-medium text-slate-700 hover:bg-slate-50">
              ← Anteriores
            </Link>
          ) : <span />}

          <span className="text-sm text-sobre-fundo-suave">
            {inicio + 1}–{Math.min(inicio + POR_PAGINA, total)} de {total}
          </span>

          {pagina < ultimaPagina ? (
            <Link href={linkPagina(pagina + 1)}
              className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                         font-medium text-slate-700 hover:bg-slate-50">
              Próximas →
            </Link>
          ) : <span />}
        </nav>
      )}
    </div>
  );
}
