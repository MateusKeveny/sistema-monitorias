import { redirect } from 'next/navigation';
import Link from '@/componentes/Link';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Painel, Secao, Vazio } from '@/componentes/ui';
import { mesRotulo } from '@/lib/formatar';

export const dynamic = 'force-dynamic';

type PessoaDoRanking = {
  pessoa_id: string; nome: string; cargo: string | null; setor?: string | null;
  pontos: number; meses: number; por_mes: Record<string, number>;
};
type SetorDoRanking = { id: number; nome: string; pessoas: PessoaDoRanking[] };
type Ranking = { setores: SetorDoRanking[]; gestao: PessoaDoRanking[] | null };

const pts = (v: number) => Math.round(Number(v)).toLocaleString('pt-BR');
const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');
const mesCurto = (iso: string) => mesRotulo(iso).split(' ')[0].slice(0, 3);

const PODIO = [
  { lugar: '1º', anel: 'ring-amber-400/70', fundo: 'bg-amber-50 dark:bg-amber-500/10', cor: 'text-amber-700 dark:text-amber-300', altura: 'sm:pt-2' },
  { lugar: '2º', anel: 'ring-slate-300', fundo: 'bg-slate-50 dark:bg-white/5', cor: 'text-slate-600 dark:text-slate-300', altura: 'sm:pt-6' },
  { lugar: '3º', anel: 'ring-orange-300/70', fundo: 'bg-orange-50 dark:bg-orange-500/10', cor: 'text-orange-700 dark:text-orange-300', altura: 'sm:pt-9' },
];

/**
 * Cruzeiro (4.0.0, migração 98): o ranking de cada setor com a soma dos
 * pontos dos meses escolhidos — só quem atende (Júnior, Pleno, Sênior,
 * Analista); gestor e acima ficam fora. A CEO (e o administrador) vê também a
 * gestão de todos os setores num ranking à parte. Só entram as cotas
 * aprovadas pela CEO (finalizadas). O gestor vê o setor dele. Só pontos.
 */
/**
 * O ranking geral (CEO): os operadores de todos os setores numa lista só.
 * Quem trocou de setor no período soma os pontos dos dois e mostra os dois.
 */
function rankingGeral(setores: SetorDoRanking[]): PessoaDoRanking[] {
  const porPessoa = new Map<string, PessoaDoRanking>();
  for (const s of setores) {
    for (const p of s.pessoas) {
      const ja = porPessoa.get(p.pessoa_id);
      if (!ja) { porPessoa.set(p.pessoa_id, { ...p, setor: s.nome, por_mes: { ...p.por_mes } }); continue; }
      ja.pontos = Number(ja.pontos) + Number(p.pontos);
      ja.meses += p.meses;
      for (const [m, v] of Object.entries(p.por_mes)) ja.por_mes[m] = Number(ja.por_mes[m] ?? 0) + Number(v);
      if (!ja.setor?.split(' · ').includes(s.nome)) ja.setor = `${ja.setor} · ${s.nome}`;
    }
  }
  return [...porPessoa.values()].sort((a, b) => Number(b.pontos) - Number(a.pontos) || a.nome.localeCompare(b.nome));
}

