import { EsqueletoTitulo, EsqueletoTabela } from '@/componentes/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <EsqueletoTitulo />
      <EsqueletoTabela linhas={8} colunas={4} />
      <div className="grid gap-6 xl:grid-cols-2">
        <EsqueletoTabela linhas={5} colunas={3} />
        <EsqueletoTabela linhas={5} colunas={3} />
      </div>
    </div>
  );
}
