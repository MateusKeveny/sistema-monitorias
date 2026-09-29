'use client';

import Link from '@/componentes/Link';
import { usePathname, useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import BotaoTema from '@/componentes/BotaoTema';
import { ITENS, type Item } from '@/componentes/Navegacao';
import { NOMES_PAPEL, type Perfil } from '@/lib/tipos';

/** Ícones de traço, desenhados para 20×20. Só os do Performance. */
const ICONES: Record<string, React.ReactNode> = {
  '/cota': <path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3v-4H7v4H4a1 1 0 0 1-1-1V9.5Z" />,
  '/cota/comparativo': <path d="M3 15 8 9l3 3 6-7M13 5h4v4" />,
  '/cota/extrato': <path d="M5 3h10v14H5zM8 7h4M8 10h4M8 13h2" />,
  '/cota/historico': <path d="M3 16h14M6 13V9M10 13V5M14 13v-3" />,
  // Caderno aberto: o diário de bordo.
  '/cota/diario': <><path d="M5 3.5h8.5A1.5 1.5 0 0 1 15 5v11.5H6.5A1.5 1.5 0 0 1 5 15z" /><path d="M8 7h4M8 10h4" /></>,
  '/cota/presencial': <><circle cx="10" cy="7" r="3" /><path d="M4 17c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5" /></>,
  '/cota/lancamentos': <path d="M10 4v12M4 10h12" />,
  '/cota/importar': <path d="M10 3v9m0 0-3-3m3 3 3-3M4 14v2h12v-2" />,
  '/cota/fechamento': <><rect x="4" y="9" width="12" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>,
  '/cota/atendentes': <><circle cx="7" cy="8" r="2.5" /><circle cx="14" cy="8" r="2.5" /><path d="M2.5 16c.7-2.3 2.4-3.5 4.5-3.5s3.8 1.2 4.5 3.5M11 12.6c.9-.1 2-.1 3 0 1.9.3 3 1.3 3.5 3.4" /></>,
  '/cota/configuracao': <><circle cx="10" cy="10" r="2.5" /><path d="M10 3v2m0 10v2m7-7h-2M5 10H3m11.9-4.9-1.4 1.4M6.5 13.5l-1.4 1.4m9.8 0-1.4-1.4M6.5 6.5 5.1 5.1" /></>,
};

/**
 * Menu lateral do Performance (1.15.0), em tela larga.
 *
 * Com o menu em coluna, os grupos ficam à vista — Registrar, Fechar,
 * Administrar — sem menus que abrem, e há espaço para as páginas que vêm
 * (os históricos da 1.16.0). Em janela estreita o layout volta ao cabeçalho
 * do topo (Navegacao), que já sabe se arrumar sem espaço.
 *
 * O Fechamento não tem grupo no menu do topo — cabe sozinho —, mas aqui ganha
 * o seu: é uma etapa do mês, não uma consulta.
 */
export default function MenuLateral({ perfil, versao }: { perfil: Perfil; versao: string }) {
  const caminho = usePathname();
  const router = useRouter();

  async function sair() {
    await criarClienteNavegador().auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const ativo = (href: string) => href === '/cota' ? caminho === href : caminho.startsWith(href);
  const grupoDe = (i: Item) => i.grupo ?? (i.href === '/cota/fechamento' ? 'Fechar' : undefined);

  const visiveis = ITENS.cota.filter((i) => i.papeis.includes(perfil.papel));
  let grupoAnterior: string | undefined;

  return (
    <aside className="sem-impressao sticky top-0 hidden h-screen flex-col gap-0.5 overflow-y-auto border-r
                      border-slate-200 bg-superficie px-3.5 py-5 lg:flex">
      <span className="px-2.5 pb-5 text-sm font-bold tracking-tight text-marca-700 dark:text-marca-400">
        Painel de Performance
      </span>

      <nav className="flex flex-col gap-0.5" aria-label="Menu">
        {visiveis.map((item) => {
          const grupo = grupoDe(item);
          const titulo = grupo && grupo !== grupoAnterior ? grupo : null;
          grupoAnterior = grupo;
          const aceso = ativo(item.href);
          return (
            <div key={item.href}>
              {titulo && <p className="mx-2.5 mb-1 mt-4 text-xs text-slate-500">{titulo}</p>}
              <Link
                href={item.href}
                aria-current={aceso ? 'page' : undefined}
                className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                  aceso ? 'bg-marca-50 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                {aceso && <span aria-hidden className="absolute -left-3.5 inset-y-2 w-[3px] rounded-r bg-marca-600" />}
                <svg aria-hidden viewBox="0 0 20 20" className="h-[18px] w-[18px] shrink-0 opacity-80" fill="none"
                     stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  {ICONES[item.href]}
                </svg>
                {item.rotulo}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-slate-200 px-2.5 pt-3 text-sm">
        <p className="font-medium text-slate-900">{perfil.nome}</p>
        <p className="text-xs text-slate-500">{NOMES_PAPEL[perfil.papel]}</p>
        <div className="mt-3 flex items-center gap-2">
          <BotaoTema />
          <button onClick={sair}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Sair
          </button>
        </div>
        {/* Apagada de propósito: serve para quem reporta um problema dizer em qual versão viu. */}
        <p aria-label={`Versão ${versao}`} className="mt-3 select-none text-[10px] tabular-nums text-slate-400/60">
          v{versao}
        </p>
      </div>
    </aside>
  );
}
