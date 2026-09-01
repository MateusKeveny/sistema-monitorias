import { EsqueletoTitulo, EsqueletoTabela } from '@/componentes/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <EsqueletoTitulo />
      <EsqueletoTabela linhas={6} colunas={7} />
    </div>
  );
}