export default async function Cruzeiro({ searchParams }: { searchParams: Promise<{ meses?: string; setor?: string }> }) {
  const perfil = await exigirPerfil();
  if (perfil.papel !== 'diretoria' && perfil.papel !== 'gestor') redirect('/cota');
  const { meses: pedido, setor: setorPedido } = await searchParams;
  const db = await criarClienteServidor();

  const { data: mesesDb } = await db.rpc('meses_do_cruzeiro');
  const disponiveis = ((mesesDb ?? []) as string[]).map((m) => m.slice(0, 10));
  const pedidos = (pedido ?? '').split(',').map((m) => `${m}-01`).filter((m) => disponiveis.includes(m));
  // Sem escolha no endereço: todos os meses com cota aprovada.
  const escolhidos = (pedido ? pedidos : disponiveis).slice().sort();

  const { data: rankingDb, error } = escolhidos.length
    ? await db.rpc('cruzeiro', { p_meses: escolhidos })
    : { data: null, error: null };
  const ranking = (rankingDb ?? { setores: [], gestao: null }) as Ranking;
  const setores = ranking.setores ?? [];
  const gestao = ranking.gestao;
  // A CEO (e o administrador) recebe a gestão: abre no ranking geral, com a
  // escolha de um setor. O gestor vê o setor dele, sem escolha.
  const visaoGeral = gestao != null;
  const setorEscolhido = visaoGeral ? setores.find((s) => String(s.id) === setorPedido) ?? null : null;

  /** O endereço com os meses e o setor (vazio = geral). */
  const endereco = (meses: string[], setor: string | null) => {
    const q = new URLSearchParams();
    if (meses.length !== disponiveis.length || !meses.every((m) => disponiveis.includes(m))) q.set('meses', meses.map((x) => x.slice(0, 7)).join(','));
    if (setor) q.set('setor', setor);
    const t = q.toString().replace(/%2C/g, ',');
    return `/cota/cruzeiro${t ? `?${t}` : ''}`;
  };
  /** O endereço com o mês ligado ou desligado. */
  const alternar = (m: string) => {
    const novo = escolhidos.includes(m) ? escolhidos.filter((x) => x !== m) : [...escolhidos, m].sort();
    return endereco(novo, setorEscolhido ? String(setorEscolhido.id) : null) + (novo.length ? '' : (setorEscolhido ? '&' : '?') + 'meses=');
  };
  const nada = !setores.length && !(gestao ?? []).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
          <svg aria-hidden viewBox="0 0 20 20" className="flutua h-8 w-8 text-marca-600 dark:text-marca-400" fill="none"
               stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <><path d="M1.5 11H17l1.6-1.3-2.7 5.8H1.5" /><path d="M1.5 8.2H11l2.1 2.8M1.5 5.6h6l1.6 2.6M3.4 5.6V3.2h2.5l.3 2.4" /><path d="M4.8 13.2h.01M7.8 13.2h.01M10.8 13.2h.01M13.6 13.2h.01" strokeWidth="2" /><path d="M1 18.2c1.4 0 1.4-.7 2.8-.7s1.4.7 2.8.7 1.4-.7 2.8-.7 1.4.7 2.8.7 1.4-.7 2.8-.7 1.4.7 2.8.7" /></>
          </svg>
          Cruzeiro
        </h1>
        <p className="text-sm text-slate-500">
          {visaoGeral
            ? 'O ranking geral de quem atende, de todos os setores, e o da gestão; escolha um setor para ver só ele.'
            : 'O ranking do setor, somando os pontos dos meses escolhidos: só quem atende (gestão fora).'}
          {' '}Soma os meses escolhidos; só entram as cotas aprovadas pela CEO.
        </p>
      </div>

      {disponiveis.length === 0 ? (
        <Painel><Secao><Vazio>Nenhuma cota aprovada ainda. O ranking aparece assim que a CEO aprovar o primeiro mês.</Vazio></Secao></Painel>
      ) : (
        <>
          {/* Os meses com cota aprovada: clique para incluir ou tirar da soma. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium text-slate-500">Meses na soma:</span>
            {disponiveis.slice().sort().map((m) => {
              const ligado = escolhidos.includes(m);
              return (
                <Link key={m} href={alternar(m)} aria-pressed={ligado}
                      className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition-colors ${ligado
                        ? 'bg-marca-600 text-white ring-marca-600'
                        : 'bg-superficie text-slate-600 ring-slate-200 hover:ring-marca-600/50'}`}>
                  {ligado ? '✓ ' : ''}{mesRotulo(m)}
                </Link>
              );
            })}
            {escolhidos.length !== disponiveis.length && (
              <Link href={endereco(disponiveis, setorEscolhido ? String(setorEscolhido.id) : null)} className="ml-1 text-xs text-marca-700 hover:underline dark:text-marca-400">todos</Link>
            )}
          </div>

          {/* CEO: o ranking geral ou um setor. */}
          {visaoGeral && setores.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-medium text-slate-500">Ver:</span>
              {[{ id: null as string | null, nome: 'Geral · todos os setores' }, ...setores.map((s) => ({ id: String(s.id), nome: s.nome }))].map((o) => {
                const ativo = (setorEscolhido ? String(setorEscolhido.id) : null) === o.id;
                return (
                  <Link key={o.id ?? 'geral'} href={endereco(escolhidos, o.id)} aria-current={ativo ? 'true' : undefined}
                        className={`rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 transition-colors ${ativo
                          ? 'bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white'
                          : 'bg-superficie text-slate-600 ring-slate-200 hover:ring-slate-400'}`}>
                    {o.nome}
                  </Link>
                );
              })}
            </div>
          )}

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">Não foi possível montar o ranking: {error.message}</p>}

          {escolhidos.length === 0 ? (
            <Painel><Secao><Vazio>Escolha pelo menos um mês para montar o ranking.</Vazio></Secao></Painel>
          ) : nada ? (
            <Painel><Secao><Vazio>Nenhuma cota aprovada nos meses escolhidos.</Vazio></Secao></Painel>
          ) : (
            visaoGeral ? (
              setorEscolhido ? (
                <>
                  <BlocoDoRanking titulo={setorEscolhido.nome} pessoas={setorEscolhido.pessoas} escolhidos={escolhidos} />
                  {(() => {
                    const daGestao = (gestao ?? []).filter((g) => g.setor === setorEscolhido.nome);
                    return daGestao.length > 0 && (
                      <BlocoDoRanking titulo={`Gestão · ${setorEscolhido.nome}`} pessoas={daGestao} escolhidos={escolhidos} />
                    );
                  })()}
                </>
              ) : (
                <>
                  {setores.length > 0 && (
                    <BlocoDoRanking titulo="Geral · todos os setores" pessoas={rankingGeral(setores)} escolhidos={escolhidos} comSetor
                                    detalhe="Quem atende, de todos os setores, num ranking só." />
                  )}
                  {(gestao ?? []).length > 0 && (
                    <BlocoDoRanking titulo="Gestão · todos os setores" pessoas={gestao ?? []} escolhidos={escolhidos} comSetor
                                    detalhe="Gestores (e acima) de todos os setores, num ranking só." />
                  )}
                </>
              )
            ) : (
              setores.map((s) => (
                <BlocoDoRanking key={s.id} titulo={s.nome} pessoas={s.pessoas} escolhidos={escolhidos} />
              ))
            )
          )}
        </>
      )}
    </div>
  );
}

