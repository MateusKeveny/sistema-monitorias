import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import PainelAtendentes from '@/componentes/PainelAtendentes';
import type { Pessoa, Saida } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

/**
 * Atendentes: quem está na operação e o registro de quem saiu.
 *
 * A tela mora só aqui, mas o efeito é dos dois sistemas — o cadastro de
 * pessoas é o mesmo banco, e encerrar o acesso encerra também o das
 * monitorias.
 */
export default async function Atendentes() {
  await exigirGestor();
  const db = await criarClienteServidor();

  const [{ data: pessoas }, { data: saidas }] = await Promise.all([
    db.from('pessoas').select('*').order('nome'),
    db.from('saidas').select('*').order('data', { ascending: false }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-sobre-fundo">Atendentes</h1>
        <p className="text-sm text-sobre-fundo-suave">
          Entrada, saída e acesso. Vale para os dois sistemas.
        </p>
      </div>

      <PainelAtendentes
        pessoas={(pessoas ?? []) as Pessoa[]}
        saidas={(saidas ?? []) as Saida[]}
      />
    </div>
  );
}
