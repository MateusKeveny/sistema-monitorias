import Link from '@/componentes/Link';
import { Indicador, Quadro, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { corDoCsat, percentual } from '@/lib/formatar';

export type VolumeCsat = { pessoa_id: string; canal: string; semana: number; finalizados: number };
export type NotasCsat = { pessoa_id: string; origem: string; semana: number; avaliacoes: number; positivas: number };

type Soma = { atendimentos: number; avaliacoes: number; positivas: number };
const zero = (): Soma => ({ atendimentos: 0, avaliacoes: 0, positivas: 0 });
const taxa = (s: Soma) => (s.atendimentos ? s.avaliacoes / s.atendimentos : null);
const csat = (s: Soma) => (s.avaliacoes ? s.positivas / s.avaliacoes : null);
const num = (v: number) => v.toLocaleString('pt-BR');

/**
 * C-SAT na visão do gestor (3.7.0): quantas avaliações vieram e quanto isso
 * representa dos atendimentos lançados (a soma do volume de todas as filas).
 * C-SAT alto com poucas avaliações vale menos do que parece; a taxa de
 * avaliação mostra isso lado a lado, por pessoa, por fila e por semana.
 * Os números são os mesmos do cálculo: volume_semanal e vw_csat_semanal.
 */
export default function CsatDaEquipe({ pessoas, volumes, notas, filas, competencia, pessoaId, semanasComDados }: {
  pessoas: { id: string; nome: string }[];
  volumes: VolumeCsat[];
  notas: NotasCsat[];
  /** Apelido → nome da fila, na ordem do setor. */
  filas: [string, string][];
  competencia: string;
  /** Com uma pessoa escolhida, o resumo é só dela. */
  pessoaId: string | null;
  semanasComDados: number[];
}) {
  const doRecorte = (id: string) => !pessoaId || id === pessoaId;
  const somar = (filtroVol: (v: VolumeCsat) => boolean, filtroNota: (n: NotasCsat) => boolean): Soma => {
    const s = zero();
    for (const v of volumes) if (doRecorte(v.pessoa_id) && filtroVol(v)) s.atendimentos += Number(v.finalizados);
    for (const n of notas) if (doRecorte(n.pessoa_id) && filtroNota(n)) { s.avaliacoes += Number(n.avaliacoes); s.positivas += Number(n.positivas); }
    return s;
  };
  const total = somar(() => true, () => true);
  const porFila = filas.map(([apelido, nome]) => ({ apelido, nome, s: somar((v) => v.canal === apelido, (n) => n.origem === apelido) }))
    .filter((f) => f.s.atendimentos || f.s.avaliacoes);
  const porSemana = semanasComDados.map((sem) => ({ sem, s: somar((v) => v.semana === sem, (n) => n.semana === sem) }));

  // Por pessoa: só na visão da equipe.
  const linhas = pessoaId ? [] : pessoas.map((p) => {
    const filaDe = (apelido: string) => {
      const s = zero();
      for (const v of volumes) if (v.pessoa_id === p.id && v.canal === apelido) s.atendimentos += Number(v.finalizados);
      for (const n of notas) if (n.pessoa_id === p.id && n.origem === apelido) { s.avaliacoes += Number(n.avaliacoes); s.positivas += Number(n.positivas); }
      return s;
    };
    const fs = porFila.map((f) => filaDe(f.apelido));
    const t = fs.reduce((a, s) => ({ atendimentos: a.atendimentos + s.atendimentos, avaliacoes: a.avaliacoes + s.avaliacoes, positivas: a.positivas + s.positivas }), zero());
    return { ...p, fs, t };
  }).filter((l) => l.t.atendimentos || l.t.avaliacoes)
    .sort((a, b) => b.t.atendimentos - a.t.atendimentos);

  if (!total.atendimentos && !total.avaliacoes) {
    return <Quadro titulo="Atendimentos × avaliações"><Vazio>Sem volume nem avaliações neste mês.</Vazio></Quadro>;
  }

  const celulaTaxa = (s: Soma) => (taxa(s) == null ? '—' : percentual(taxa(s)!));
  const celulaCsat = (s: Soma) => (csat(s) == null
    ? <span className="text-slate-400">—</span>
    : <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${corDoCsat(csat(s), true)}`}>{percentual(csat(s)!)}</span>);
  const mes = competencia.slice(0, 7);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Indicador rotulo="Atendimentos lançados" valor={num(total.atendimentos)} detalhe="soma do volume de todas as filas" />
        <Indicador rotulo="Avaliações" valor={num(total.avaliacoes)} detalhe="notas de 1 a 5 do Hub" />
        <Indicador rotulo="Taxa de avaliação" valor={celulaTaxa(total)} detalhe="avaliações ÷ atendimentos" />
        <Indicador rotulo="C-SAT" valor={csat(total) == null ? '—' : percentual(csat(total)!)}
                   tom={csat(total) == null ? 'neutro' : csat(total)! >= 0.9 ? 'bom' : csat(total)! >= 0.85 ? 'alerta' : 'ruim'}
                   detalhe={`${num(total.positivas)} positivas (4 e 5)`} />
        <Indicador rotulo="Notas 1 a 3" valor={num(total.avaliacoes - total.positivas)}
                   tom={total.avaliacoes - total.positivas ? 'alerta' : 'neutro'}
                   detalhe={total.avaliacoes ? `${percentual((total.avaliacoes - total.positivas) / total.avaliacoes)} das avaliações` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Quadro titulo="Por fila" subtitulo="Quanto de cada fila foi avaliado.">
          <Tabela noQuadro>
            <thead><tr>
              <Th>Fila</Th><Th className="text-right">Atendimentos</Th><Th className="text-right">Avaliações</Th>
              <Th className="text-right">Taxa</Th><Th className="text-right">C-SAT</Th>
            </tr></thead>
            <tbody>
              {porFila.map((f) => (
                <tr key={f.apelido}>
                  <Td className="font-medium text-slate-900">{f.nome}</Td>
                  <Td className="text-right tabular-nums">{num(f.s.atendimentos)}</Td>
                  <Td className="text-right tabular-nums">{num(f.s.avaliacoes)}</Td>
                  <Td className="text-right tabular-nums">{celulaTaxa(f.s)}</Td>
                  <Td className="text-right">{celulaCsat(f.s)}</Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Quadro>

        <Quadro titulo="Semana a semana" subtitulo="Semana sem volume ou sem avaliação salta à vista aqui.">
          <Tabela noQuadro>
            <thead><tr>
              <Th>Semana</Th><Th className="text-right">Atendimentos</Th><Th className="text-right">Avaliações</Th>
              <Th className="text-right">Taxa</Th><Th className="text-right">C-SAT</Th>
            </tr></thead>
            <tbody>
              {porSemana.map(({ sem, s }) => (
                <tr key={sem}>
                  <Td className="font-medium text-slate-900">{sem}ª</Td>
                  <Td className="text-right tabular-nums">{num(s.atendimentos)}</Td>
                  <Td className="text-right tabular-nums">{num(s.avaliacoes)}</Td>
                  <Td className="text-right tabular-nums">{celulaTaxa(s)}</Td>
                  <Td className="text-right">{celulaCsat(s)}</Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Quadro>
      </div>

      {linhas.length > 0 && (
        <Quadro titulo="Por atendente" subtitulo="Clique no nome para ver as avaliações de 1 a 5 e os protocolos abaixo de 4.">
          <Tabela noQuadro>
            <thead>
              <tr>
                <Th>Atendente</Th>
                {porFila.map((f) => <Th key={f.apelido} className="text-right">{f.nome}<span className="block text-[11px] font-normal normal-case text-slate-400">avaliações / atend.</span></Th>)}
                <Th className="text-right">Atendimentos</Th><Th className="text-right">Avaliações</Th>
                <Th className="text-right">Taxa</Th><Th className="text-right">C-SAT</Th><Th className="text-right">Notas 1–3</Th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/cota/csat?mes=${mes}&pessoa=${l.id}`} className="font-medium text-slate-900 hover:text-marca-700 hover:underline dark:hover:text-marca-400">
                      {l.nome}
                    </Link>
                  </Td>
                  {l.fs.map((s, i) => (
                    <Td key={i} className="text-right tabular-nums text-slate-600">
                      {s.atendimentos || s.avaliacoes ? <>{num(s.avaliacoes)} / {num(s.atendimentos)}</> : '—'}
                    </Td>
                  ))}
                  <Td className="text-right tabular-nums">{num(l.t.atendimentos)}</Td>
                  <Td className="text-right tabular-nums">{num(l.t.avaliacoes)}</Td>
                  <Td className="text-right tabular-nums">{celulaTaxa(l.t)}</Td>
                  <Td className="text-right">{celulaCsat(l.t)}</Td>
                  <Td className={`text-right tabular-nums ${l.t.avaliacoes - l.t.positivas ? 'text-rose-700 dark:text-rose-300' : 'text-slate-400'}`}>
                    {l.t.avaliacoes - l.t.positivas || '—'}
                  </Td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 font-semibold">
                <Td>Equipe</Td>
                {porFila.map((f) => <Td key={f.apelido} className="text-right tabular-nums">{num(f.s.avaliacoes)} / {num(f.s.atendimentos)}</Td>)}
                <Td className="text-right tabular-nums">{num(total.atendimentos)}</Td>
                <Td className="text-right tabular-nums">{num(total.avaliacoes)}</Td>
                <Td className="text-right tabular-nums">{celulaTaxa(total)}</Td>
                <Td className="text-right">{celulaCsat(total)}</Td>
                <Td className="text-right tabular-nums">{num(total.avaliacoes - total.positivas)}</Td>
              </tr>
            </tbody>
          </Tabela>
        </Quadro>
      )}
    </div>
  );
}
