import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import DiarioDeBordo from '@/componentes/DiarioDeBordo';
import { hojeNoBrasil } from '@/lib/formatar';
import type { RegistroDiario, RenovacaoDiario } from '@/lib/diario';

export const dynamic = 'force-dynamic';

/**
 * Diário de bordo (1.22.0): o que aconteceu no dia e vale para todos —
 * processos novos, treinamentos, autorizações e exceções.
 *
 * Todos registram e todos leem todos os registros. A consulta de gestão e
 * qualidade fica também no site de Monitorias, onde o protocolo é conferido
 * antes de concluir uma monitoria.
 */
export default async function Diario({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { filtro } = await searchParams;
  const db = await criarClienteServidor();

  const [{ data: registros }, { data: pessoas }, { data: aprova }, { data: concluiDireto }, { data: renovacoes }] = await Promise.all([
    // Os últimos 500: bastam para a consulta do dia a dia. A busca por um
    // protocolo antigo está na consulta do site de Monitorias.
    db.from('diario_registros').select('*')
      .order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(500),
    // Pela função (migração 34): o operador não lê o cadastro dos colegas,
    // mas precisa ver quem registrou.
    db.rpc('nomes_das_pessoas'),
    // Pelo cargo (migração 33): gestor e Pleno aprovam; gestor, Pleno e
    // Analista concluem a própria autorização da gestão sem aprovação.
    db.rpc('aprova_diario'),
    db.rpc('conclui_diario_direto'),
    db.from('diario_renovacoes').select('registro_id, valia_ate, passa_a_valer, renovado_por, renovado_em')
      .order('renovado_em', { ascending: false }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Diário de bordo</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          O que aconteceu hoje e vale para todos: processos novos, treinamentos, autorizações e exceções.
          Todos veem todos os registros.
        </p>
      </div>

      <DiarioDeBordo
        registros={(registros ?? []) as RegistroDiario[]}
        renovacoes={(renovacoes ?? []) as RenovacaoDiario[]}
        nomes={Object.fromEntries((pessoas ?? []).map((p: { id: string; nome: string }) => [p.id, p.nome]))}
        pessoaId={perfil.id}
        ehGestor={perfil.papel === 'gestor'}
        aprova={aprova === true}
        concluiDireto={concluiDireto === true}
        hoje={hojeNoBrasil()}
        filtroInicial={filtro}
      />
    </div>
  );
}
