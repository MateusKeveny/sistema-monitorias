'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import BotaoTema from '@/componentes/BotaoTema';
import { NOMES_PAPEL, type Perfil } from '@/lib/tipos';

type Item = { href: string; rotulo: string; papeis: Perfil['papel'][] };

// O operador não tem "Relatórios": todos eles são recortes do time, e o que é
// dele já está em "Monitorias" e no painel. Menu com item que não acrescenta
// nada é ruído.
const ITENS: Item[] = [
  { href: '/', rotulo: 'Painel', papeis: ['gestor', 'qualidade', 'operador'] },
  { href: '/monitorias', rotulo: 'Monitorias', papeis: ['gestor', 'qualidade', 'operador'] },
  { href: '/monitorias/nova', rotulo: 'Nova monitoria', papeis: ['gestor', 'qualidade'] },
  { href: '/relatorios', rotulo: 'Relatórios', papeis: ['gestor', 'qualidade'] },
  { href: '/configuracoes', rotulo: 'Configurações', papeis: ['gestor'] },
];

export default function Navegacao({ perfil }: { perfil: Perfil }) {
  const caminho = usePathname();
  const router = useRouter();

  async function sair() {
    await criarClienteNavegador().auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const ativo = (href: string) =>
    href === '/' ? caminho === '/' : caminho.startsWith(href);

  return (
    <header className="sem-impressao sticky top-0 z-20 border-b border-slate-200 bg-superficie">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <span className="text-sm font-bold tracking-tight text-marca-700 dark:text-marca-400">
          Monitorias de Qualidade
        </span>

        <nav className="flex flex-1 flex-wrap items-center gap-1">
          {ITENS.filter((i) => i.papeis.includes(perfil.papel)).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                ativo(item.href)
                  ? 'bg-marca-50 text-marca-700 dark:text-marca-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {item.rotulo}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-right sm:block">
            <span className="block font-medium text-slate-800">{perfil.nome}</span>
            <span className="block text-xs text-slate-500">{NOMES_PAPEL[perfil.papel]}</span>
          </span>
          <BotaoTema />
          <button
            onClick={sair}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm
                       font-medium text-slate-700 hover:bg-slate-50"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}
