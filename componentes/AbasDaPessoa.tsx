import Link from '@/componentes/Link';

/**
 * Extrato e Histórico (4.13.0): a mesma pessoa no mês e ao longo dos meses.
 * Eram dois itens do menu; agora são duas abas do Extrato, e a pessoa
 * escolhida passa de uma para a outra.
 */
export default function AbasDaPessoa({ atual, pessoa }: { atual: 'extrato' | 'historico'; pessoa?: string }) {
  const q = pessoa ? `?pessoa=${pessoa}` : '';
  const abas = [
    { chave: 'extrato', rotulo: 'No mês', href: `/cota/extrato${q}` },
    { chave: 'historico', rotulo: 'Mês a mês (fechados)', href: `/cota/historico${q}` },
  ] as const;
  return (
    <div role="tablist" className="inline-flex gap-1 rounded-full border border-slate-200 bg-superficie p-1 shadow-sm">
      {abas.map((a) => (
        <Link key={a.chave} role="tab" aria-selected={a.chave === atual} href={a.href}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-colors ${
                a.chave === atual ? 'bg-marca-600 font-semibold text-white' : 'font-medium text-slate-600 hover:text-slate-900'}`}>
          {a.rotulo}
        </Link>
      ))}
    </div>
  );
}
