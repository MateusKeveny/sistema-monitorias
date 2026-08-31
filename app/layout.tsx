import type { Metadata } from 'next';
import { version } from '@/package.json';
import './globals.css';

export const metadata: Metadata = {
  title: 'Monitorias de Qualidade — IGreen',
  description: 'Sistema de monitorias de qualidade de atendimento (C-SAT)',
};

/**
 * Aplica o tema antes da primeira pintura.
 *
 * Precisa ser um script inline e síncrono: se a classe fosse posta por efeito
 * do React, a página apareceria clara por um instante antes de escurecer. Sem
 * escolha salva, segue a preferência do sistema operacional.
 */
const APLICAR_TEMA = `
(function () {
  try {
    var salvo = localStorage.getItem('monitorias:tema');
    var escuro = salvo
      ? salvo === 'escuro'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (escuro) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function LayoutRaiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APLICAR_TEMA }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}

        {/* Versão em uso. Discreta de propósito: serve para quem reporta um
            problema dizer em qual versão viu, sem competir com o conteúdo.
            `pointer-events-none` garante que nunca atrapalhe um clique. */}
        <span
          aria-label={`Versão ${version}`}
          className="sem-impressao pointer-events-none fixed bottom-2 right-3 z-50
                     select-none text-[10px] tabular-nums text-slate-400/50"
        >
          v{version}
        </span>
      </body>
    </html>
  );
}
