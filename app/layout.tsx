import type { Metadata } from 'next';
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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
