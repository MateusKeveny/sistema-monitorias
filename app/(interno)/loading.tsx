import { EsqueletoTitulo, EsqueletoIndicadores, EsqueletoCartao } from '@/componentes/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <EsqueletoTitulo />
      <EsqueletoIndicadores />
      <EsqueletoCartao />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3"><EsqueletoCartao altura="h-80" /></div>
        <div className="lg:col-span-2"><EsqueletoCartao altura="h-80" /></div>
      </div>
    </div>
  );
}
