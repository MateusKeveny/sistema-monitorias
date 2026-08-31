import { EsqueletoTitulo, EsqueletoCartao } from '@/componentes/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <EsqueletoTitulo />
      <EsqueletoCartao altura="h-[32rem]" />
    </div>
  );
}
