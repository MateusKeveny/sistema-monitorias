'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { data as formatarData, semanaDoCiclo } from '@/lib/formatar';
import type {
  AvaliacaoDiretores, CargoDaPessoa, ConferenciaLancamento, Lancamento, PesoCargo, Pessoa, RegraCota,
} from '@/lib/tipos';

const entrada = `w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none
                 focus:border-marca-600 disabled:bg-slate-50`;
const rotuloCampo = 'mb-1 block text-xs font-medium text-slate-600';
const botaoPrimario = `rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40`;

const numero = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

type Props = {
  competencia: string;
  canal: 'huggy' | 'diretores';
  inicio: string;
  fim: string;
  pessoas: Pessoa[];
  regras: RegraCota[];
  pesos: PesoCargo[];
  historico: CargoDaPessoa[];
  lancamentos: Lancamento[];
  diretores: AvaliacaoDiretores[];
  conferencia: ConferenciaLancamento[];
};

/**
 * O que não vem de sistema nenhum: lançamentos por regra (chamados, diretores,
 * demandas extras, atestado…) e as avaliações de diretores, nota a nota.
 */
export default function FormularioLancamentos(props: Props) {
  const { competencia, pessoas, historico, conferencia } = props;
  const nomePessoa = new Map(pessoas.map((p) => [p.id, p.nome]));

  /** Cargo vigente da pessoa nesta competência. */
  const cargoDe = (pessoaId: string) => historico
    .filter((h) => h.pessoa_id === pessoaId && h.desde <= competencia)
    .sort((a, b) => b.desde.localeCompare(a.desde))[0]?.cargo_id ?? null;

  const comCargo = pessoas.filter((p) => cargoDe(p.id) != null);

  return (
    <div className="space-y-6">
      {conferencia.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
          <p className="font-semibold">Faixas que não fecham com o total</p>
          <ul className="mt-1 list-disc pl-5">
            {conferencia.map((c) => (
              <li key={`${c.pessoa_id}-${c.bloco}`}>
                {nomePessoa.get(c.pessoa_id) ?? 'Pessoa'} · {c.bloco}: {numero(Number(c.atendimentos))} no
                total, {numero(Number(c.soma_das_faixas))} nas faixas
                ({Number(c.diferenca) > 0 ? '+' : ''}{numero(Number(c.diferenca))})
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">É só um aviso: confira se falta lançar alguma faixa.</p>
        </div>
      )}

      <NovoLancamento {...props} pessoas={comCargo} cargoDe={cargoDe} />
      {/* Avaliação digitada só existe no canal de diretores. */}
      {props.canal === 'diretores' && <AvaliacoesDiretores {...props} pessoas={comCargo} />}
    </div>
  );
}

function NovoLancamento({
  competencia, canal, pessoas, regras, pesos, lancamentos, cargoDe,
}: Props & { cargoDe: (id: string) => number | null }) {
  const router = useRouter();
  const vazio = { pessoa: '', semana: '', regra: '', quantidade: '', pontos: '', observacao: '' };
  const [f, setF] = useState(vazio);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cargo = f.pessoa ? cargoDe(f.pessoa) : null;
  // Só as regras que pontuam no cargo da pessoa escolhida.
  const pesoNoCargo = new Map(pesos.filter((p) => p.cargo_id === cargo).map((p) => [p.regra, Number(p.peso)]));
  // O presencial sai daqui: quem registra agora é o próprio operador, na tela
  // de Atendimento presencial. Mantê-lo nos dois lugares contaria em dobro.
  const disponiveis = regras.filter((r) => pesoNoCargo.has(r.chave) && r.chave !== 'presencial');
  const regra = regras.find((r) => r.chave === f.regra) ?? null;
  const nomePessoa = new Map(pessoas.map((p) => [p.id, p.nome]));
  const rotuloRegra = new Map(regras.map((r) => [r.chave, r.rotulo]));

  const set = (campo: keyof typeof vazio) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((s) => ({ ...s, [campo]: e.target.value }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.pessoa || !regra) return;
    const quantidade = Number(f.quantidade || 0);
    if (!Number.isFinite(quantidade)) { setErro('Quantidade inválida.'); return; }
    if (regra.valor_manual && f.pontos === '') { setErro('Informe os pontos desta regra.'); return; }

    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().from('lancamentos').insert({
      pessoa_id: f.pessoa,
      mes_competencia: competencia,
      canal,
      semana: f.semana ? Number(f.semana) : null,
      regra: regra.chave,
      quantidade,
      pontos_manuais: regra.valor_manual ? Number(f.pontos) : null,
      observacao: f.observacao.trim() || null,
    });
    setOcupado(false);
    if (error) { setErro(error.message); return; }

    // Mantém pessoa e semana: o normal é lançar várias regras seguidas.
    setF((s) => ({ ...vazio, pessoa: s.pessoa, semana: s.semana }));
    router.refresh();
  }

  async function excluir(l: Lancamento) {
    if (!confirm(`Excluir o lançamento "${rotuloRegra.get(l.regra) ?? l.regra}" de `
      + `${nomePessoa.get(l.pessoa_id) ?? 'pessoa'}?`)) return;
    const { error } = await criarClienteNavegador().from('lancamentos').delete().eq('id', l.id);
    if (error) { setErro(error.message); return; }
    router.refresh();
  }

  return (
    <Cartao titulo="Lançamentos manuais">
      <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="lg:col-span-2">
          <span className={rotuloCampo}>Pessoa</span>
          <select value={f.pessoa} onChange={(e) => setF((s) => ({ ...s, pessoa: e.target.value, regra: '' }))}
                  disabled={ocupado} className={entrada} required>
            <option value="">Selecione…</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}{p.ativo ? '' : ' · desligado'}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={rotuloCampo}>Semana</span>
          <select value={f.semana} onChange={set('semana')} disabled={ocupado} className={entrada}>
            <option value="">Mês inteiro</option>
            {[1, 2, 3, 4].map((s) => <option key={s} value={s}>{s}ª semana</option>)}
          </select>
        </label>
        <label className="lg:col-span-3">
          <span className={rotuloCampo}>Regra</span>
          <select value={f.regra} onChange={set('regra')} disabled={ocupado || !f.pessoa}
                  className={entrada} required>
            <option value="">{f.pessoa ? 'Selecione…' : 'Escolha a pessoa primeiro'}</option>
            {disponiveis.map((r) => (
              <option key={r.chave} value={r.chave}>
                {r.rotulo}{r.valor_manual ? ' (valor digitado)' : ` · ${numero(pesoNoCargo.get(r.chave)!)} pts`}
              </option>
            ))}
          </select>
        </label>

        {regra && !regra.valor_manual && (
          <label>
            <span className={rotuloCampo}>Quantidade</span>
            <input type="number" step="any" value={f.quantidade} onChange={set('quantidade')}
                   disabled={ocupado} className={entrada} required />
          </label>
        )}
        {regra?.valor_manual && (
          <label>
            <span className={rotuloCampo}>Pontos (negativo desconta)</span>
            <input type="number" step="any" value={f.pontos} onChange={set('pontos')}
                   disabled={ocupado} className={entrada} required />
          </label>
        )}
        <label className={regra ? 'lg:col-span-4' : 'lg:col-span-5'}>
          <span className={rotuloCampo}>Observação</span>
          <input value={f.observacao} onChange={set('observacao')} disabled={ocupado}
                 className={entrada} placeholder="Opcional" />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={ocupado || !f.pessoa || !f.regra} className={botaoPrimario}>
            {ocupado ? 'Salvando…' : 'Lançar'}
          </button>
        </div>
      </form>

      {erro && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>
      )}

      <div className="mt-5 border-t border-slate-100 pt-5">
        {lancamentos.length === 0 ? (
          <Vazio>Nenhum lançamento nesta competência.</Vazio>
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Pessoa</Th><Th>Semana</Th><Th>Regra</Th>
                <Th className="text-right">Qtde / pontos</Th><Th>Observação</Th><Th>Lançado por</Th><Th />
              </tr>
            </thead>
            <tbody>
              {lancamentos.map((l) => (
                <tr key={l.id}>
                  <Td>{nomePessoa.get(l.pessoa_id) ?? '—'}</Td>
                  <Td>{l.semana ? `${l.semana}ª` : 'mês'}</Td>
                  <Td>{rotuloRegra.get(l.regra) ?? l.regra}</Td>
                  <Td className="text-right tabular-nums">
                    {l.pontos_manuais != null ? `${numero(Number(l.pontos_manuais))} pts` : numero(Number(l.quantidade))}
                  </Td>
                  <Td className="text-xs text-slate-500">{l.observacao ?? ''}</Td>
                  <Td className="text-xs text-slate-500">{l.lancado_por_nome ?? '—'}</Td>
                  <Td>
                    <button type="button" onClick={() => excluir(l)}
                            className="text-xs text-slate-500 hover:text-rose-700 hover:underline">
                      excluir
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </div>
    </Cartao>
  );
}

function AvaliacoesDiretores({ inicio, fim, pessoas, diretores }: Props) {
  const router = useRouter();
  const vazio = { pessoa: '', data: '', nota: '', protocolo: '', observacao: '' };
  const [f, setF] = useState(vazio);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const nomePessoa = new Map(pessoas.map((p) => [p.id, p.nome]));

  const set = (campo: keyof typeof vazio) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setF((s) => ({ ...s, [campo]: e.target.value }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.pessoa || !f.data || !f.nota) return;
    // A data define competência e semana; fora do ciclo aberto, iria parar em
    // outro mês sem aparecer nesta lista.
    if (f.data < inicio || f.data > fim) {
      setErro(`A data precisa estar dentro do ciclo (${formatarData(inicio)} a ${formatarData(fim)}).`);
      return;
    }

    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().from('avaliacoes').insert({
      pessoa_id: f.pessoa,
      origem: 'diretores',
      data: f.data,
      nota: Number(f.nota),
      protocolo: f.protocolo.trim() || null,
      observacao: f.observacao.trim() || null,
    });
    setOcupado(false);
    if (error) { setErro(error.message); return; }

    setF((s) => ({ ...vazio, pessoa: s.pessoa, data: s.data }));
    router.refresh();
  }

  async function excluir(a: AvaliacaoDiretores) {
    if (!confirm(`Excluir a avaliação nota ${a.nota} de ${nomePessoa.get(a.pessoa_id) ?? 'pessoa'}?`)) return;
    const { error } = await criarClienteNavegador().from('avaliacoes').delete().eq('id', a.id);
    if (error) { setErro(error.message); return; }
    router.refresh();
  }

  return (
    <Cartao titulo={`Avaliações de diretores (${diretores.length})`}>
      <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="lg:col-span-2">
          <span className={rotuloCampo}>Pessoa</span>
          <select value={f.pessoa} onChange={set('pessoa')} disabled={ocupado} className={entrada} required>
            <option value="">Selecione…</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}{p.ativo ? '' : ' · desligado'}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={rotuloCampo}>Data</span>
          <input type="date" min={inicio} max={fim} value={f.data} onChange={set('data')}
                 disabled={ocupado} className={entrada} required />
        </label>
        <label>
          <span className={rotuloCampo}>Nota</span>
          <select value={f.nota} onChange={set('nota')} disabled={ocupado} className={entrada} required>
            <option value="">—</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="lg:col-span-2">
          <span className={rotuloCampo}>Protocolo</span>
          <input value={f.protocolo} onChange={set('protocolo')} disabled={ocupado}
                 className={entrada} placeholder="Opcional" />
        </label>
        <label className="lg:col-span-5">
          <span className={rotuloCampo}>Observação</span>
          <input value={f.observacao} onChange={set('observacao')} disabled={ocupado}
                 className={entrada} placeholder="Campo aberto" />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={ocupado || !f.pessoa || !f.data || !f.nota} className={botaoPrimario}>
            {ocupado ? 'Salvando…' : 'Registrar'}
          </button>
        </div>
      </form>

      {erro && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>
      )}

      <div className="mt-5 border-t border-slate-100 pt-5">
        {diretores.length === 0 ? (
          <Vazio>Nenhuma avaliação de diretores neste ciclo.</Vazio>
        ) : (
          <Tabela>
            <thead>
              <tr><Th>Data</Th><Th>Semana</Th><Th>Pessoa</Th><Th>Nota</Th><Th>Protocolo</Th><Th>Observação</Th><Th /></tr>
            </thead>
            <tbody>
              {diretores.map((a) => (
                <tr key={a.id}>
                  <Td className="tabular-nums">{formatarData(a.data)}</Td>
                  <Td>{semanaDoCiclo(a.data)}ª</Td>
                  <Td>{nomePessoa.get(a.pessoa_id) ?? '—'}</Td>
                  <Td className="tabular-nums">{a.nota ?? '—'}</Td>
                  <Td className="tabular-nums">{a.protocolo ?? ''}</Td>
                  <Td className="text-xs text-slate-500">{a.observacao ?? ''}</Td>
                  <Td>
                    <button type="button" onClick={() => excluir(a)}
                            className="text-xs text-slate-500 hover:text-rose-700 hover:underline">
                      excluir
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </div>
    </Cartao>
  );
}
