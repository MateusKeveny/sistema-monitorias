'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Quadro, Tabela, Td, Th, Vazio } from '@/componentes/ui';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import type { Cargo, PesoCargo, RegraCota } from '@/lib/tipos';
import type { Canal, Setor } from '@/lib/setores';

const entrada = 'w-20 rounded-md border border-slate-300 bg-superficie px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-marca-600';
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

/**
 * Regras por fila (3.0, etapa 3): as métricas que mudam de fila para fila —
 * finalizado e as faixas de TME — numa tabela só, uma coluna por fila. Desde
 * a migração 84 a fila diz quais regras usa; uma fila que copiou as métricas
 * de outra usa as MESMAS regras, então aparece com o valor da original (↺) e
 * muda junto. C-SAT e notas de 1 a 5 são da equipe: iguais em todas as filas.
 *
 * Grava em `pesos_por_cargo`, como a Matriz de pesos, com o motivo no
 * histórico (migração 56).
 */
export default function RegrasPorFila({ setores, filas, regras, pesos, cargos }: {
  setores: Setor[]; filas: Canal[]; regras: RegraCota[]; pesos: PesoCargo[]; cargos: Cargo[];
}) {
  const router = useRouter();
  // Um setor por vez. Até a etapa 4 o gestor vê todos; com mais de um, escolhe.
  const setoresComFila = setores.filter((s) => filas.some((f) => f.setor_id === s.id && f.ativo && f.regra_finalizado));
  const [setorId, setSetorId] = useState<number | undefined>(setoresComFila[0]?.id);
  const setor = setoresComFila.find((s) => s.id === setorId);
  const comRegras = filas.filter((f) => f.ativo && f.regra_finalizado && f.setor_id === setorId);
  const regraPor = useMemo(() => new Map(regras.map((r) => [r.chave, r])), [regras]);

  // Os cargos que pontuam finalizado em alguma fila.
  const finalizados = new Set(comRegras.map((f) => f.regra_finalizado!));
  const cargosQuePontuam = cargos.filter((c) => pesos.some((p) => p.cargo_id === c.id && p.ativo && finalizados.has(p.regra)));
  const [cargoId, setCargoId] = useState<number | undefined>(cargosQuePontuam[0]?.id);

  // As faixas de TME de cada fila, na ordem (até 15 min, até 30, acima).
  const faixasDe = (grupo: string | null | undefined) => (grupo
    ? regras.filter((r) => r.grupo === grupo && r.ativo).sort((a, b) => a.ordem - b.ordem) : []);
  const qtdFaixas = Math.max(0, ...comRegras.map((f) => faixasDe(f.grupo_tme).length));
  const nomeFaixa = (i: number) => {
    const r = comRegras.map((f) => faixasDe(f.grupo_tme)[i]).find(Boolean);
    return r ? `TME ${r.rotulo.split(' - ').at(-1) ?? ''}` : `TME faixa ${i + 1}`;
  };
  const linhas: { rotulo: string; regraDa: (f: Canal) => string | null }[] = [
    { rotulo: 'Finalizado (por atendimento)', regraDa: (f) => f.regra_finalizado ?? null },
    ...Array.from({ length: qtdFaixas }, (_, i) => ({
      rotulo: nomeFaixa(i), regraDa: (f: Canal) => faixasDe(f.grupo_tme)[i]?.chave ?? null,
    })),
  ];

  // Quem é dono de cada regra: a primeira fila que a usa sem ser cópia.
  const dono = new Map<string, number>();
  for (const f of comRegras) {
    for (const l of linhas) {
      const k = l.regraDa(f);
      if (k && !f.copia_de && !dono.has(k)) dono.set(k, f.id);
    }
  }

  const valorOriginal = (regra: string) => {
    const p = pesos.find((x) => x.cargo_id === cargoId && x.regra === regra);
    return p && p.ativo ? Number(p.peso) : null;
  };
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const chave = (regra: string) => `${cargoId}|${regra}`;
  const valor = (regra: string) => rascunho[chave(regra)]
    ?? (valorOriginal(regra) == null ? '' : String(valorOriginal(regra)).replace('.', ','));

  const mudancas = Object.entries(rascunho).flatMap(([k, t]) => {
    const [cargo, regra] = k.split('|');
    const original = pesos.find((x) => x.cargo_id === Number(cargo) && x.regra === regra);
    const n = t.trim() === '' ? null : Number(t.trim().replace(/\./g, '').replace(',', '.'));
    const antes = original && original.ativo ? Number(original.peso) : null;
    return n === antes ? [] : [{ cargo_id: Number(cargo), regra, n }];
  });
  const invalida = mudancas.some((m) => m.n != null && !Number.isFinite(m.n));

  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function salvar() {
    if (invalida) { setErro('Peso inválido: use números, como 4 ou -0,5.'); return; }
    if (!motivo.trim()) { setErro('Escreva o motivo da alteração.'); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const agora = new Date().toISOString();
    const { error } = await criarClienteNavegador().from('pesos_por_cargo').upsert(
      mudancas.map((m) => ({ cargo_id: m.cargo_id, regra: m.regra, peso: m.n ?? 0, ativo: m.n != null,
                             atualizado_em: agora, motivo_alteracao: motivo.trim() })),
      { onConflict: 'cargo_id,regra' },
    );
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setAviso(`${mudancas.length} ${mudancas.length === 1 ? 'peso salvo' : 'pesos salvos'}. Meses já fechados não mudam.`);
    setRascunho({}); setMotivo('');
    router.refresh();
  }

  const compartilhadas = regras.filter((r) => ['csat', 'nota'].includes(r.grupo) && r.ativo)
    .sort((a, b) => a.ordem - b.ordem);

  if (!comRegras.length) return <Quadro titulo="Regras por fila"><Vazio>Nenhuma fila com regras ainda.</Vazio></Quadro>;

  return (
    <div className="space-y-6">
      {setoresComFila.length > 1 && (
        <div className="inline-flex gap-1 rounded-xl bg-black/25 p-1" role="tablist" aria-label="Setor">
          {setoresComFila.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={setorId === s.id}
                    onClick={() => { setSetorId(s.id); setRascunho({}); setErro(null); setAviso(null); }}
                    className={`rounded-lg px-4 py-1.5 text-sm transition ${setorId === s.id
                      ? 'bg-superficie font-semibold text-slate-900 shadow-sm' : 'text-sobre-fundo-suave hover:text-sobre-fundo'}`}>
              {s.nome}
            </button>
          ))}
        </div>
      )}
      <Quadro titulo={`Regras por fila · ${setor?.nome ?? ''}`}
              subtitulo={`As filas do setor ${setor?.nome ?? ''} e o que muda de uma para outra. Fila que copiou as métricas de outra mostra o valor da original (↺) e muda junto com ela.`}>
        <div className="mb-4 inline-flex gap-1 rounded-full bg-slate-100 p-1" role="tablist" aria-label="Cargo">
          {cargosQuePontuam.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={cargoId === c.id} onClick={() => setCargoId(c.id)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${cargoId === c.id
                      ? 'bg-superficie text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
              {c.nome}
            </button>
          ))}
        </div>

        <Tabela noQuadro>
          <thead>
            <tr>
              <Th>Métrica</Th>
              {comRegras.map((f) => (
                <Th key={f.id} className="text-right">
                  {f.nome}
                  {f.copia_de && <span className="block text-[11px] font-normal normal-case text-slate-500">
                    copia {filas.find((x) => x.id === f.copia_de)?.nome}
                  </span>}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.rotulo}>
                <Td className="font-medium text-slate-800">{l.rotulo}</Td>
                {comRegras.map((f) => {
                  const regra = l.regraDa(f);
                  if (!regra) return <Td key={f.id} className="text-right text-xs text-slate-400">não pontua</Td>;
                  const donoId = dono.get(regra);
                  if (donoId != null && donoId !== f.id) {
                    const v = valor(regra);
                    return (
                      <Td key={f.id} className="text-right tabular-nums text-slate-500">
                        <span title={`Mesma regra da fila ${filas.find((x) => x.id === donoId)?.nome}: muda junto`}>
                          ↺ {v === '' ? '—' : v}
                        </span>
                      </Td>
                    );
                  }
                  return (
                    <Td key={f.id} className="text-right">
                      <input value={valor(regra)} disabled={ocupado || cargoId == null} inputMode="decimal"
                             aria-label={`${l.rotulo} · ${f.nome}`} title={regraPor.get(regra)?.rotulo}
                             onChange={(e) => setRascunho((r) => ({ ...r, [chave(regra)]: e.target.value }))}
                             className={entrada} />
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Tabela>

        {erro && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
        {aviso && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}
        {mudancas.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <span className="text-sm text-slate-600">{mudancas.length} alteração{mudancas.length > 1 ? 'ões' : ''}</span>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={ocupado}
                   placeholder="Motivo da alteração (vai para o histórico)" aria-label="Motivo da alteração"
                   className="min-w-72 rounded-md border border-slate-300 bg-superficie px-2 py-1 text-sm outline-none focus:border-marca-600" />
            <button type="button" onClick={() => { setRascunho({}); setErro(null); }} disabled={ocupado}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Descartar
            </button>
            <button type="button" onClick={salvar} disabled={ocupado || !motivo.trim()}
                    className="rounded-lg bg-marca-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
              {ocupado ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        )}
      </Quadro>

      <Quadro titulo="Valem para todas as filas"
              subtitulo="C-SAT e notas de 1 a 5 são os da equipe: a mesma régua em todas as filas. Os pesos ficam em Pesos por cargo.">
        <Tabela noQuadro>
          <thead><tr><Th>Métrica</Th><Th className="text-right">Todas as filas</Th></tr></thead>
          <tbody>
            {compartilhadas.map((r) => {
              const v = valorOriginal(r.chave);
              return (
                <tr key={r.chave}>
                  <Td className="text-slate-800">{r.rotulo}</Td>
                  <Td className="text-right tabular-nums">{v == null ? '—' : num(v)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Tabela>
        <p className="mt-3 text-xs text-slate-500">
          Monitoria, lançamentos manuais e a média da equipe valem para a pessoa, não para a fila.
        </p>
      </Quadro>
    </div>
  );
}
