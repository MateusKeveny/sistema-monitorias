/**
 * Conferência antes de fechar (3.4.0, pedido do gestor em 03/11/2026, depois
 * do volume da 4ª semana do João Vitor importado com 3 em vez de 197).
 *
 * Olha os números de cada pessoa, semana a semana e por fila, e aponta o que
 * foge do padrão — sem decidir nada: o gestor confere e fecha mesmo assim, se
 * estiver certo. Grave = provavelmente erro de dado (importação).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

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
  // Semana encerrada sem nenhum volume importado ainda não é anomalia de
  // pessoa: é importação por fazer, que tem aviso próprio (3.5.0). Sem isto,
  // entre o fim da semana e a importação, todos apareciam "sem volume".
  const semanas = [1, 2, 3, 4].slice(0, semanasEncerradas).filter((s) => volumes.some((v) => v.semana === s));
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

/**
 * Carrega o que a conferência precisa além do volume e do C-SAT do mês (que a
 * tela já tem) e confere (3.5.0). O Fechamento, a tela inicial do gestor e a
 * Conferência do cálculo usam a mesma: anomalia aparece no dia em que o dado
 * entra, e não só na hora de fechar.
 */
export async function conferirNumerosDoMes(db: SupabaseClient, { competencia, pessoas, volumes, csats, semanasEncerradas }: {
  competencia: string;
  pessoas: { pessoa_id: string; pessoa: string }[];
  volumes: Volume[];
  csats: Csat[];
  semanasEncerradas: number;
}): Promise<Alerta[]> {
  if (!pessoas.length || semanasEncerradas === 0) return [];
  const mesAnterior = new Date(Date.UTC(Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  const [{ data: anteriorDb }, { data: nomesFilas }, { data: foraDb }, { data: foraPendentesDb }] = await Promise.all([
    db.from('volume_semanal').select('pessoa_id, finalizados').eq('mes_competencia', mesAnterior),
    db.from('canais_do_setor').select('apelido, nome'),
    // Atendimentos em outro setor (lançados como demanda extra e os pendentes).
    db.from('lancamentos').select('pessoa_id, semana, quantidade, regra').eq('mes_competencia', competencia).like('regra', 'outro_setor_%'),
    db.from('atendimentos_outro_setor').select('pessoa_id, semana').eq('mes_competencia', competencia).eq('situacao', 'pendente'),
  ]);
  const outroSetor = new Map<string, number>();
  for (const l of (foraDb ?? []) as { pessoa_id: string; semana: number | null; quantidade: number; regra: string }[]) {
    if (l.semana == null || l.regra.includes('__')) continue;
    outroSetor.set(`${l.pessoa_id}|${l.semana}`, (outroSetor.get(`${l.pessoa_id}|${l.semana}`) ?? 0) + Number(l.quantidade));
  }
  for (const o of (foraPendentesDb ?? []) as { pessoa_id: string; semana: number }[]) {
    outroSetor.set(`${o.pessoa_id}|${o.semana}`, (outroSetor.get(`${o.pessoa_id}|${o.semana}`) ?? 0) + 1);
  }
  const volumeMesAnterior = new Map<string, number>();
  for (const v of (anteriorDb ?? []) as { pessoa_id: string; finalizados: number }[]) {
    volumeMesAnterior.set(v.pessoa_id, (volumeMesAnterior.get(v.pessoa_id) ?? 0) + Number(v.finalizados));
  }
  const ids = new Set(pessoas.map((p) => p.pessoa_id));
  return conferirMes({
    pessoas, semanasEncerradas, outroSetor, volumeMesAnterior,
    volumes: volumes.filter((v) => ids.has(v.pessoa_id)),
    csats: csats.filter((c) => ids.has(c.pessoa_id)),
    filas: new Map(((nomesFilas ?? []) as { apelido: string | null; nome: string }[]).filter((x) => x.apelido).map((x) => [x.apelido!, x.nome])),
  });
}
