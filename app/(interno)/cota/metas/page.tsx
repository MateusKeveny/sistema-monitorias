import Abas from '@/componentes/Abas';
import EscalaEFeriados from '@/componentes/EscalaEFeriados';
import HistoricoDePesos from '@/componentes/HistoricoDePesos';
import MatrizDePesos from '@/componentes/MatrizDePesos';
import MetasEPontuacao from '@/componentes/MetasEPontuacao';
import MetasPorLista from '@/componentes/MetasPorLista';
import MetricasPorFila from '@/componentes/MetricasPorFila';
import PainelRegras from '@/componentes/PainelRegras';
import RegrasPorFila from '@/componentes/RegrasPorFila';
import SlaDosChamados from '@/componentes/SlaDosChamados';
import Link from '@/componentes/Link';
import { contextoDasMetas } from '@/lib/metasPorLista';
import type { FilaReal, RegraReal } from '@/lib/metricasPorFila';
import type { Canal } from '@/lib/setores';
import { carregarEscalaDoSetor, carregarRegrasDoSetor, TopoDasRegras } from '../configuracao/regras-do-setor';

export const dynamic = 'force-dynamic';

/** Um número curto que muda quando qualquer peso ou faixa muda (para a tela recomeçar do gravado). */
function resumo(texto: string) {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (Math.imul(31, h) + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Um bloco que fica fechado até a pessoa abrir: o que se mexe pouco. */
function Recolhido({ titulo, texto, children }: { titulo: string; texto: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-[20px] bg-superficie shadow-sm">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-90">›</span>
        <span>
          <span className="block text-base font-semibold text-slate-900">{titulo}</span>
          <span className="block text-sm text-slate-500">{texto}</span>
        </span>
      </summary>
      <div className="border-t border-slate-100 px-1 pb-4 pt-2">{children}</div>
    </details>
  );
}

/**
 * Regras da cota (4.13.0): numa tela só, em abas, o que eram cinco itens do
 * grupo "Metas e métricas" do menu.
 *
 *   Atendimento      — pontos e faixa de cada métrica na mesma linha (antes:
 *                      pontos em Metas e pontuação, cortes em Métricas e
 *                      faixas) e, recolhido, o que cada fila mede.
 *   Chamados         — o SLA (limites e pontos), a escala e os feriados.
 *   Demandas e cargos— demandas comuns, cartões dos cargos (meta, média,
 *                      demandas) e, recolhido, os nomes das métricas.
 *   Histórico        — o que mudou, por quem e por quê.
 *
 * Os endereços antigos (/cota/metricas-e-faixas, /cota/escala,
 * /cota/alteracoes) redirecionam para a aba certa. A tabela métrica × cargo
 * segue em ?ver=tabela.
 */
export default async function RegrasDaCota({ searchParams }: { searchParams: Promise<{ setor?: string; ver?: string; cat?: string }> }) {
  const { setor, ver, cat } = await searchParams;
  const d = await carregarRegrasDoSetor(setor);
  const escala = await carregarEscalaDoSetor(d.setorId);
  const pontuacaoUnica = d.listaSetores.find((s) => s.id === d.setorId)?.pontuacao_unica_atendimento === true;
  const tabela = ver === 'tabela';
  const aqui = `/cota/metas?setor=${d.setorId}`;

  // A chave junta pesos e faixas: depois de salvar, cada aba recomeça do que está gravado.
  const chave = `${d.setorId}-${pontuacaoUnica}-${resumo([
    ...d.listaPesos.map((p) => `${p.cargo_id}|${p.regra}|${p.peso}|${p.ativo}`),
    ...d.listaRegras.map((r) => `${r.chave}|${r.faixa_min}|${r.faixa_max}|${r.ativo}`),
  ].join(';'))}-${d.listaCargos.length}`;
  const comum = {
    setorId: d.setorId, cargos: d.listaCargos, regras: d.listaRegras, pesos: d.listaPesos,
    referencias: d.referencias, pessoasPorCargo: d.pessoasPorCargo, pontuacaoUnica, filas: d.filasDoSetor,
  };

  return (
    <div className="space-y-6">
      <TopoDasRegras dados={d} caminho="/cota/metas" titulo="Regras da cota"
                     subtitulo="Quanto vale cada coisa e em que faixa. Mudar recalcula os meses em aberto; os fechados guardam o valor da época." />

      {tabela ? (
        <>
          <p className="text-right text-sm">
            <Link href={aqui} className="text-marca-700 hover:underline dark:text-marca-400">← Voltar às abas</Link>
          </p>
          <MatrizDePesos key={`matriz-${d.setorId}-${pontuacaoUnica}`} setorId={d.setorId} cargos={d.listaCargos}
                         regras={d.listaRegras} pesos={d.listaPesos} pontuacaoUnica={pontuacaoUnica}
                         referencias={d.referencias} pessoasPorCargo={d.pessoasPorCargo} />
          <RegrasPorFila key={`fila-${d.setorId}-${pontuacaoUnica}`} setores={d.listaSetores.filter((s) => s.id === d.setorId)}
                         filas={d.todasAsFilas as Canal[]} pontuacaoUnica={pontuacaoUnica}
                         regras={d.listaRegras} pesos={d.listaPesos} cargos={d.listaCargos} />
        </>
      ) : (
        <Abas
          inicial={cat}
          itens={[
            {
              chave: 'atendimento', rotulo: 'Atendimento',
              conteudo: (
                <div className="space-y-4">
                  <MetasEPontuacao key={`at-${chave}`} parte="atendimento" {...comum} />
                  <Recolhido titulo="O que cada fila mede"
                             texto="Ligar TMA, dar régua própria a uma fila, fila nova. Mexe-se pouco.">
                    <MetricasPorFila key={`metricas-${d.setorId}`} setorId={d.setorId} setorNome={d.setorNome}
                                     filas={d.filasDoSetor as unknown as FilaReal[]}
                                     regras={d.todasAsRegras as unknown as RegraReal[]} />
                  </Recolhido>
                </div>
              ),
            },
            {
              chave: 'chamados', rotulo: 'Chamados',
              conteudo: (
                <div className="space-y-4">
                  {/* Os limites do SLA (quantas faixas, horas ou dias úteis) e, logo abaixo, os pontos de cada faixa. */}
                  <SlaDosChamados key={`sla-${chave}`} regras={d.listaRegras} pesosBase={d.pesosDoSla}
                                  nomeBase={(d.cargoDoSla?.nome ?? '').replace(/^Atendente\s+/, '')} />
                  <MetasEPontuacao key={`ch-${chave}`} parte="chamados" {...comum} />
                  <Recolhido titulo="Escala e feriados"
                             texto="O horário de cada pessoa e os feriados do setor: o SLA conta só o tempo dentro do expediente.">
                    <EscalaEFeriados key={d.setorId} setorId={d.setorId} setorNome={d.setorNome} {...escala} />
                  </Recolhido>
                </div>
              ),
            },
            {
              chave: 'demandas', rotulo: 'Demandas e cargos',
              conteudo: (
                <div className="space-y-4">
                  <MetasEPontuacao key={`dm-${chave}`} parte="demandas" {...comum} />
                  <Recolhido titulo="Nomes das métricas"
                             texto="O nome que aparece em todas as telas, ligar e desligar, e criar métrica de lançamento manual.">
                    <PainelRegras regras={d.listaRegras} setorId={d.setorId} />
                  </Recolhido>
                  {/* A matriz numa planilha (4.0.0): baixar, editar no Excel, subir com conferência. */}
                  <Recolhido titulo="Tudo numa planilha"
                             texto="Baixar as metas e os pontos em Excel, mudar lá e subir de volta, com conferência antes de gravar.">
                    <MetasPorLista key={`lista-${d.setorId}`} setorId={d.setorId} setorNome={d.setorNome}
                                   ctx={contextoDasMetas(d.listaCargos, d.listaRegras, d.listaPesos, {
                                     setorId: d.setorId,
                                     filas: d.filasDoSetor.map((c) => ({
                                       grupo_tme: c.grupo_tme ?? null, grupo_csat: c.grupo_csat ?? null,
                                       grupo_nota: c.grupo_nota ?? null, regra_finalizado: c.regra_finalizado ?? null,
                                       grupo_tma: c.grupo_tma ?? null, id: c.id, apelido: c.apelido ?? undefined, nome: c.nome,
                                     })),
                                   })} />
                  </Recolhido>
                  <p className="text-right text-sm">
                    <Link href={`${aqui}&ver=tabela`} className="text-marca-700 hover:underline dark:text-marca-400">
                      Ver tudo como tabela (métrica × cargo) →
                    </Link>
                  </p>
                </div>
              ),
            },
            {
              chave: 'historico', rotulo: 'Histórico',
              conteudo: <HistoricoDePesos alteracoes={d.alteracoes} />,
            },
          ]}
        />
      )}
    </div>
  );
}
