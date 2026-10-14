'use client';

import Link from '@/componentes/Link';
import { usePathname } from 'next/navigation';
import BotaoTema from '@/componentes/BotaoTema';
import BotaoSair from '@/componentes/agenda/BotaoSair';
import { Icone, MENU_DA_AGENDA, itemAtivo } from '@/componentes/agenda/menu';

/** Menu lateral da agenda em tela larga, no mesmo desenho do dos painéis. */
export default function MenuLateralDaAgenda({ nome, usuario, versao }: { nome: string; usuario: string; versao: string }) {
  const caminho = usePathname();
  return (
    <aside className="sem-impressao sticky top-0 hidden h-screen flex-col gap-0.5 overflow-y-auto border-r
                      border-slate-200 bg-superficie px-3.5 py-5 lg:flex">
      <span className="px-2.5 pb-5 text-sm font-bold tracking-tight text-marca-700 dark:text-marca-400">
        Agenda da Gestão
      </span>
      <nav className="flex flex-col gap-0.5" aria-label="Menu">
        {MENU_DA_AGENDA.map((item) => {
          const atual = itemAtivo(item.href, caminho);
          return (
            <Link key={item.href} href={item.href} aria-current={atual ? 'page' : undefined}
                  className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                    atual ? 'bg-marca-50 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
              {atual && <span aria-hidden className="absolute -left-3.5 inset-y-2 w-[3px] rounded-r bg-marca-600" />}
              <Icone>{item.icone}</Icone>
              {item.rotulo}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-slate-200 px-2.5 pt-3 text-sm">
        <p className="font-medium text-slate-900">{nome}</p>
        <p className="text-xs text-slate-500">Usuário · {usuario}</p>
        <div className="mt-3 flex items-center gap-2">
          <BotaoTema />
          <BotaoSair />
        </div>
        <p aria-label={`Versão ${versao}`} className="mt-3 select-none text-[10px] tabular-nums text-slate-400/60">v{versao}</p>
      </div>
    </aside>
  );
}
