'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/componentes/Link';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { dataHora, diaMes, duracao } from '@/lib/formatar';
import { mensagemDoErro } from '@/lib/erro-amigavel';

export type RegistroDoDiario = { id: string; data: string; tipo: string; assunto: string };

export type SemanaDoCanal = {
  semana: number;
  periodo: string;
  de: string;
  ate: string;
  tmeSeg: number | null;
  faixa: string | null;
  finalizados: number;
  /** O que a faixa de TME rendeu (+) ou tirou (−) na semana, somado na equipe. */
  pontos: number;
  desligada: {
    motivo: string;
    temRegistroDiario: boolean;
    registro: RegistroDoDiario | null;
    por: string | null;
    em: string;
  } | null;
};

const TIPO_DO_DIARIO: Record<string, string> = {
  processo: 'Processo', treinamento: 'Treinamento', autorizacao: 'Autorização',
  excecao: 'Exceção', problema: 'Problema operacional',
};
const pontos = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const botao = 'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40';

/**
 * As chaves de cada semana e canal (1.49.0, migração 66). Desligar abre a
 * justificativa: o motivo e se houve registro no diário de bordo — e qual.
 */
export default function PainelMetricasDaSemana({
  competencia, canais, registros, fechado,
}: {
  competencia: string;
  canais: { chave: string; nome: string; semanas: SemanaDoCanal[] }[];
  registros: RegistroDoDiario[];
  fechado: boolean;
}) {
  const router = useRouter();
  const [pedido, setPedido] = useState<{ canal: string; nome: string; s: SemanaDoCanal } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [noDiario, setNoDiario] = useState<'sim' | 'nao' | null>(null);
  const [registro, setRegistro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function abrir(canal: string, nome: string, s: SemanaDoCanal) {
    setPedido({ canal, nome, s }); setMotivo(''); setNoDiario(null); setRegistro(''); setErro(null);
  }

  async function desligar() {
    if (!pedido) return;
    if (!motivo.trim()) { setErro('Escreva o motivo.'); return; }
    if (!noDiario) { setErro('Diga se houve registro no diário de bordo.'); return; }
    if (noDiario === 'sim' && !registro) { setErro('Escolha o registro do diário de bordo.'); return; }
    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().rpc('desligar_metrica', {
      p_mes: competencia, p_semana: pedido.s.semana, p_canal: pedido.canal, p_motivo: motivo.trim(),
      p_tem_registro_diario: noDiario === 'sim', p_diario_registro_id: noDiario === 'sim' ? registro : null,
    });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setPedido(null);
    router.refresh();
  }

  async function religar(canal: string, semana: number) {
    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().rpc('religar_metrica', { p_mes: competencia, p_semana: semana, p_canal: canal });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    router.refresh();
  }

  const daSemana = pedido ? registros.filter((r) => r.data >= pedido.s.de && r.data <= pedido.s.ate) : [];

  return (
    <>
      {erro && !pedido && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        {canais.map((c) => (
          <section key={c.chave} className="rounded-[20px] bg-superficie px-5 py-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">TME · {c.nome}</h2>
            <p className="mt-0.5 text-xs text-slate-500">TME médio da equipe na semana e a faixa que ele deu (na fila que avalia por pessoa, cada um cai na faixa do próprio TME). Chave ligada: contabiliza.</p>
            <ul className="mt-2">
              {c.semanas.map((s) => {
                const ligada = !s.desligada;
                return (
                  <li key={s.semana} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 border-t border-slate-100 py-2.5">
                    <span>
                      <b className="block text-sm text-slate-900">{s.semana}ª semana</b>
                      <span className="text-xs text-slate-500">{s.periodo}</span>
                    </span>
                    <span className="text-sm text-slate-700">
                      {s.tmeSeg == null ? <span className="text-slate-400">sem dado ainda</span> : (
                        <>
                          TME {duracao(s.tmeSeg)}
                          {s.faixa && <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-px text-xs text-slate-600">{s.faixa}</span>}
                          <span className="block text-xs text-slate-500">
                            {s.finalizados.toLocaleString('pt-BR')} atendimentos na equipe
                            {ligada && s.pontos !== 0 && ` · faixa ${s.pontos > 0 ? 'soma' : 'tira'} ${pontos(Math.abs(s.pontos))} pts`}
                          </span>
                        </>
                      )}
                    </span>
                    <button type="button" role="switch" aria-checked={ligada}
                            aria-label={`Contabilizar o TME da ${s.semana}ª semana · ${c.nome}`}
                            disabled={fechado || ocupado || (ligada && s.tmeSeg == null)}
                            onClick={() => (ligada ? abrir(c.chave, c.nome, s) : religar(c.chave, s.semana))}
                            title={ligada ? 'Não contabilizar esta semana' : 'Voltar a contar'}
                            className={`relative h-6 w-11 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
                              ligada ? 'bg-marca-600' : 'bg-slate-300'}`}>
                      <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${
                        ligada ? 'left-[23px]' : 'left-[3px]'}`} />
                    </button>
                    {s.desligada && (
                      <p className="col-span-3 -mt-0.5 rounded-lg bg-amber-500/12 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                        <strong>Não contabilizado.</strong> {s.desligada.motivo}
                        <span className="text-slate-500"> — {s.desligada.por ?? 'gestão'}, {dataHora(s.desligada.em)}</span>
                        {' · '}
                        {s.desligada.registro
                          ? <Link href="/cota/diario" className="underline">📓 {diaMes(s.desligada.registro.data)} · {TIPO_DO_DIARIO[s.desligada.registro.tipo] ?? s.desligada.registro.tipo} · {s.desligada.registro.assunto}</Link>
                          : s.desligada.temRegistroDiario ? 'registro do diário removido' : 'sem registro no diário'}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {pedido && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4" role="dialog" aria-modal="true"
             aria-label={`Não contabilizar o TME da ${pedido.s.semana}ª semana`}>
          <div className="w-full max-w-lg rounded-2xl bg-superficie p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">
              Não contabilizar o TME da {pedido.s.semana}ª semana · {pedido.nome}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              A faixa de TME desta semana ({pedido.s.periodo}) deixa de contar no extrato de todos do canal. O motivo
              fica registrado com o seu nome, visível só para a gestão.
            </p>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={ocupado} autoFocus
                      placeholder="Ex.: queda do sistema de atendimento travou os atendimentos e inflou o tempo médio."
                      className="mt-3 min-h-24 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900
                                 outline-none focus:border-marca-600" />

            <fieldset className="mt-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700">
              <legend className="px-1 font-semibold text-slate-900">Houve registro no diário de bordo?</legend>
              <div className="flex gap-5">
                {(['sim', 'nao'] as const).map((v) => (
                  <label key={v} className="inline-flex items-center gap-1.5">
                    <input type="radio" name="diario" checked={noDiario === v} disabled={ocupado}
                           onChange={() => setNoDiario(v)} /> {v === 'sim' ? 'Sim' : 'Não'}
                  </label>
                ))}
              </div>
              {noDiario === 'sim' && (
                daSemana.length ? (
                  <select value={registro} onChange={(e) => setRegistro(e.target.value)} disabled={ocupado}
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm">
                    <option value="">Escolha o registro…</option>
                    {daSemana.map((r) => (
                      <option key={r.id} value={r.id}>{diaMes(r.data)} · {TIPO_DO_DIARIO[r.tipo] ?? r.tipo} · {r.assunto}</option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Nenhum registro no diário entre {diaMes(pedido.s.de)} e {diaMes(pedido.s.ate)}.{' '}
                    <Link href="/cota/diario" className="underline">Registrar no diário de bordo ›</Link>
                  </p>
                )
              )}
              {noDiario === 'nao' && (
                <p className="mt-2 text-xs text-slate-500">
                  Fica anotado &ldquo;sem registro no diário&rdquo;.{' '}
                  <Link href="/cota/diario" className="text-marca-700 underline dark:text-marca-400">Registrar no diário de bordo ›</Link>
                </p>
              )}
            </fieldset>

            {pedido.s.pontos !== 0 && (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Efeito: a faixa &ldquo;{pedido.s.faixa}&rdquo; deixa de entrar para os{' '}
                {pedido.s.finalizados.toLocaleString('pt-BR')} atendimentos da semana —{' '}
                <strong>{pedido.s.pontos < 0 ? '+' : '−'}{pontos(Math.abs(pedido.s.pontos))} pts</strong> somados na equipe.
              </p>
            )}
            {erro && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={ocupado} onClick={() => setPedido(null)}
                      className={`${botao} border border-slate-300 bg-superficie font-medium text-slate-700 hover:bg-slate-50`}>
                Cancelar
              </button>
              <button type="button" disabled={ocupado} onClick={desligar}
                      className={`${botao} bg-marca-600 text-white hover:bg-marca-700`}>
                {ocupado ? 'Salvando…' : 'Não contabilizar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
