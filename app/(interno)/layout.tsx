import Navegacao from '@/componentes/Navegacao';
import MenuLateral from '@/componentes/MenuLateral';
import { VERSAO_COTA, VERSAO_MONITORIAS } from '@/lib/versoes';
import { sistemaAtual } from '@/lib/sistema-servidor';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import LeituraObrigatoria from '@/componentes/LeituraObrigatoria';
import { hojeNoBrasil } from '@/lib/formatar';
import type { LeituraDiario, RegistroDiario } from '@/lib/diario';

export default async function LayoutInterno({ children }: { children: React.ReactNode }) {
  const [perfil, sistema] = await Promise.all([exigirPerfil(), sistemaAtual()]);

  // Exclusões esperando decisão aparecem no Painel, mas o quadro só existe
  // quando há alguma — o gestor não teria como saber que chegou pedido sem
  // abrir a tela por acaso. O contador no menu resolve isso: ele aparece em
  // qualquer página, e some sozinho quando a fila zera. Só existe nas
  // monitorias: no site de cota não há onde decidir.
  let pendentes = 0;
  if (sistema === 'monitorias' && perfil.papel === 'gestor') {
    const db = await criarClienteServidor();
    const { count } = await db
      .from('solicitacoes_exclusao')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pendente');
    pendentes = count ?? 0;
  }

  // Reportar problema (1.33.0): o ponto no botão — respostas novas para quem
  // reportou, reports novos para o gestor (migração 44).
  const dbReportes = await criarClienteServidor();
  const { count: avisosReporte } = perfil.papel === 'gestor'
    ? await dbReportes.from('reportes').select('id', { count: 'exact', head: true }).eq('situacao', 'novo')
    : await dbReportes.from('reportes').select('id', { count: 'exact', head: true })
        .eq('pessoa_id', perfil.id).eq('lido_pelo_autor', false);

  // Menu lateral em tela larga e conteúdo na largura toda — limitado a 7xl,
  // sobrava meia tela vazia em monitor grande. Em janela estreita volta o
  // cabeçalho do topo. Veio no Performance (1.15.0) e passou a valer também
  // nas Monitorias na repaginação delas (5.0.0).
  {
    // Leitura obrigatória do diário (1.29.0): com processo ou treinamento
    // ainda não lido, o painel inteiro dá lugar à leitura — vale também para
    // quem abre uma tela pelo endereço direto. O gestor só acompanha. Só no
    // Performance: é lá que o diário da equipe vive.
    if (sistema === 'cota' && perfil.papel !== 'gestor') {
      const db = await criarClienteServidor();
      const { data: leituras } = await db.rpc('leituras_do_diario');
      const pendentesDeLeitura = ((leituras ?? []) as LeituraDiario[])
        .filter((l) => l.pessoa_id === perfil.id && !l.ciente_em).map((l) => l.registro_id);
      if (pendentesDeLeitura.length) {
        const [{ data: registros }, { data: pessoas }] = await Promise.all([
          db.from('diario_registros').select('*').in('id', pendentesDeLeitura)
            .order('data', { ascending: true }).order('criado_em', { ascending: true }),
          db.rpc('nomes_das_pessoas'),
        ]);
        return (
          <LeituraObrigatoria
            registros={(registros ?? []) as RegistroDiario[]}
            nomes={Object.fromEntries((pessoas ?? []).map((p: { id: string; nome: string }) => [p.id, p.nome]))}
            hoje={hojeNoBrasil()}
          />
        );
      }
    }

    const versao = sistema === 'cota' ? VERSAO_COTA : VERSAO_MONITORIAS;
    return (
      <div className="lg:grid lg:min-h-screen lg:grid-cols-[15rem_1fr]">
        <MenuLateral perfil={perfil} versao={versao} sistema={sistema}
                     avisosReporte={avisosReporte ?? 0} pendentes={pendentes} />
        <div className="min-w-0">
          <div className="lg:hidden">
            <Navegacao perfil={perfil} pendentes={pendentes} sistema={sistema} versao={versao} avisosReporte={avisosReporte ?? 0} />
          </div>
          <main className="max-w-[1680px] px-6 py-8 lg:px-9">{children}</main>
        </div>
      </div>
    );
  }
}
