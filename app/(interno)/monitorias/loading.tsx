import { EsqueletoTitulo, EsqueletoTabela } from '@/componentes/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <EsqueletoTitulo />
      <EsqueletoTabela linhas={10} colunas={8} />
    </div>
  );
}
