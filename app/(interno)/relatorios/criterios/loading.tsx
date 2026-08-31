import { EsqueletoTitulo, EsqueletoIndicadores, EsqueletoTabela } from '@/componentes/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <EsqueletoTitulo />
      <EsqueletoIndicadores quantidade={3} />
      <EsqueletoTabela linhas={10} colunas={6} />
    </div>
  );
}
