import Link from 'next/link';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Cartao, EtiquetaNota, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { data as formatarData, mesExtenso } from '@/lib/formatar';
import type { Monitoria, Operador } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

type Busca = { operador?: string; mes?: string; zeradas?: string };

export default async function ListaMonitorias({
  searchParams,
}: {
  searchParams: Promise<Busca>;
}) {
  const perfil = await exigirPerfil();
  const filtros = await searchParams;
  const db = await criarClienteServidor();

  let consulta = db.from('vw_monitorias').select('*')
    .order('data_atendimento', { ascending: false })
    .order('operador')
    .limit(500);

  if (filtros.operador) consulta = consulta.eq('operador_id', filtros.operador);
  if (filtros.mes) consulta = consulta.eq('mes_referencia', filtros.mes);
  if (filtros.zeradas === 'sim') consulta = consulta.eq('zerado', true);

  const [{ data: lista }, { data: operadores }, { data: meses }] = await Promise.all([
    consulta,
    db.from('operadores').select('id, nome').eq('ativo', true).order('nome'),
    db.from('vw_monitorias').select('mes_referencia').order('mes_referencia', { ascending: false }),
  ]);

  const monitorias = (lista ?? []) as Monitoria[];
  const mesesUnicos = [...new Set(((meses ?? []) as { mes_referencia: string }[])
    .map((m) => m.mes_referencia))];

  const estilo = `rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm
                  outline-none focus:border-marca-600`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Monitorias</h1>
          <p className="text-sm text-slate-500">
            {monitorias.length} registro{monitorias.length === 1 ? '' : 's'}
            {monitorias.length === 500 && ' (limite de exibição)'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/api/exportar?formato=xlsx"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm
                       font-medium text-slate-700 hover:bg-slate-50">
            Exportar Excel
          </Link>
          {perfil.papel === 'admin' && (
            <Link href="/monitorias/nova"
              className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white
                         hover:bg-marca-700">
              Nova monitoria
            </Link>
          )}
        </div>
      </div>

      <form className="flex flex-wrap items-center gap-2">
        {perfil.papel !== 'operador' && (
          <select name="operador" defaultValue={filtros.operador ?? ''} className={estilo}>
            <option value="">Todos os operadores</option>
            {((operadores ?? []) as Operador[]).map((o) => (
              <option key={o.id} value={o.id}>{o.nome}</option>
            ))}
          </select>
        )}

        <select name="mes" defaultValue={filtros.mes ?? ''} className={estilo}>
          <option value="">Todos os meses</option>
          {mesesUnicos.map((m) => <option key={m} value={m}>{mesExtenso(m)}</option>)}
        </select>

        <select name="zeradas" defaultValue={filtros.zeradas ?? ''} className={estilo}>
          <option value="">Todas as notas</option>
          <option value="sim">Somente zeradas</option>
        </select>

        <button type="submit"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm
                     font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
        <Link href="/monitorias" className="px-2 text-sm text-slate-500 hover:underline">
          limpar
        </Link>
      </form>

      <Cartao>
        {monitorias.length === 0 ? (
          <Vazio>Nenhuma monitoria encontrada com esses filtros.</Vazio>
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Protocolo</Th>
                <Th>Operador</Th>
                <Th>Canal</Th>
                <Th className="text-center">Semana</Th>
                <Th className="text-center">Nº</Th>
                <Th className="text-right">Nota</Th>
                <Th>Parecer</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {monitorias.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap tabular-nums">{formatarData(m.data_atendimento)}</Td>
                  <Td className="whitespace-nowrap font-mono text-xs">{m.protocolo}</Td>
                  <Td className="whitespace-nowrap font-medium text-slate-900">{m.operador}</Td>
                  <Td className="whitespace-nowrap text-slate-500">{m.canal ?? '—'}</Td>
                  <Td className="text-center tabular-nums">{m.semana_mes}ª</Td>
                  <Td className="text-center tabular-nums">{m.numero_monitoria}ª</Td>
                  <Td className="text-right">
                    <EtiquetaNota valor={Number(m.nota_final)} zerado={m.zerado} />
                  </Td>
                  <Td className="max-w-md">
                    <span className="line-clamp-2 text-xs text-slate-500">{m.parecer ?? '—'}</span>
                  </Td>
                  <Td>
                    <Link href={`/monitorias/${m.id}`}
                      className="whitespace-nowrap text-xs font-medium text-marca-700 hover:underline">
                      abrir →
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
