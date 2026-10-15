import { redirect } from 'next/navigation';
import Navegacao from '@/componentes/Navegacao';
import MenuLateral from '@/componentes/MenuLateral';
import { VERSAO_COTA, VERSAO_MONITORIAS } from '@/lib/versoes';
import { sistemaAtual } from '@/lib/sistema-servidor';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import LeituraObrigatoria from '@/componentes/LeituraObrigatoria';
import RegistrarAcesso from '@/componentes/RegistrarAcesso';
import ManterSessao from '@/componentes/ManterSessao';
import { hojeNoBrasil } from '@/lib/formatar';
import type { LeituraDiario, RegistroDiario } from '@/lib/diario';

export default async function LayoutInterno({ children }: { children: React.ReactNode }) {
  // A agenda tem moldura e login próprios (app/agenda); o middleware já a
  // mantém fora daqui, e isto só garante.
  // Ler o sistema é só ler o endereço: não atrasa a ida ao banco.
  const sistema = await sistemaAtual();
  if (sistema === 'agenda') redirect('/agenda');
  const perfil = await exigirPerfil();

  // As consultas do layout saem juntas (1.39.3): rodam a cada clique, e uma
  // atrás da outra somavam as esperas pelo banco.
  const db = await criarClienteServidor();
  const leDiario = sistema === 'cota' && perfil.papel !== 'gestor';
  const [pendentes, avisosReporte, leituras, veFerias] = await Promise.all([
    // Exclusões esperando decisão aparecem no Painel, mas o quadro só existe
    // quando há alguma — o gestor não teria como saber que chegou pedido sem
    // abrir a tela por acaso. O contador no menu resolve isso: ele aparece em
    // qualquer página, e some sozinho quando a fila zera. Só existe nas
    // monitorias: no site de cota não há onde decidir.
    sistema === 'monitorias' && perfil.papel === 'gestor'
      ? db.from('solicitacoes_exclusao').select('*', { count: 'exact', head: true })
          .eq('status', 'pendente').then((r) => r.count ?? 0)
      : Promise.resolve(0),
    // Reportar problema (1.33.0): o ponto no botão — respostas novas para quem
    // reportou, reports novos para o gestor (migração 44).
    (perfil.papel === 'gestor'
      ? db.from('reportes').select('id', { count: 'exact', head: true }).eq('situacao', 'novo')
      : db.from('reportes').select('id', { count: 'exact', head: true })
          .eq('pessoa_id', perfil.id).eq('lido_pelo_autor', false)
    ).then((r) => r.count ?? 0),
    leDiario
      ? db.rpc('leituras_do_diario').then((r) => (r.data ?? []) as LeituraDiario[])
      : Promise.resolve([] as LeituraDiario[]),
    // Férias (62): gestor e Qualidade sempre; operador só com cargo Pleno ou
    // Analista no mês — e isso só o banco sabe, daí a pergunta só para ele.
    sistema !== 'cota' ? Promise.resolve(false)
      : perfil.papel !== 'operador' ? Promise.resolve(true)
      : db.rpc('ve_ferias').then((r) => r.data === true),
  ]);

  // Menu lateral em tela larga e conteúdo na largura toda — limitado a 7xl,
  // sobrava meia tela vazia em monitor grande. Em janela estreita volta o
  // cabeçalho do topo. Veio no Performance (1.15.0) e passou a valer também
  // nas Monitorias na repaginação delas (5.0.0).
  {
    // Leitura obrigatória do diário (1.29.0): com processo ou treinamento
    // ainda não lido, o painel inteiro dá lugar à leitura — vale também para
    // quem abre uma tela pelo endereço direto. O gestor só acompanha. Só no
    // Performance: é lá que o diário da equipe vive.
    if (leDiario) {
      const pendentesDeLeitura = leituras
        .filter((l) => l.pessoa_id === perfil.id && !l.ciente_em).map((l) => l.registro_id);
      if (pendentesDeLeitura.length) {
        const [{ data: registros }, { data: pessoas }] = await Promise.all([
          db.from('diario_registros').select('*').in('id', pendentesDeLeitura)
            .order('data', { ascending: true }).order('criado_em', { ascending: true }),
          db.rpc('nomes_das_pessoas'),
        ]);
        return (
          <>
          {/* Quem abre o painel para ler também acessou (migração 52). */}
          <RegistrarAcesso sistema={sistema} />
          <ManterSessao />
          <LeituraObrigatoria
            registros={(registros ?? []) as RegistroDiario[]}
            nomes={Object.fromEntries((pessoas ?? []).map((p: { id: string; nome: string }) => [p.id, p.nome]))}
            hoje={hojeNoBrasil()}
          />
          </>
        );
      }
    }

    const versao = sistema === 'cota' ? VERSAO_COTA : VERSAO_MONITORIAS;
    return (
      <div className="lg:grid lg:min-h-screen lg:grid-cols-[15rem_1fr]">
        {/* Uma abertura do painel por carregamento (migração 52, tela Acessos). */}
        <RegistrarAcesso sistema={sistema} />
        <ManterSessao />
        <MenuLateral perfil={perfil} versao={versao} sistema={sistema} veFerias={veFerias}
                     avisosReporte={avisosReporte} pendentes={pendentes} />
        <div className="min-w-0">
          <div className="lg:hidden">
            <Navegacao perfil={perfil} pendentes={pendentes} sistema={sistema} versao={versao} avisosReporte={avisosReporte} veFerias={veFerias} />
          </div>
          <main className="max-w-[1680px] px-6 py-8 lg:px-9">{children}</main>
        </div>
      </div>
    );
  }
}
