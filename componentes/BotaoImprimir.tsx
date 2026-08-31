'use client';

export default function BotaoImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="sem-impressao rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold
                 text-white hover:bg-marca-700"
    >
      Imprimir / salvar PDF
    </button>
  );
}
