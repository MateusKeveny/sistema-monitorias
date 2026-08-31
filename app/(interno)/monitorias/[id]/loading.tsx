import { EsqueletoTitulo, EsqueletoCartao } from '@/componentes/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <EsqueletoTitulo />
      <div className="grid gap-6 lg:grid-cols-3">
        <EsqueletoCartao altura="h-72" />
        <div className="lg:col-span-2"><EsqueletoCartao altura="h-72" /></div>
      </div>
    </div>
  );
}
