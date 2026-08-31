import { EsqueletoTitulo, EsqueletoCartao } from '@/componentes/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <EsqueletoTitulo />
      <EsqueletoCartao altura="h-48" />
      <EsqueletoCartao altura="h-96" />
    </div>
  );
}
