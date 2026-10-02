import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import DiarioDeBordo from '@/componentes/DiarioDeBordo';
import RegistrosComAGestao from '@/componentes/RegistrosComAGestao';
import AnotacoesDoGestor from '@/componentes/AnotacoesDoGestor';
import Abas from '@/componentes/Abas';
import { hojeNoBrasil } from '@/lib/formatar';
import type {
  AnotacaoGestor, LeituraDiario, RegistroDiario, RegistroPrivado, RenovacaoDiario, Subcategoria,
} from '@/lib/diario';

export const dynamic = 'force-dynamic';

/**
 * Diário de bordo (1.22.0): o que aconteceu no dia e vale para todos —
 * processos novos, treinamentos, autorizações e exceções.
 *
 * Todos registram e todos leem todos os registros. A consulta de gestão e
 * qualidade fica também no site de Monitorias, onde o protocolo é conferido
 * antes de concluir uma monitoria.
 *
 * Abas (1.32.0): "Registros com a gestão", que só o autor e a gestão veem, e
 * "Anotações do gestor", só de quem tem papel gestor. Quem vê o quê é regra
 * da RLS (migração 43): cada consulta já volta só com o permitido.
 */
export default async function Diario({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; cat?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { filtro, cat } = await searchParams;
  const db = await criarClienteServidor();
  const ehGestor = perfil.papel === 'gestor';

  const [{ data: registros }, { data: pessoas }, { data: aprova }, { data: concluiDireto }, { data: renovacoes },
    { data: leituras }, { data: privados }, { data: anotacoes }, { data: equipe }, { data: subcategorias }] = await Promise.all([
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
    // Quem leu cada processo e treinamento (migração 38): a função só entrega
    // tudo a gestor e Pleno; aos demais, as próprias linhas, que a tela ignora.
    db.rpc('leituras_do_diario'),
    // Registros com a gestão: o atendente recebe os próprios; gestão, todos.
    db.from('diario_privados').select('*').order('criado_em', { ascending: false }).limit(500),
    ehGestor
      ? db.from('diario_anotacoes').select('*').order('data', { ascending: false }).order('criado_em', { ascending: false })
      : Promise.resolve({ data: [] }),
    ehGestor
      ? db.from('pessoas').select('id, nome').eq('ativo', true).is('desligado_em', null).order('nome')
      : Promise.resolve({ data: [] }),
    // Subcategorias de problema operacional (migração 46).
    db.from('diario_subcategorias').select('*').order('ordem'),
  ]);

  const nomes: Record<string, string> = Object.fromEntries(
    (pessoas ?? []).map((p: { id: string; nome: string }) => [p.id, p.nome]));
  const listaPrivados = (privados ?? []) as RegistroPrivado[];
  const aguardandoPrivados = aprova === true
    ? listaPrivados.filter((r) => r.situacao === 'aguardando' && r.pessoa_id !== perfil.id).length : 0;

  const diario = (
    <DiarioDeBordo
      registros={(registros ?? []) as RegistroDiario[]}
      renovacoes={(renovacoes ?? []) as RenovacaoDiario[]}
      leituras={aprova === true ? (leituras ?? []) as LeituraDiario[] : []}
      subcategorias={(subcategorias ?? []) as Subcategoria[]}
      nomes={nomes}
      pessoaId={perfil.id}
      ehGestor={ehGestor}
      aprova={aprova === true}
      concluiDireto={concluiDireto === true}
      hoje={hojeNoBrasil()}
      filtroInicial={filtro}
    />
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Diário de bordo</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          O que aconteceu e vale para todos, os seus registros com a gestão
          {ehGestor ? ' e as anotações privadas do gestor.' : '.'}
        </p>
      </div>

      <Abas
        inicial={cat}
        itens={[
          { chave: 'equipe', rotulo: 'Diário da equipe', conteudo: diario },
          {
            chave: 'gestao',
            rotulo: aprova === true
              ? `Registros dos atendentes${aguardandoPrivados ? ` · ${aguardandoPrivados} aguardando` : ''}`
              : 'Meus registros com a gestão',
            conteudo: (
              <RegistrosComAGestao registros={listaPrivados} nomes={nomes} pessoaId={perfil.id} aprova={aprova === true} />
            ),
          },
          ...(ehGestor ? [{
            chave: 'anotacoes',
            rotulo: 'Anotações do gestor',
            conteudo: (
              <AnotacoesDoGestor anotacoes={(anotacoes ?? []) as AnotacaoGestor[]} nomes={nomes}
                                 pessoas={(equipe ?? []) as { id: string; nome: string }[]}
                                 pessoaId={perfil.id} hoje={hojeNoBrasil()} />
            ),
          }] : []),
        ]}
      />
    </div>
  );
}
