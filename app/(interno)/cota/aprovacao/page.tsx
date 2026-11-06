import { TelaDeAprovacao } from './tela';

/** Aprovação das cotas › Aguardando aprovação (4.0.0): o que falta a CEO decidir. */
export default function AguardandoAprovacao({ searchParams }: { searchParams: Promise<{ mes?: string; f?: string; setor?: string }> }) {
  return <TelaDeAprovacao searchParams={searchParams} modo="aguardando" />;
}
