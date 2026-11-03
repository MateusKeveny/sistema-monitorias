/**
 * Conferência antes de fechar (3.4.0, pedido do gestor em 03/11/2026, depois
 * do volume da 4ª semana do João Vitor importado com 3 em vez de 197).
 *
 * Olha os números de cada pessoa, semana a semana e por fila, e aponta o que
 * foge do padrão — sem decidir nada: o gestor confere e fecha mesmo assim, se
 * estiver certo. Grave = provavelmente erro de dado (importação).
 */
export type Volume = { pessoa_id: string; semana: number; canal: string; finalizados: number };
export type Csat = { pessoa_id: string; semana: number; origem: string; avaliacoes: number; positivas: number };
export type Alerta = { pessoa_id: string; pessoa: string; grave: boolean; texto: string };

const avaliacoes = (n: number) => `${n} ${n === 1 ? 'avaliação' : 'avaliações'}`;
const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

export function conferirMes({ pessoas, volumes, csats, semanasEncerradas, filas, volumeMesAnterior, outroSetor = new Map() }: {
  /** Quem está na cota do mês (o setor já filtrado). */
  pessoas: { pessoa_id: string; pessoa: string }[];
  volumes: Volume[];
  csats: Csat[];
  /** Só semanas que já terminaram: semana em curso não é anormalidade. */
  semanasEncerradas: number;
  /** Apelido → nome da fila, para o texto. */
  filas: Map<string, string>;
  /** Finalizados de cada pessoa no mês anterior: some num mês e não no outro. */
  volumeMesAnterior: Map<string, number>;
  /** Atendimentos em outro setor (iGreen Mob…) por "pessoa|semana": explicam uma queda de volume. */
  outroSetor?: Map<string, number>;
}): Alerta[] {
  const alertas: Alerta[] = [];
  const semanas = [1, 2, 3, 4].slice(0, semanasEncerradas);
  const nomeFila = (c: string) => filas.get(c) ?? c;

  for (const p of pessoas) {
    const add = (grave: boolean, texto: string) => alertas.push({ pessoa_id: p.pessoa_id, pessoa: p.pessoa, grave, texto });
    const vols = volumes.filter((v) => v.pessoa_id === p.pessoa_id);
    const cs = csats.filter((c) => c.pessoa_id === p.pessoa_id);
    const totalMes = vols.filter((v) => semanas.includes(v.semana)).reduce((a, v) => a + Number(v.finalizados), 0);

    // Sem volume no mês, mas com volume no anterior: nome que não casou na importação?
    if (semanas.length && totalMes === 0 && (volumeMesAnterior.get(p.pessoa_id) ?? 0) >= 20) {
      add(true, `Nenhum finalizado no mês (no mês anterior: ${volumeMesAnterior.get(p.pessoa_id)}).`);
    }

    const filasDaPessoa = [...new Set([...vols.map((v) => v.canal), ...cs.map((c) => c.origem)])];
    for (const fila of filasDaPessoa) {
      const fin = (s: number) => vols.filter((v) => v.canal === fila && v.semana === s).reduce((a, v) => a + Number(v.finalizados), 0);
      const temVolume = (s: number) => vols.some((v) => v.canal === fila && v.semana === s);
      const av = (s: number) => cs.filter((c) => c.origem === fila && c.semana === s).reduce((a, c) => a + Number(c.avaliacoes), 0);
      const pos = (s: number) => cs.filter((c) => c.origem === fila && c.semana === s).reduce((a, c) => a + Number(c.positivas), 0);

      for (const s of semanas) {
        // Avaliação sem atendimento: impossível — o volume da semana está errado.
        if (av(s) > 0 && !temVolume(s)) {
          add(true, `${nomeFila(fila)}, semana ${s}: ${avaliacoes(av(s))} e nenhum volume lançado.`);
        } else if (av(s) > fin(s)) {
          add(true, `${nomeFila(fila)}, semana ${s}: ${avaliacoes(av(s))} para só ${fin(s)} finalizados.`);
        }
      }

      // Queda ou salto de volume contra a média das outras semanas da pessoa na fila.
      const comVolume = semanas.filter((s) => temVolume(s));
      if (comVolume.length >= 3) {
        for (const s of comVolume) {
          const outras = comVolume.filter((x) => x !== s);
          const media = outras.reduce((a, x) => a + fin(x), 0) / outras.length;
          if (media < 20) continue;
          if (fin(s) < media * 0.4) {
            // Atendeu em outro setor na semana: explica a queda; vira atenção, não erro.
            const fora = outroSetor.get(`${p.pessoa_id}|${s}`) ?? 0;
            add(fora === 0, `${nomeFila(fila)}, semana ${s}: ${fin(s)} finalizados, muito abaixo das outras semanas (média ${Math.round(media)})`
              + (fora ? `; na semana, ${fora} atendimentos em outro setor (demanda extra).` : '.'));
          }
          else if (fin(s) > media * 2.5) add(false, `${nomeFila(fila)}, semana ${s}: ${fin(s)} finalizados, muito acima das outras semanas (média ${Math.round(media)}).`);
        }
        // Semana encerrada sem volume numa fila em que a pessoa atende com regularidade.
        for (const s of semanas.filter((x) => !temVolume(x))) {
          const media = comVolume.reduce((a, x) => a + fin(x), 0) / comVolume.length;
          if (media >= 20) add(true, `${nomeFila(fila)}, semana ${s}: sem volume lançado (nas outras, média ${Math.round(media)}).`);
        }
      }

      // C-SAT da semana muito abaixo do resto do mês (com avaliações suficientes).
      const semanasCsat = semanas.filter((s) => av(s) >= 5);
      if (semanasCsat.length >= 3) {
        for (const s of semanasCsat) {
          const outras = semanasCsat.filter((x) => x !== s);
          const resto = outras.reduce((a, x) => a + pos(x), 0) / outras.reduce((a, x) => a + av(x), 0);
          const daSemana = pos(s) / av(s);
          if (daSemana < resto - 0.2) add(false, `${nomeFila(fila)}, semana ${s}: C-SAT de ${pct(daSemana)}, bem abaixo do resto do mês (${pct(resto)}). Confira as avaliações importadas.`);
        }
      }
    }
  }
  return alertas.sort((a, b) => Number(b.grave) - Number(a.grave) || a.pessoa.localeCompare(b.pessoa));
}
