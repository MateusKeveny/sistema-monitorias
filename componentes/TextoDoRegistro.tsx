'use client';

import { Fragment, useState } from 'react';

/** "**Acesso ao Expert**" vira negrito; o resto do texto passa como veio. */
export function comNegrito(linha: string) {
  return linha.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith('**') && parte.endsWith('**') && parte.length > 4
      ? <strong key={i} className="font-semibold text-slate-800">{parte.slice(2, -2)}</strong>
      : <Fragment key={i}>{parte}</Fragment>);
}

/**
 * O texto de um registro do diário em até 3 linhas, com "ver mais" (3.0;
 * compartilhado com a consulta das Monitorias na 6.2.0). Na lista, os textos
 * longos empurravam tudo para baixo, e o negrito aparecia como asteriscos.
 */
export default function TextoDoRegistro({ texto, className = 'text-sm text-slate-700' }: { texto: string; className?: string }) {
  const [inteiro, setInteiro] = useState(false);
  const longo = texto.length > 220 || texto.split('\n').length > 3;
  return (
    <div>
      <p className={`whitespace-pre-line ${className} ${!inteiro && longo ? 'line-clamp-3' : ''}`}>{comNegrito(texto)}</p>
      {longo && (
        <button type="button" onClick={() => setInteiro((v) => !v)}
                className="mt-0.5 text-xs text-marca-700 hover:underline dark:text-marca-400">
          {inteiro ? 'ver menos' : 'ver mais'}
        </button>
      )}
    </div>
  );
}
