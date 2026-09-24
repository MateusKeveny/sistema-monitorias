import { Cartao, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { hojeNoBrasil } from '@/lib/formatar';
import type { PagamentoMensal } from '@/lib/tipos';

const pontos = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const reais = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Depois do dia 10 o valor do mês anterior já deveria ter chegado. */
const DIA_LIMITE = 10;

function atrasado(competencia: string) {
  const hoje = hojeNoBrasil();
  const [ano, mes] = competencia.split('-').map(Number);
  const seguinte = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);
  return hoje > seguinte && Number(hoje.slice(8, 10)) >= DIA_LIMITE;
}

/**
 * O que cada pessoa recebe na competência fechada.
 *
 * Pontuação vem do fechamento; o bônus de equipe sai de 10% da média do cargo
 * de referência, e só quando todos os que têm direito bateram a meta — um que
 * não bate, ninguém recebe. O valor por ponto é informado pelo gestor.
 */
export default function PagamentoDoMes({
  competencia, linhas, titulo = 'Pagamento',
}: {
  competencia: string;
  linhas: PagamentoMensal[];
  titulo?: string;
}) {
  if (!linhas.length) {
    return (
      <Cartao titulo={titulo}>
        <Vazio>Nada fechado nesta competência.</Vazio>
      </Cartao>
    );
  }

  const primeira = linhas[0];
  const semValor = primeira.valor_por_ponto == null;
  const comDireito = linhas.filter((l) => l.recebe_bonus && l.mes_inteiro);

  // Sem soma dos valores, por decisão do gestor: o total do mês não é
  // conferido aqui e um número somado na tela vira número citado em reunião.
  return (
    <Cartao titulo={titulo}>
      {semValor ? (
        <p className={`mb-4 rounded-lg px-3 py-2 text-sm ring-1 ${
          atrasado(competencia)
            ? 'bg-amber-50 text-amber-900 ring-amber-600/20'
            : 'bg-slate-50 text-slate-700 ring-slate-300'}`}>
          {atrasado(competencia)
            ? 'O valor por ponto desta competência ainda não foi informado — já passou do dia 10.'
            : 'O valor por ponto desta competência ainda não foi informado.'}
        </p>
      ) : (
        <p className="mb-4 text-sm text-slate-600">
          {reais(Number(primeira.valor_por_ponto))} por ponto.{' '}
          {primeira.bonus_liberado
            ? <>Bônus de equipe <strong>liberado</strong>:{' '}
                {Math.round(Number(primeira.percentual_bonus) * 10000) / 100}% de{' '}
                {pontos(primeira.media_base)} = <strong>{pontos(comDireito[0]?.bonus ?? 0)}</strong>{' '}
                pontos para cada um dos {comDireito.length} que têm direito.</>
            : <>Bônus de equipe <strong>não liberado</strong>: {primeira.quantos_faltaram}{' '}
                {primeira.quantos_faltaram === 1 ? 'pessoa não bateu' : 'pessoas não bateram'}{' '}
                a meta entre quem precisa bater.</>}
        </p>
      )}

      <Tabela>
        <thead>
          <tr>
            <Th>Pessoa</Th>
            <Th className="w-36">Cargo</Th>
            <Th className="w-28 text-right">Pontos</Th>
            <Th className="w-28 text-right">Bônus</Th>
            <Th className="w-32 text-right">Total de pontos</Th>
            <Th className="w-32 text-right">Valor</Th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.pessoa_id}>
              <Td className="font-medium text-slate-800">
                {l.pessoa_nome}
                {!l.mes_inteiro && (
                  <span className="ml-2 text-xs font-normal text-slate-500">mês parcial</span>
                )}
              </Td>
              <Td className="text-xs text-slate-500">{l.cargo ?? '—'}</Td>
              <Td className="text-right tabular-nums">{pontos(l.resultado)}</Td>
              <Td className="text-right tabular-nums text-slate-600">
                {Number(l.bonus) > 0 ? `+${pontos(l.bonus)}` : '—'}
              </Td>
              <Td className="text-right font-semibold tabular-nums">{pontos(l.pontos_pagos)}</Td>
              <Td className="text-right font-semibold tabular-nums">
                {l.atingiu_meta
                  ? reais(l.valor)
                  : <span className="text-xs font-normal text-slate-400">abaixo da meta</span>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Tabela>

      <p className="mt-4 text-xs text-slate-500">
        Quem fecha abaixo da meta não recebe — é para isso que a meta existe.
        O bônus é {Math.round(Number(primeira.percentual_bonus) * 10000) / 100}% da média do cargo
        de referência e só sai quando <strong>todos</strong> os que têm direito batem a meta. Pleno
        e Gestor não recebem: já são remunerados pela média multiplicada. Quem trabalhou a
        competência pela metade não entra na conta do bônus.
      </p>
    </Cartao>
  );
}
