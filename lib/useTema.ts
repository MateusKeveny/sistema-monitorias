'use client';

import { useEffect, useState } from 'react';

/**
 * Informa se o tema escuro está ativo, e continua acompanhando quando a pessoa
 * clica no botão de tema.
 *
 * Serve para o gráfico, que é desenhado em SVG e recebe cores como valores
 * JavaScript — não dá para resolvê-lo pela paleta CSS como o resto da interface.
 * Começa em `false` porque no servidor não existe `document`; o efeito corrige
 * no primeiro quadro do navegador.
 */
export function useTemaEscuro(): boolean {
  const [escuro, setEscuro] = useState(false);

  useEffect(() => {
    const raiz = document.documentElement;
    const ler = () => setEscuro(raiz.classList.contains('dark'));

    ler();

    const observador = new MutationObserver(ler);
    observador.observe(raiz, { attributes: true, attributeFilter: ['class'] });
    return () => observador.disconnect();
  }, []);

  return escuro;
}
