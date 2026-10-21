import { Quadro, Tabela, Td, Th } from '@/componentes/ui';
import { data as formatarData } from '@/lib/formatar';
import { FALHA_CRITICA, type LinhaRepeticao } from '@/lib/repeticoes';

const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** Cor da contagem no mês: mais forte quanto mais vezes o critério apareceu. */
const TOM_DA_CONTAGEM = ['bg-slate-100 font-normal text-slate-400', 'bg-rose-500/20 text-rose-700',
  'bg-rose-500/35 text-rose-700', 'bg-rose-500/60 text-white'];

/**
 * O quadro "O que mais se repete" (2.6.0), da pessoa ou da equipe (2.7.0 /
 * 5.7.0). Da pessoa: a última observação de cada critério, o ponto de partida
 * do feedback. Da equipe: no lugar dela, quantas pessoas tiveram o critério
 * no mês mais recente — na equipe a observação seria de uma pessoa só.
 *
 * Tendência: a taxa do mês mais recente contra a do anterior (vezes por
 * monitoria, ver lib/repeticoes); "resolvido" é o que apareceu antes e
 * sumiu nos dois últimos meses.
 */
export default function OQueMaisSeRepete({ linhas, janela, equipe }: {
  linhas: LinhaRepeticao[]; janela: string[];
  /** Na equipe: quantas pessoas foram monitoradas no mês mais recente. */
  equipe?: { monitoradas: number };
}) {
  if (linhas.length === 0) return null;
  const visiveis = equipe ? linhas.slice(0, 10) : linhas;
  // A escala da cor acompanha o tamanho: na equipe as contagens são maiores.
  const maior = Math.max(...visiveis.flatMap((l) => l.meses));
  const nivel = (q: number) => (!q ? 0 : !equipe ? Math.min(q, 3) : Math.min(3, Math.ceil((q / maior) * 3)));

  const TENDENCIA = {
    resolvido: { texto: '✓ resolvido', cor: 'text-marca-700 dark:text-marca-400' },
    aumentou: { texto: '▲ aumentou', cor: 'text-rose-700' },
    diminuiu: { texto: '▼ diminuiu', cor: 'text-marca-700 dark:text-marca-400' },
    estavel: { texto: '= estável', cor: 'font-normal text-slate-500' },
  };

  return (
    <Quadro titulo={equipe ? 'O que mais se repete na equipe' : 'O que mais se repete'}
            subtitulo={equipe
              ? 'Critérios reprovados nos últimos 3 meses, em toda a equipe — onde vale um treinamento coletivo.'
              : 'Critérios reprovados nos últimos 3 meses — o ponto de partida para o feedback.'}>
      <Tabela noQuadro>
        <thead>
          <tr>
            <Th>Critério</Th>
            {janela.map((m) => <Th key={m} className="text-center">{NOMES_MES[Number(m.slice(5, 7)) - 1]}</Th>)}
            <Th className="text-center">Total</Th>
            {equipe && <Th>Pessoas em {NOMES_MES[Number(janela[2].slice(5, 7)) - 1]}</Th>}
            <Th>Tendência</Th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((l) => {
            const t = TENDENCIA[l.tendencia];
            const sumiu = l.meses[1] === 0 && l.meses[2] === 0;
            return (
              <tr key={l.criterio}>
                <Td className="align-top">
                  <span className={`font-semibold ${l.criterio === FALHA_CRITICA ? 'text-rose-700' : 'text-slate-900'}`}>{l.criterio}</span>
                  {!equipe && (
                    <span className="mt-0.5 line-clamp-2 text-[12.5px] text-slate-500" title={l.ultima.texto ?? undefined}>
                      <span className="font-medium text-slate-600">Última, {formatarData(l.ultima.data).slice(0, 5)}</span>
                      {sumiu ? ' — não apareceu mais desde então.' : l.ultima.texto ? `: ${l.ultima.texto}` : ''}
                    </span>
                  )}
                </Td>
                {l.meses.map((q, i) => (
                  <Td key={i} className="text-center align-top">
                    <span className={`inline-grid h-6 min-w-[1.6rem] place-items-center rounded-md px-1 text-[12.5px] font-semibold tabular-nums ${TOM_DA_CONTAGEM[nivel(q)]}`}>
                      {q || '—'}
                    </span>
                  </Td>
                ))}
                <Td className="text-center align-top font-bold tabular-nums">{l.total}</Td>
                {equipe && (
                  <Td className="whitespace-nowrap align-top text-[12.5px] tabular-nums text-slate-600">
                    {l.pessoas ? `${l.pessoas} de ${equipe.monitoradas}` : '—'}
                  </Td>
                )}
                <Td className={`whitespace-nowrap align-top text-[12.5px] font-semibold ${t.cor}`}>{t.texto}</Td>
              </tr>
            );
          })}
        </tbody>
      </Tabela>
    </Quadro>
  );
}
