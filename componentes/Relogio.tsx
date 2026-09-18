'use client';

import { useEffect, useState } from 'react';

const FUSO = 'America/Sao_Paulo';

/**
 * Hora e data no fuso da operação, atualizadas a cada minuto.
 *
 * Só aparece depois de montar no navegador: renderizado no servidor, o
 * horário sairia do instante da renderização e piscaria ao hidratar.
 */
export default function Relogio() {
  const [agora, setAgora] = useState<Date | null>(null);

  useEffect(() => {
    setAgora(new Date());
    const id = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!agora) return <div className="h-10 w-24" aria-hidden />;

  return (
    <div className="text-right leading-tight">
      <p className="text-2xl font-semibold tabular-nums text-sobre-fundo">
        {agora.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className="text-sm capitalize text-sobre-fundo-suave">
        {agora.toLocaleDateString('pt-BR', {
          timeZone: FUSO, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
        })}
      </p>
    </div>
  );
}
