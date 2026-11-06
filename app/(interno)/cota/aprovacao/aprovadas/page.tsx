import { TelaDeAprovacao } from '../tela';

/** Aprovação das cotas › Aprovadas (4.0.0): as cotas já aprovadas (finalizadas), para consultar. */
export default function Aprovadas({ searchParams }: { searchParams: Promise<{ mes?: string; f?: string; setor?: string }> }) {
  return <TelaDeAprovacao searchParams={searchParams} modo="aprovadas" />;
}
