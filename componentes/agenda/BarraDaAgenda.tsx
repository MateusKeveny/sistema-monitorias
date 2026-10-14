'use client';

import Link from '@/componentes/Link';
import { usePathname } from 'next/navigation';
import { Icone, MENU_DA_AGENDA, itemAtivo } from '@/componentes/agenda/menu';

/**
 * Menu da agenda no celular: barra fixa embaixo, ao alcance do polegar, como
 * num aplicativo. Em tela larga some e fica o menu lateral.
 */
export default function BarraDaAgenda() {
  const caminho = usePathname();
  return (
    <nav aria-label="Menu"
         className="sem-impressao fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-superficie/95 backdrop-blur
                    pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto flex max-w-md justify-around">
        {MENU_DA_AGENDA.map((item) => {
          const ativo = itemAtivo(item.href, caminho);
          return (
            <li key={item.href} className="flex-1">
              <Link href={item.href} aria-current={ativo ? 'page' : undefined}
                    className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                      ativo ? 'text-marca-700 dark:text-marca-400' : 'text-slate-500'}`}>
                <Icone grosso={ativo} className="h-6 w-6">{item.icone}</Icone>
                {item.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
