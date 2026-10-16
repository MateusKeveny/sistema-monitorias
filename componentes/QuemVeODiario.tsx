'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { dataHora } from '@/lib/formatar';
import { mensagemDoErro } from '@/lib/erro-amigavel';

export type VisibilidadeDoDiario = {
  tipo: string;
  quem: 'todos' | 'gestao' | 'gestor';
  autor_ve: boolean;
  alterado_por_nome: string | null;
  alterado_em: string;
};

const TIPOS: { chave: string; nome: string; obs?: string; soGestaoRegistra?: boolean }[] = [
  { chave: 'processo', nome: 'Processo', obs: 'leitura obrigatória' },
  { chave: 'treinamento', nome: 'Treinamento', obs: 'leitura obrigatória' },
  { chave: 'autorizacao', nome: 'Autorização' },
  { chave: 'excecao', nome: 'Exceção' },
  { chave: 'problema', nome: 'Problema operacional', obs: 'só a gestão registra', soGestaoRegistra: true },
];
const NIVEIS = [['todos', 'Todos'], ['gestao', 'Gestão (gestor e Pleno)'], ['gestor', 'Só o gestor']] as const;

/** O que a escolha significa para quem não é da gestão. */
function efeito(quem: string, autorVe: boolean, soGestaoRegistra?: boolean) {
  if (quem === 'todos') return <>Veem todos.</>;
  const quemNao = quem === 'gestor' ? 'Pleno e atendentes' : 'Atendentes';
  return autorVe && !soGestaoRegistra
    ? <>{quemNao} <em className="not-italic text-amber-700 dark:text-amber-300">veem só os que registraram</em>.</>
    : <>{quemNao} <em className="not-italic text-amber-700 dark:text-amber-300">não veem</em>.</>;
}

/**
 * Quem vê cada tipo de registro do diário (1.50.0, migração 67). A regra é do
 * banco, então vale no Performance e na consulta pelo Monitorias, e muda na
 * hora — sem migração nas próximas vezes.
 */
export default function QuemVeODiario({ configuracao }: { configuracao: VisibilidadeDoDiario[] }) {
  const router = useRouter();
  const original = Object.fromEntries(configuracao.map((c) => [c.tipo, c]));
  const [valores, setValores] = useState<Record<string, { quem: string; autor_ve: boolean }>>(
    Object.fromEntries(configuracao.map((c) => [c.tipo, { quem: c.quem, autor_ve: c.autor_ve }])));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const mudou = (t: string) => original[t] && (valores[t].quem !== original[t].quem || valores[t].autor_ve !== original[t].autor_ve);
  const mudancas = TIPOS.filter((t) => mudou(t.chave));
  const ultima = [...configuracao].sort((a, b) => b.alterado_em.localeCompare(a.alterado_em))[0];

  async function salvar() {
    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    for (const t of mudancas) {
      const { error } = await db.rpc('definir_visibilidade_diario',
        { p_tipo: t.chave, p_quem: valores[t.chave].quem, p_autor_ve: valores[t.chave].autor_ve });
      if (error) { setOcupado(false); setErro(await mensagemDoErro(error)); return; }
    }
    setOcupado(false);
    setAviso('Salvo. Já vale para todos os registros desses tipos.');
    router.refresh();
  }

  if (!configuracao.length) {
    return (
      <section className="rounded-[20px] bg-superficie px-5 py-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Quem vê cada tipo de registro</h2>
        <p className="mt-1 text-sm text-slate-600">Falta rodar a migração 67 no banco.</p>
      </section>
    );
  }

  return (
    <section className="rounded-[20px] bg-superficie px-5 py-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Quem vê cada tipo de registro</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        Vale no Performance e na consulta do diário pelo Monitorias. Registrar continua como está.
        {ultima?.alterado_por_nome && <> Última mudança: {ultima.alterado_por_nome}, {dataHora(ultima.alterado_em)}.</>}
      </p>
      {erro && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="w-[22%] border-b border-slate-200 py-2 pr-2 font-semibold">Tipo</th>
            <th className="w-[36%] border-b border-slate-200 px-2 py-2 font-semibold">Quem vê</th>
            <th className="w-[16%] border-b border-slate-200 px-2 py-2 font-semibold">Quem registrou vê o próprio</th>
            <th className="border-b border-slate-200 py-2 pl-2 font-semibold">Para os demais</th>
          </tr>
        </thead>
        <tbody>
          {TIPOS.filter((t) => valores[t.chave]).map((t) => {
            const v = valores[t.chave];
            return (
              <tr key={t.chave} className={mudou(t.chave) ? 'bg-amber-500/8' : ''}>
                <td className="border-b border-slate-100 py-3 pr-2 align-top">
                  <b className="font-semibold text-slate-900">{t.nome}</b>
                  {t.obs && <span className="block text-xs text-slate-500">{t.obs}</span>}
                </td>
                <td className="border-b border-slate-100 px-2 py-3 align-top">
                  <span className="inline-flex overflow-hidden rounded-lg border border-slate-300">
                    {NIVEIS.map(([k, rotulo], i) => (
                      <button key={k} type="button" disabled={ocupado} aria-pressed={v.quem === k}
                              onClick={() => setValores((s) => ({ ...s, [t.chave]: { ...s[t.chave], quem: k } }))}
                              className={`px-3 py-1 text-[13px] ${i ? 'border-l border-slate-300' : ''} ${v.quem === k
                                ? 'bg-marca-600 font-semibold text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                        {rotulo}
                      </button>
                    ))}
                  </span>
                </td>
                <td className="border-b border-slate-100 px-2 py-3 align-top">
                  {v.quem === 'todos' || t.soGestaoRegistra ? <span className="text-slate-400">—</span> : (
                    <label className="inline-flex items-center gap-1.5 text-slate-700">
                      <input type="checkbox" checked={v.autor_ve} disabled={ocupado}
                             onChange={(e) => setValores((s) => ({ ...s, [t.chave]: { ...s[t.chave], autor_ve: e.target.checked } }))} />
                      sim
                    </label>
                  )}
                </td>
                <td className="border-b border-slate-100 py-3 pl-2 align-top text-[13px] text-slate-600">
                  {efeito(v.quem, v.autor_ve, t.soGestaoRegistra)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Processo e Treinamento têm leitura obrigatória e aviso no Teams: se ficarem só com a gestão, a leitura deixa de
        ser cobrada de quem não vê e o aviso não vai para o canal da equipe.
      </p>

      {mudancas.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-marca-600/40 bg-[#0f1a14]
                        px-4 py-2.5 text-sm text-[#e8f5ec]">
          <span><strong>{mudancas.length} {mudancas.length === 1 ? 'alteração' : 'alterações'}</strong> · vale na hora, para todos os registros desse tipo</span>
          <span className="flex gap-2">
            <button type="button" disabled={ocupado}
                    onClick={() => setValores(Object.fromEntries(configuracao.map((c) => [c.tipo, { quem: c.quem, autor_ve: c.autor_ve }])))}
                    className="rounded-lg border border-white/25 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-40">
              Desfazer
            </button>
            <button type="button" disabled={ocupado} onClick={salvar}
                    className="rounded-lg bg-marca-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
              {ocupado ? 'Salvando…' : 'Salvar'}
            </button>
          </span>
        </div>
      )}
    </section>
  );
}
