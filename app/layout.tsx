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
      {/* A versão em uso não fica mais aqui: subiu para a barra de navegação,
          sob o nome do sistema. No rodapé ela era invisível na prática — 10px
          e cinza a 50% num canto que ninguém olha. Com isso ela deixa de
          aparecer nas telas de login e de definir senha, que não têm barra;
          quem precisar do número antes de entrar tem `/api/saude`. */}
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
