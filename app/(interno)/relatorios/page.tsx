import Link from 'next/link';
import { exigirPerfil } from '@/lib/supabase/servidor';

const RELATORIOS = [
  {
    href: '/relatorios/ranking',
    titulo: 'Ranking mensal por operador',
    descricao: 'Nota média, número de monitorias, zeradas e evolução mês a mês de cada pessoa.',
  },
  {
    href: '/relatorios/criterios',
    titulo: 'Critérios mais reprovados',
    descricao: 'Onde o time perde nota, por taxa de reprovação e por pontos efetivamente perdidos — serve para direcionar treinamento.',
  },
  {
    href: '/relatorios/feedback',
    titulo: 'Folha de feedback individual',
    descricao: 'Uma página por operador, pronta para imprimir ou salvar em PDF e levar para o 1:1.',
  },
  {
    href: '/api/exportar?formato=xlsx',
    titulo: 'Exportação bruta (Excel)',
    descricao: 'Baixa todas as monitorias e os critérios avaliados em duas abas, para cruzar dados no Excel.',
    externo: true,
  },
];

export default async function Relatorios() {
  await exigirPerfil();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Relatórios</h1>
        <p className="text-sm text-slate-500">
          Todos respeitam seu nível de acesso: operadores enxergam apenas os próprios números.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {RELATORIOS.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm
                       transition hover:border-marca-500 hover:shadow"
          >
            <h2 className="text-sm font-semibold text-slate-900 group-hover:text-marca-700">
              {r.titulo}
              {r.externo && <span className="ml-2 text-xs font-normal text-slate-400">baixar</span>}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{r.descricao}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
