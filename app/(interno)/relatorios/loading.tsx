import { EsqueletoTitulo, EsqueletoCartao } from '@/componentes/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <EsqueletoTitulo />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => <EsqueletoCartao key={i} altura="h-28" />)}
      </div>
    </div>
  );
}