/** Um ranking: o pódio dos 3 primeiros e a classificação completa. */
function BlocoDoRanking({ titulo, pessoas, escolhidos, comSetor = false, detalhe }: {
  titulo: string; pessoas: PessoaDoRanking[]; escolhidos: string[];
  /** Ranking da gestão: mostra o setor de cada um. */
  comSetor?: boolean; detalhe?: string;
}) {
  return (
    <section className="surgir space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
          {detalhe && <p className="text-xs text-slate-500">{detalhe}</p>}
        </div>
        <span className="text-xs text-slate-500">
          {pessoas.length} pessoa{pessoas.length === 1 ? '' : 's'} · {escolhidos.length} {escolhidos.length === 1 ? 'mês' : 'meses'}
        </span>
      </div>

      {/* O pódio: os 3 primeiros, o 1º ao centro. */}
      <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
        {[1, 0, 2].map((i) => {
          const p = pessoas[i];
          if (!p) return <div key={i} className="hidden sm:block" />;
          const est = PODIO[i];
          return (
            <div key={p.pessoa_id} className={`${est.altura} ${i === 0 ? 'order-first sm:order-none' : ''}`}>
              <div className={`estala rounded-2xl px-5 py-4 text-center ring-2 ${est.anel} ${est.fundo}`} style={{ animationDelay: `${i * 90}ms` }}>
                <p className={`text-2xl font-bold ${est.cor}`}>{est.lugar}</p>
                <p className="mt-1 truncate font-semibold text-slate-900" title={p.nome}>{nomeCurto(p.nome)}</p>
                <p className="text-xs text-slate-500">{[p.cargo, comSetor ? p.setor : null].filter(Boolean).join(' · ') || '—'}</p>
                <p className="mt-2 text-xl font-semibold tabular-nums text-slate-900">{pts(p.pontos)} <span className="text-sm font-normal text-slate-500">pts</span></p>
              </div>
            </div>
          );
        })}
      </div>

      <Painel>
        <Secao titulo="Classificação" subtitulo={`Soma de ${escolhidos.map((m) => mesRotulo(m).split(' ')[0].toLowerCase()).join(', ')}. Quem não teve cota aprovada num mês fica com — nele.`}>
          <div className="-mx-6 overflow-x-auto sm:-mx-7">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="w-14 py-2.5 pl-6 pr-2 text-left font-medium sm:pl-7">#</th>
                  <th className="px-3 py-2.5 text-left font-medium">Colaborador</th>
                  {comSetor && <th className="px-3 py-2.5 text-left font-medium">Setor</th>}
                  <th className="px-3 py-2.5 text-left font-medium">Cargo</th>
                  {escolhidos.length > 1 && escolhidos.map((m) => (
                    <th key={m} className="px-3 py-2.5 text-right font-medium">{mesCurto(m)}</th>
                  ))}
                  <th className="py-2.5 pl-3 pr-6 text-right font-medium sm:pr-7">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pessoas.map((p, i) => (
                  <tr key={p.pessoa_id} className={i < 3 ? 'bg-marca-50/40 dark:bg-marca-500/5' : ''}>
                    <td className={`py-2.5 pl-6 pr-2 font-semibold sm:pl-7 ${i < 3 ? PODIO[i].cor : 'text-slate-500'}`}>{i + 1}º</td>
                    <td className="px-3 py-2.5 font-medium text-slate-900">{p.nome}</td>
                    {comSetor && <td className="px-3 py-2.5 text-slate-600">{p.setor ?? '—'}</td>}
                    <td className="px-3 py-2.5 text-slate-600">{p.cargo ?? '—'}</td>
                    {escolhidos.length > 1 && escolhidos.map((m) => {
                      const v = p.por_mes[m.slice(0, 7)];
                      return <td key={m} className="px-3 py-2.5 text-right text-slate-500">{v == null ? '—' : pts(v)}</td>;
                    })}
                    <td className="py-2.5 pl-3 pr-6 text-right font-semibold text-slate-900 sm:pr-7">{pts(p.pontos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
      </Painel>
    </section>
  );
}
