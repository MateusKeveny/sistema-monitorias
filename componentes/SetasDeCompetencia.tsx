import Link from '@/componentes/Link';

/** '2026-09-01' → '2026-08-01' (passo -1) ou '2026-10-01' (passo 1). */
function andar(competencia: string, passo: number) {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7)) - 1 + passo;
  const d = new Date(Date.UTC(ano, mes, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** '2026-09-01' → 'Setembro de 2026'. */
function mesPorExtenso(competencia: string) {
  const d = new Date(`${competencia}T12:00:00Z`);
  const t = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * O mês é o título da tela e troca pelas setas (1.15.0).
 *
 * Substitui o campo de mês com o botão "Abrir": dois cliques e um calendário
 * do navegador para ir ao mês vizinho, que é quase sempre o que se quer. A
 * seta da frente para no mês de hoje — não há competência futura para ver.
 *
 * `manter` leva junto os outros filtros da URL (canal, pessoa), para trocar o
 * mês não desfazer o resto da escolha.
 */
export default function SetasDeCompetencia({
  competencia, atual, caminho, manter = {}, compacto = false, disponiveis,
}: {
  competencia: string;
  atual: string;
  caminho: string;
  manter?: Record<string, string | undefined>;
  /** Abaixo de um título maior (a saudação): mês menor, em h2. */
  compacto?: boolean;
  /**
   * Meses que existem de fato, do mais novo ao mais antigo. Quando vem, as
   * setas andam só por eles (5.2.0): nas Monitorias o mês vizinho do
   * calendário pode não ter monitoria nenhuma, e a seta levaria a uma tela
   * vazia. Sem a lista, anda de mês em mês, como nasceu na cota.
   */
  disponiveis?: string[];
}) {
  const endereco = (c: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(manter)) if (v) p.set(k, v);
    p.set('mes', c.slice(0, 7));
    return `${caminho}?${p}`;
  };
  const naLista = disponiveis?.indexOf(competencia) ?? -1;
  // A lista vem do mais novo ao mais antigo: avançar é andar para trás nela.
  const anterior = disponiveis ? disponiveis[naLista + 1] : andar(competencia, -1);
  const seguinte = disponiveis ? disponiveis[naLista - 1] : andar(competencia, 1);
  const botao = `grid ${compacto ? 'h-7 w-7 text-sm' : 'h-9 w-9 text-lg'} shrink-0 place-items-center rounded-full
                 border border-white/35 bg-black/15 leading-none text-sobre-fundo transition hover:bg-black/30`;
  const Titulo = compacto ? 'h2' : 'h1';

  return (
    <div className="flex items-center gap-2">
      {anterior ? (
        <Link href={endereco(anterior)} aria-label={`Ir para ${mesPorExtenso(anterior)}`} className={botao}>‹</Link>
      ) : (
        <span aria-hidden className={`${botao} pointer-events-none opacity-30`}>‹</span>
      )}
      <Titulo className={`text-center font-semibold text-sobre-fundo ${compacto
        ? 'min-w-40 text-lg' : 'min-w-60 text-2xl tracking-tight sm:text-3xl'}`}>
        {mesPorExtenso(competencia)}
      </Titulo>
      {seguinte && seguinte <= atual ? (
        <Link href={endereco(seguinte)} aria-label={`Ir para ${mesPorExtenso(seguinte)}`} className={botao}>›</Link>
      ) : (
        <span aria-hidden className={`${botao} pointer-events-none opacity-30`}>›</span>
      )}
    </div>
  );
}
