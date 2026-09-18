import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import ImportadorAvaliacoes from '@/componentes/ImportadorAvaliacoes';
import type { Pessoa } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function ImportarAvaliacoes() {
  const perfil = await exigirGestor();
  const db = await criarClienteServidor();
  const { data: pessoas } = await db.from('pessoas').select('*').order('nome');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-sobre-fundo">Importar</h1>
        <p className="text-sm text-sobre-fundo-suave">
          A planilha é lida no seu computador; só as avaliações novas são enviadas.
        </p>
      </div>
      <ImportadorAvaliacoes pessoas={(pessoas ?? []) as Pessoa[]} importadoPor={perfil.id} />
    </div>
  );
}
