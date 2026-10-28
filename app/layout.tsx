import type { Metadata, Viewport } from 'next';
import { NOME_SISTEMA } from '@/lib/sistema';
import { sistemaAtual } from '@/lib/sistema-servidor';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const sistema = await sistemaAtual();
  // A agenda se instala como aplicativo (migração 59): manifesto e ícones só nela.
  if (sistema === 'agenda') {
    return {
      title: 'Agenda da Gestão — IGreen',
      description: 'Lembretes, pendências e o plano do dia da gestão',
      manifest: '/agenda.webmanifest',
      icons: { icon: '/agenda-192.png', apple: '/agenda-192.png' },
      appleWebApp: { capable: true, title: 'Agenda', statusBarStyle: 'default' },
    };
  }
  return {
    title: `${NOME_SISTEMA[sistema]} — IGreen`,
    description: sistema === 'cota'
      ? 'Acompanhamento de cota por cargo'
      : 'Sistema de monitorias de qualidade de atendimento (C-SAT)',
  };
}

export async function generateViewport(): Promise<Viewport> {
  return (await sistemaAtual()) === 'agenda' ? { themeColor: '#005d0c' } : {};
}

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

export default async function LayoutRaiz({ children }: { children: React.ReactNode }) {
  // O visual da 3.0 (globals.css, data-visual="3") é do Performance; Monitorias
  // e Agenda seguem no visual de antes.
  const sistema = await sistemaAtual();
  return (
    <html lang="pt-BR" suppressHydrationWarning data-visual={sistema === 'cota' ? '3' : undefined}>
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
