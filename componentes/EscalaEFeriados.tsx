'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { lerPlanilha } from '@/lib/xlsx-navegador';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { hojeNoBrasil } from '@/lib/formatar';
import {
  NOMES_DOS_DIAS, horasDoDia, lerEscalaEFeriados, textoDoDia,
  type Escala, type Feriado, type LeituraDaPlanilha,
} from '@/lib/escala';

const botao = 'rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40';
const principal = 'rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40';
const campo = 'rounded-lg border border-slate-300 bg-superficie px-2 py-1 text-sm';
const dataBR = (d: string) => d.split('-').reverse().join('/');
const fmtH = (h: number) => `${Math.floor(h)}h${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

function Bloco({ titulo, subtitulo, cor = 'bg-marca-600', children }: {
  titulo: string; subtitulo?: string; cor?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-[20px] bg-superficie px-6 py-5 shadow-sm">
      <h2 className="flex items-center text-base font-semibold text-slate-800">
        <i className={`mr-2.5 inline-block h-2.5 w-2.5 rounded-full ${cor}`} />{titulo}
      </h2>
      {subtitulo && <p className="mt-0.5 text-sm text-slate-500">{subtitulo}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Escala e feriados (4.6.0, migração 107): com a opção ligada no setor, o SLA
 * dos chamados conta só o tempo dentro da escala de quem tratou, pausando no
 * intervalo e nos feriados. Setor sem a opção copia a configuração de outro.
 */
export default function EscalaEFeriados({ setorId, setorNome, ligado, outrosSetores, pessoas, escalas, feriados }: {
  setorId: number; setorNome: string; ligado: boolean;
  outrosSetores: { id: number; nome: string; ligado: boolean }[];
  pessoas: { id: string; nome: string }[];
  escalas: Escala[];
  feriados: Feriado[];
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [leitura, setLeitura] = useState<LeituraDaPlanilha | null>(null);
  const [origem, setOrigem] = useState<number | ''>(outrosSetores.find((s) => s.ligado)?.id ?? '');
  const [novo, setNovo] = useState({ data: '', nome: '', facultativo: false });

  async function rodar(rotulo: string, fazer: () => Promise<string | null | void>) {
    setOcupado(rotulo); setErro(null); setAviso(null);
    try {
      const msg = await fazer();
      if (msg) setAviso(msg);
      router.refresh();
    } catch (e) {
      setErro(await mensagemDoErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }
  const ok = <T,>(r: { error: unknown; data?: T }) => { if (r.error) throw r.error; return r.data; };

  async function escolherArquivo(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null); setAviso(null); setLeitura(null);
    try {
      setLeitura(lerEscalaEFeriados(await lerPlanilha(arquivo), pessoas, setorNome));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const gravarPlanilha = () => rodar('planilha', async () => {
    if (!leitura) return;
    const db = criarClienteNavegador();
    if (leitura.pessoas.length) {
      ok(await db.from('escalas').delete().in('pessoa_id', leitura.pessoas));
      if (leitura.escala.length) ok(await db.from('escalas').insert(leitura.escala));
    }
    if (leitura.feriados.length) {
      ok(await db.from('feriados').upsert(leitura.feriados.map((f) => ({ ...f, setor_id: setorId })), { onConflict: 'setor_id,data' }));
    }
    setLeitura(null);
    return `Gravado: escala de ${leitura.pessoas.length} pessoa${leitura.pessoas.length === 1 ? '' : 's'} e ${leitura.feriados.length} feriado${leitura.feriados.length === 1 ? '' : 's'}. O SLA dos chamados já foi recalculado.`;
  });

  const copiar = () => rodar('copiar', async () => {
    if (origem === '') return;
    const n = ok(await criarClienteNavegador().rpc('copiar_configuracao_do_sla', { p_origem: origem, p_destino: setorId })) as number;
    return `Configuração copiada: ${n} feriado${n === 1 ? '' : 's'} e a opção ligada. Agora suba a escala das pessoas do ${setorNome}.`;
  });

  const desligar = () => rodar('desligar', async () => {
    ok(await criarClienteNavegador().from('setores').update({ sla_pela_escala: false }).eq('id', setorId));
    return 'Opção desligada: o SLA deste setor volta a contar pelo tempo do Elo.';
  });

  const confirmar = (f: Feriado, folga: boolean | null) => rodar(`f${f.id}`, async () => {
    ok(await criarClienteNavegador().from('feriados').update({ confirmado: folga }).eq('id', f.id));
  });
  const apagar = (f: Feriado) => rodar(`f${f.id}`, async () => {
    ok(await criarClienteNavegador().from('feriados').delete().eq('id', f.id));
  });
  const incluir = () => rodar('novo', async () => {
    if (!novo.data || !novo.nome.trim()) throw new Error('Preencha a data e o nome do feriado.');
    ok(await criarClienteNavegador().from('feriados').insert({ setor_id: setorId, data: novo.data, nome: novo.nome.trim(), facultativo: novo.facultativo }));
    setNovo({ data: '', nome: '', facultativo: false });
  });

  // A escala que vale hoje de cada pessoa (a versão mais recente).
  const hoje = hojeNoBrasil();
  const porPessoa = pessoas.map((p) => {
    const dela = escalas.filter((e) => e.pessoa_id === p.id);
    const versoes = [...new Set(dela.map((e) => e.vale_desde ?? ''))].filter((v) => v <= hoje).sort();
    const atual = versoes.at(-1);
    const dias = dela.filter((e) => (e.vale_desde ?? '') === atual);
    const futura = dela.find((e) => (e.vale_desde ?? '') > hoje)?.vale_desde ?? null;
    return { ...p, dias, futura };
  });
  const semEscala = porPessoa.filter((p) => !p.dias.length).length;
  const proximos = feriados.filter((f) => f.data >= hoje);
  const passados = feriados.filter((f) => f.data < hoje);

  const situacao = (f: Feriado) => !f.facultativo ? 'Feriado · pausa o relógio'
    : f.confirmado === true ? 'Facultativo · folga (pausa)'
    : f.confirmado === false ? 'Facultativo · a equipe trabalha'
    : 'Facultativo · a confirmar (conta como dia normal)';

  const LinhaFeriado = ({ f }: { f: Feriado }) => (
    <tr>
      <Td className="whitespace-nowrap tabular-nums">{dataBR(f.data)}</Td>
      <Td>{f.nome}{f.observacao && <span className="block text-xs text-slate-500">{f.observacao}</span>}</Td>
      <Td className={`text-xs ${f.facultativo && f.confirmado == null ? 'font-semibold text-amber-700' : 'text-slate-600'}`}>{situacao(f)}</Td>
      <Td className="text-right">
        <span className="inline-flex flex-wrap justify-end gap-1.5">
          {f.facultativo && f.confirmado !== true && <button className={botao} disabled={!!ocupado} onClick={() => confirmar(f, true)}>Folga</button>}
          {f.facultativo && f.confirmado !== false && <button className={botao} disabled={!!ocupado} onClick={() => confirmar(f, false)}>Trabalha</button>}
          <button className={botao} disabled={!!ocupado} onClick={() => apagar(f)}>Excluir</button>
        </span>
      </Td>
    </tr>
  );

  return (
    <div className="space-y-6">
      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

      {!ligado ? (
        <Bloco titulo="O SLA deste setor conta pelo Elo" cor="bg-slate-400"
               subtitulo={`No ${setorNome} o SLA dos chamados usa o tempo do Elo (dia útil de 24 h). Para contar pela escala de cada pessoa, copie a configuração de um setor que já usa: vêm os feriados e a opção ligada; a escala de cada pessoa vem pela planilha.`}>
          {outrosSetores.some((s) => s.ligado) ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600">Copiar de</span>
              <select className={campo} value={origem} onChange={(e) => setOrigem(e.target.value ? Number(e.target.value) : '')}>
                {outrosSetores.filter((s) => s.ligado).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
              <button className={principal} disabled={!!ocupado || origem === ''} onClick={copiar}>
                {ocupado === 'copiar' ? 'Copiando…' : 'Copiar as configurações'}
              </button>
            </div>
          ) : <Vazio>Nenhum setor usa a escala ainda.</Vazio>}
        </Bloco>
      ) : (
        <Bloco titulo="Como o SLA conta neste setor"
               subtitulo="Do momento da abertura até a conclusão, só dentro da escala de quem tratou o chamado. O intervalo e os feriados pausam o relógio; 1 dia útil é o expediente da pessoa naquele dia. Quem não tem escala continua com o tempo do Elo.">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <span>{porPessoa.length - semEscala} de {porPessoa.length} pessoas com escala · {proximos.length} feriado{proximos.length === 1 ? '' : 's'} pela frente</span>
            <button className={botao} disabled={!!ocupado} onClick={desligar}>Voltar para o tempo do Elo</button>
          </div>
        </Bloco>
      )}

      <Bloco titulo="Subir a planilha" cor="bg-sky-500"
             subtitulo="Abas &quot;Horários&quot; (uma linha por pessoa e grupo de dias, ex.: seg a sex, sáb) e &quot;Feriados&quot;. Quem vier na planilha tem a escala trocada pela nova; os feriados são somados aos que já estão. A planilha é lida no seu computador.">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:bg-slate-50">
          <span><strong className="text-slate-800">Escolha a planilha de horários e feriados</strong> (.xlsx)</span>
          <input type="file" accept=".xlsx" className="sr-only" disabled={!!ocupado}
                 onChange={(e) => { escolherArquivo(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {leitura && (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-slate-700">
              {leitura.pessoas.length} pessoa{leitura.pessoas.length === 1 ? '' : 's'} · {leitura.escala.length} dia{leitura.escala.length === 1 ? '' : 's'} de escala · {leitura.feriados.length} feriado{leitura.feriados.length === 1 ? '' : 's'}
              {leitura.feriados.some((f) => f.facultativo) && ` (${leitura.feriados.filter((f) => f.facultativo).length} facultativos, a confirmar)`}
            </p>
            {leitura.erros.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-lg bg-rose-50 py-2 pl-7 pr-3 text-rose-800 ring-1 ring-rose-600/20">
                {leitura.erros.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
            {leitura.avisos.map((a, i) => <p key={i} className="text-slate-500">{a}</p>)}
            <div className="flex justify-end gap-2">
              <button className={botao} disabled={!!ocupado} onClick={() => setLeitura(null)}>Cancelar</button>
              <button className={principal} disabled={!!ocupado || leitura.erros.length > 0 || (!leitura.escala.length && !leitura.feriados.length)} onClick={gravarPlanilha}>
                {ocupado === 'planilha' ? 'Gravando…' : leitura.erros.length ? 'Corrija os erros para gravar' : 'Gravar'}
              </button>
            </div>
          </div>
        )}
      </Bloco>

      <Bloco titulo={`Escala · ${setorNome}`} subtitulo="A escala que vale hoje. Dia sem horário: a pessoa não trabalha, o relógio não anda.">
        <Tabela noQuadro>
          <thead>
            <tr><Th>Pessoa</Th>{[1, 2, 3, 4, 5, 6, 7].map((d) => <Th key={d}>{NOMES_DOS_DIAS[d]}</Th>)}<Th className="text-right">Semana</Th></tr>
          </thead>
          <tbody>
            {porPessoa.map((p) => (
              <tr key={p.id}>
                <Td className="whitespace-nowrap">{p.nome}
                  {p.futura && <span className="block text-xs text-sky-700">escala nova em {dataBR(p.futura)}</span>}
                </Td>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                  const e = p.dias.find((x) => x.dia_semana === d);
                  return <Td key={d} className="whitespace-nowrap text-xs tabular-nums text-slate-700">{e ? textoDoDia(e) : <span className="text-slate-300">—</span>}</Td>;
                })}
                <Td className="whitespace-nowrap text-right text-xs tabular-nums text-slate-600">
                  {p.dias.length ? fmtH(p.dias.reduce((a, e) => a + horasDoDia(e), 0)) : <span className="text-slate-400">sem escala · Elo</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      </Bloco>

      <Bloco titulo={`Feriados · ${setorNome}`} cor="bg-amber-500"
             subtitulo="Feriado pausa o relógio o dia inteiro. Ponto facultativo só pausa depois de confirmado como folga; enquanto não confirmado, conta como dia normal e aparece em &quot;Precisa de você&quot; 15 dias antes.">
        {proximos.length ? (
          <Tabela noQuadro>
            <thead><tr><Th>Data</Th><Th>Feriado</Th><Th>Situação</Th><Th className="text-right" /></tr></thead>
            <tbody>{proximos.map((f) => <LinhaFeriado key={f.id} f={f} />)}</tbody>
          </Tabela>
        ) : <Vazio>Nenhum feriado pela frente.</Vazio>}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <input type="date" className={campo} value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} />
          <input type="text" className={`${campo} min-w-[14rem]`} placeholder="Nome do feriado" value={novo.nome}
                 onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          <label className="flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" checked={novo.facultativo} onChange={(e) => setNovo({ ...novo, facultativo: e.target.checked })} /> ponto facultativo
          </label>
          <button className={botao} disabled={!!ocupado} onClick={incluir}>Incluir feriado</button>
        </div>
        {passados.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-slate-600">Feriados que já passaram · {passados.length}</summary>
            <div className="mt-2">
              <Tabela noQuadro>
                <tbody>{passados.map((f) => <LinhaFeriado key={f.id} f={f} />)}</tbody>
              </Tabela>
            </div>
          </details>
        )}
      </Bloco>
    </div>
  );
}
