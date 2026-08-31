import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Monitorias de Qualidade — IGreen',
  description: 'Sistema de monitorias de qualidade de atendimento (C-SAT)',
};

export default function LayoutRaiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
