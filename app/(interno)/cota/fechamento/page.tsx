import Link from '@/componentes/Link';
import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import BotaoFecharCiclo from '@/componentes/BotaoFecharCiclo';
import AjusteDeFechamento from '@/componentes/AjusteDeFechamento';
import { Cartao, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { dataHora, hojeNoBrasil, mesDeCompetencia, mesRotulo, percentual } from '@/lib/formatar';

export const dynamic = 'force-dynamic';

type Aberto = { pessoa_id: string; pessoa: string; cargo: string | null; resultado: number; meta: number | null };
type Alteracao = {
  id: number; pessoa_nome: string | null; campo: string;
  valor_anterior: string | null; valor_novo: string | null;
  motivo: string; autor_nome: string | null; criado_em: string;
};

type Fechado = {
  id: string;
  pessoa_id: string; pessoa_nome: string; cargo: string | null;
  resultado: number; meta: number | null; fechado_por_nome: string | null; fechado_em: string;
};

const num = (v: number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

/**
 * Fechamento do ciclo: congela o que foi entregue ao outro departamento.
 *
 * O extrato é vivo e reflete sempre a regra atual; o fechamento guarda o
 * resultado e cada linha do extrato como estavam no dia. É o que permite
 * explicar meses depois de onde veio cada ponto.
 */
export default async function Fechamento({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  await exigirGestor();
  const { mes } = await searchParams;
  const competencia = /^\d{4}-\d{2}$/.test(mes ?? '') ? `${mes}-01` : mesDeCompetencia(hojeNoBrasil());

  const db = await criarClienteServidor();
  const [abertos, fechados, semCargo, conferir, alteracoes] = await Promise.all([
    db.from('vw_cota_mensal').select('pessoa_id, pessoa, cargo, resultado, meta')
      .eq('mes_competencia', competencia).order('resultado', { ascending: false }),
    db.from('fechamentos_cota')
      .select('id, pessoa_id, pessoa_nome, cargo, resultado, meta, fechado_por_nome, fechado_em')
      .eq('mes_competencia', competencia).order('resultado', { ascending: false }),
    db.from('vw_sem_cargo').select('nome').eq('mes_competencia', competencia),
    db.from('vw_lancamentos_a_conferir').select('bloco').eq('mes_competencia', competencia),
    db.from('fechamento_alteracoes')
      .select('id, pessoa_nome, campo, valor_anterior, valor_novo, motivo, autor_nome, criado_em')
      .eq('mes_competencia', competencia).order('criado_em', { ascending: false }),
  ]);

  const lista = (abertos.data ?? []) as Aberto[];
  const congelados = (fechados.data ?? []) as Fechado[];
  const jaFechados = new Set(congelados.map((f) => f.pessoa_id));
  const pendentes = lista.filter((p) => !jaFechados.has(p.pessoa_id));

  const avisos: string[] = [];
  if ((semCargo.data ?? []).length) {
    avisos.push(`Sem cargo definido, fora do fechamento: ${(semCargo.data ?? [])
      .map((p) => p.nome as string).join(', ')}.`);
  }
  if ((conferir.data ?? []).length) {
    avisos.push(`${(conferir.data ?? []).length} lançamento(s) com faixas que não fecham com o total.`);
  }

  const quando = congelados[0]?.fechado_em;
  const historico = (alteracoes.data ?? []) as Alteracao[];
  const NOME_CAMPO: Record<string, string> = {
    resultado: 'Pontos', meta: 'Meta', reabertura: 'Fechamento reaberto',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-sobre-fundo">Fechamento do ciclo</h1>
          <p className="text-sm text-sobre-fundo-suave">
            {mesRotulo(competencia)} ·{' '}
            {congelados.length
              ? `${congelados.length} pessoa(s) fechadas por ${congelados[0].fechado_por_nome ?? '—'}`
              + (quando ? ` em ${dataHora(quando)}` : '')
              : 'ainda aberto'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <a href={`/api/cota/exportar?mes=${competencia.slice(0, 7)}&formato=detalhado`}
             className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                        font-medium text-slate-700 hover:bg-slate-50">
            Relatório detalhado
          </a>
          <a href={`/api/cota/exportar?mes=${competencia.slice(0, 7)}`}
             className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                        font-medium text-slate-700 hover:bg-slate-50">
            Resumo para importação
          </a>
        </div>

        <form className="flex items-end gap-2">
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Competência</span>
            <input type="month" name="mes" defaultValue={competencia.slice(0, 7)}
                   className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <button className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5
                             text-sm font-medium text-slate-700 hover:bg-slate-50">
            Abrir
          </button>
        </form>
      </div>

      {congelados.length > 0 && (
        <Cartao
          titulo={`Congelado (${congelados.length})`}
          acao={<span className="text-xs text-slate-500">valores entregues, não mudam mais</span>}
        >
          <Tabela>
            <thead>
              <tr>
                <Th>Pessoa</Th><Th>Cargo</Th>
                <Th className="text-right">Pontos</Th>
                <Th className="text-right">Meta</Th>
                <Th className="text-right">Atingimento</Th>
                <Th>Extrato</Th>
                <Th>Correção</Th>
              </tr>
            </thead>
            <tbody>
              {congelados.map((f) => (
                <tr key={f.pessoa_id}>
                  <Td className="font-medium text-slate-800">{f.pessoa_nome}</Td>
                  <Td className="text-xs text-slate-500">{f.cargo ?? '—'}</Td>
                  <Td className="text-right font-semibold tabular-nums">{num(f.resultado)}</Td>
                  <Td className="text-right tabular-nums text-slate-500">{f.meta ? num(f.meta) : '—'}</Td>
                  <Td className="text-right tabular-nums">
                    {f.meta ? percentual(Number(f.resultado) / Number(f.meta)) : '—'}
                  </Td>
                  <Td>
                    <Link href={`/cota/extrato?pessoa=${f.pessoa_id}&mes=${competencia.slice(0, 7)}`}
                          className="text-xs text-marca-700 hover:underline dark:text-marca-400">
                      ver
                    </Link>
                  </Td>
                  <Td>
                    <AjusteDeFechamento
                      fechamentoId={f.id}
                      pessoa={f.pessoa_nome}
                      resultado={Number(f.resultado)}
                      meta={f.meta == null ? null : Number(f.meta)}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Cartao>
      )}

      <Cartao
        titulo={congelados.length ? `Ainda em aberto (${pendentes.length})` : `Prévia do fechamento (${pendentes.length})`}
      >
        {pendentes.length === 0 ? (
          <Vazio>
            {congelados.length
              ? 'Todo mundo desta competência já está fechado.'
              : 'Ninguém com pontuação nesta competência.'}
          </Vazio>
        ) : (
          <div className="space-y-5">
            <Tabela>
              <thead>
                <tr>
                  <Th>Pessoa</Th><Th>Cargo</Th>
                  <Th className="text-right">Pontos</Th>
                  <Th className="text-right">Meta</Th>
                  <Th className="text-right">Atingimento</Th>
                  <Th>Extrato</Th>
                </tr>
              </thead>
              <tbody>
                {pendentes.map((p) => (
                  <tr key={p.pessoa_id}>
                    <Td className="font-medium text-slate-800">{p.pessoa}</Td>
                    <Td className="text-xs text-slate-500">{p.cargo ?? '—'}</Td>
                    <Td className="text-right font-semibold tabular-nums">{num(p.resultado)}</Td>
                    <Td className="text-right tabular-nums text-slate-500">{p.meta ? num(p.meta) : '—'}</Td>
                    <Td className="text-right tabular-nums">
                      {p.meta ? percentual(Number(p.resultado) / Number(p.meta)) : '—'}
                    </Td>
                    <Td>
                      <Link href={`/cota/extrato?pessoa=${p.pessoa_id}&mes=${competencia.slice(0, 7)}`}
                            className="text-xs text-marca-700 hover:underline dark:text-marca-400">
                        conferir
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>

            <div className="border-t border-slate-100 pt-5">
              <BotaoFecharCiclo competencia={competencia} pessoas={pendentes.length} avisos={avisos} />
            </div>
          </div>
        )}
      </Cartao>

      {historico.length > 0 && (
        <Cartao titulo={`Correções feitas (${historico.length})`}>
          <Tabela>
            <thead>
              <tr>
                <Th>Quando</Th><Th>Pessoa</Th><Th>O que mudou</Th>
                <Th className="text-right">De</Th><Th className="text-right">Para</Th>
                <Th>Motivo</Th><Th>Autor</Th>
              </tr>
            </thead>
            <tbody>
              {historico.map((h) => (
                <tr key={h.id}>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{dataHora(h.criado_em)}</Td>
                  <Td>{h.pessoa_nome ?? '—'}</Td>
                  <Td className={h.campo === 'reabertura' ? 'text-amber-700' : ''}>
                    {NOME_CAMPO[h.campo] ?? h.campo}
                  </Td>
                  <Td className="text-right tabular-nums text-slate-500">
                    {h.valor_anterior ? num(Number(h.valor_anterior)) : '—'}
                  </Td>
                  <Td className="text-right font-semibold tabular-nums">
                    {h.valor_novo ? num(Number(h.valor_novo)) : '—'}
                  </Td>
                  <Td className="text-xs text-slate-600">{h.motivo}</Td>
                  <Td className="text-xs text-slate-500">{h.autor_nome ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Cartao>
      )}

      <p className="text-xs leading-relaxed text-sobre-fundo-suave">
        Fechar guarda, para cada pessoa, o resultado, a meta e <strong>cada linha do extrato</strong> como
        estão agora. Depois disso, mudar peso, volume ou lançamento não altera o que foi fechado. Quem
        ainda não tinha pontuação no dia do fechamento pode ser fechado depois, e quem já está fechado
        não é refeito. Se precisar corrigir depois, use <strong>corrigir</strong> na linha da pessoa:
        o motivo é obrigatório e toda correção fica registrada abaixo, com valor anterior, valor novo,
        autor e data. Reabrir devolve a pessoa para a prévia, e o valor que estava entregue fica no
        histórico.
      </p>
    </div>
  );
}
