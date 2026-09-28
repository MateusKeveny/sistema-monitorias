/**
 * As quatro semanas do ciclo em barras, com o valor escrito em cima.
 *
 * Sem biblioteca de gráfico: é CSS puro montado no servidor, como o resto da
 * tela inicial. Serve para qualquer medida semanal — volume, TME, C-SAT —,
 * desde que venha o formatador.
 *
 * Cores na escala única do painel: verde da marca por padrão, âmbar quando a
 * semana pede atenção (TME acima da média). A barra cresce por `scaleY`, que o
 * navegador anima sem recalcular a página.
 */
export default function GraficoSemanal({
  valores, formatar, media, referencias = [], cor = 'bg-marca-600', piorEMaior = false,
}: {
  /** Um valor por semana, na ordem; `null` = semana sem dado. */
  valores: (number | null)[];
  formatar: (v: number) => string;
  /** Linha de referência da equipe no mês. */
  media?: number | null;
  /** Marcas fixas, como as faixas de 15 e 30 min do TME. */
  referencias?: { valor: number; rotulo: string }[];
  cor?: string;
  /** Quando maior é pior — TME —, a barra acima da média fica em âmbar. */
  piorEMaior?: boolean;
}) {
  const maximo = Math.max(
    1,
    ...valores.filter((v): v is number => v != null),
    ...referencias.map((r) => r.valor),
    media ?? 0,
  );
  const fracao = (v: number) => Math.max(0.02, Math.min(1, v / maximo));
  const altura = (v: number) => `${fracao(v) * 100}%`;
  const acima = (v: number) => piorEMaior && media != null && v > media;

  return (
    <div className="space-y-2">
      <div className="relative flex h-28 items-end gap-2">
        {referencias.map((r) => (
          <span key={r.rotulo} title={r.rotulo}
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-amber-500/60"
                style={{ bottom: altura(r.valor) }} />
        ))}
        {media != null && (
          <span title={`Média do mês: ${formatar(media)}`}
                className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-slate-400"
                style={{ bottom: altura(media) }} />
        )}

        {valores.map((v, i) => (
          <div key={i} className="relative h-full flex-1">
            <span
              className={`crescer-y absolute inset-0 origin-bottom rounded-t ${
                v == null ? 'bg-slate-100' : acima(v) ? 'bg-amber-500' : cor}`}
              style={{ transform: `scaleY(${v == null ? 0.02 : fracao(v)})` }}
            />
            <span className="absolute inset-x-0 text-center text-[11px] font-semibold tabular-nums text-slate-700"
                  style={{ bottom: `calc(${v == null ? '2%' : altura(v)} + 2px)` }}>
              {v == null ? '—' : formatar(v)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex gap-2 text-center text-[11px] text-slate-500">
        {valores.map((_, i) => <span key={i} className="flex-1">{i + 1}ª sem.</span>)}
      </div>

      {(media != null || referencias.length > 0 || piorEMaior) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-slate-500">
          {media != null && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 border-t border-dashed border-slate-400" />
              média do mês {formatar(media)}
            </span>
          )}
          {piorEMaior && media != null && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm bg-amber-500" />
              acima da média
            </span>
          )}
          {referencias.map((r) => (
            <span key={r.rotulo} className="flex items-center gap-1">
              <span className="inline-block w-4 border-t border-dashed border-amber-500/60" />
              {r.rotulo}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
