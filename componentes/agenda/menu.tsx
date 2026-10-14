/** Itens e ícones do menu da agenda — a barra de baixo e o menu lateral. */
export const MENU_DA_AGENDA: { href: string; rotulo: string; icone: React.ReactNode }[] = [
  // O sol do dia, o calendário, o visto, a engrenagem. Traço para 20×20.
  { href: '/agenda', rotulo: 'Meu dia',
    icone: <><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></> },
  { href: '/agenda/proximos', rotulo: 'Próximos',
    icone: <><rect x="3.5" y="4.5" width="13" height="12" rx="1.5" /><path d="M3.5 8.5h13M7 3v3M13 3v3" /></> },
  { href: '/agenda/feitos', rotulo: 'Feitos',
    icone: <><circle cx="10" cy="10" r="7" /><path d="m6.8 10.2 2.2 2.2 4.2-4.6" /></> },
  { href: '/agenda/ajustes', rotulo: 'Ajustes',
    icone: <><circle cx="10" cy="10" r="2.5" /><path d="M10 3v2m0 10v2m7-7h-2M5 10H3m11.9-4.9-1.4 1.4M6.5 13.5l-1.4 1.4m9.8 0-1.4-1.4M6.5 6.5 5.1 5.1" /></> },
];

/** A raiz só acende nela mesma; as outras, nelas e no que vem embaixo. */
export const itemAtivo = (href: string, caminho: string) =>
  href === '/agenda' ? caminho === href : caminho === href || caminho.startsWith(`${href}/`);

export function Icone({ children, grosso = false, className = 'h-[18px] w-[18px]' }:
  { children: React.ReactNode; grosso?: boolean; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={`${className} shrink-0`} fill="none" stroke="currentColor"
         strokeWidth={grosso ? 1.9 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
