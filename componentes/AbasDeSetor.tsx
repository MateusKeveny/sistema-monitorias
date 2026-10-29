import Link from 'next/link';

/**
 * Abas de setor do sistema de Monitorias (6.0): uma por setor com monitorias.
 * Com um setor só (o caso de hoje, a Conexão Expansão) não aparece nada — a
 * tela fica como sempre foi. Navegação: troca o `?setor=` do endereço,
 * mantendo os outros parâmetros.
 */
export default function AbasDeSetor({ setores, atual, caminho, outros = {} }: {
  setores: { id: number; nome: string }[];
  atual: number;
  caminho: string;
  /** Os outros parâmetros da tela (mês, pessoa…), que a troca de setor mantém. */
  outros?: Record<string, string | undefined>;
}) {
  if (setores.length < 2) return null;
  const endereco = (id: number) => {
    const q = new URLSearchParams(Object.entries({ ...outros, setor: String(id) })
      .filter((p): p is [string, string] => !!p[1]));
    return `${caminho}?${q}`;
  };
  return (
    <div role="tablist" aria-label="Setor"
         className="inline-flex flex-wrap gap-1 rounded-full border border-slate-200 bg-superficie p-1 shadow-sm">
      {setores.map((s) => (
        <Link key={s.id} role="tab" aria-selected={s.id === atual} href={endereco(s.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${s.id === atual
                ? 'bg-marca-600 font-semibold text-white' : 'text-slate-600 hover:text-slate-900'}`}>
          {s.nome}
        </Link>
      ))}
    </div>
  );
}
