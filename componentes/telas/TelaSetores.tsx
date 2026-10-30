import { criarClienteServidor } from '@/lib/supabase/servidor';
import SetoresECanais, { type SetorDoHubVisto } from '@/componentes/SetoresECanais';
import { MONITORIAS_PADRAO } from '@/lib/monitoriasDoSetor';
import type { Canal, Setor } from '@/lib/setores';
import type { RegraCota } from '@/lib/tipos';

/**
 * Setores e filas (aba de "Usuários e setores", 3.0; era uma aba da
 * Configuração): a árvore setor → filas, os nomes no Hub e, por setor, as
 * monitorias (quantas por semana e o piso, Monitorias 6.0).
 */
export default async function TelaSetores() {
  const db = await criarClienteServidor();
  const [{ data: setores }, { data: canais }, { data: vistos }, { data: reguas }] = await Promise.all([
    db.from('setores').select('*').order('ordem'),
    db.from('canais_do_setor').select('*').order('ordem'),
    db.from('vw_setores_do_hub_vistos').select('*').order('atendimentos', { ascending: false }),
    db.from('regras').select('chave, faixa_min').eq('grupo', 'monitoria'),
  ]);
  const lista = (setores ?? []) as Setor[];
  const monitorias = Object.fromEntries(lista.map((s) => {
    const regua = ((reguas ?? []) as Pick<RegraCota, 'chave' | 'faixa_min'>[]).find((r) => r.chave === s.regra_monitoria);
    return [s.id, {
      porSemana: s.monitorias_por_semana ?? MONITORIAS_PADRAO.porSemana,
      piso: regua?.faixa_min != null ? Number(regua.faixa_min) : MONITORIAS_PADRAO.piso,
    }];
  }));
  return <SetoresECanais setores={lista} canais={(canais ?? []) as Canal[]}
                         vistos={(vistos ?? []) as SetorDoHubVisto[]} monitorias={monitorias} />;
}
