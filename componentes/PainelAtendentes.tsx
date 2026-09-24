'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { NOMES_PAPEL, type Pessoa, type Saida } from '@/lib/tipos';

const entrada = `rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                 focus:border-marca-600 disabled:bg-slate-50`;
const botaoPrimario = `rounded-lg bg-marca-600 px-3 py-1.5 text-xs font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40`;
const botaoSecundario = `rounded-lg border border-slate-300 bg-superficie px-2.5 py-1 text-xs
                         font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40`;

const data = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const numero = (v: unknown) =>
  Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const competencia = (iso: string) => {
  const [ano, mes] = iso.split('-');
  return `${mes}/${ano}`;
};

/**
 * Atendentes: quem está na operação, desde quando, e o registro de quem saiu.
 *
 * As duas datas existem por causa do cálculo: quem entrou ou saiu no meio da
 * competência fica de fora da média do cargo, porque um mês pela metade
 * puxaria a média de quem recebe por ela. O extrato da pessoa continua
 * intacto — ela só não entra na conta dos outros.
 *
 * Registrar a saída faz tudo de uma vez: guarda a foto do que a pessoa
 * produziu, grava a data e corta o acesso aos dois sistemas.
 */
export default function PainelAtendentes({
  pessoas, saidas,
}: {
  pessoas: Pessoa[];
  saidas: Saida[];
}) {
  const router = useRouter();
  const [mostrarSaidas, setMostrarSaidas] = useState(false);
  const [desligando, setDesligando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  const naOperacao = pessoas.filter((p) => !p.desligado_em);
  const foraDaOperacao = pessoas.filter((p) => p.desligado_em);
  const saidaDe = (id: string) =>
    saidas.filter((s) => s.pessoa_id === id && !s.revertida_em)
      .sort((a, b) => b.data.localeCompare(a.data))[0];

  async function salvarData(id: string, campo: 'admitido_em', valor: string) {
    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const { error } = await db.from('pessoas').update({ [campo]: valor || null }).eq('id', id);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    router.refresh();
  }

  async function registrarSaida(pessoa: Pessoa, dia: string, motivo: string) {
    if (!dia) { setErro('Informe a data da saída.'); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const { error } = await db.rpc('registrar_saida', {
      p_pessoa: pessoa.id, p_data: dia, p_motivo: motivo || null,
    });
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setDesligando(null);
    setAviso(`Saída de ${pessoa.nome} registrada em ${data(dia)}. `
      + 'O acesso foi encerrado e o histórico ficou guardado.');
    router.refresh();
  }

  async function reverter(pessoa: Pessoa) {
    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const { error } = await db.rpc('reverter_saida', { p_pessoa: pessoa.id });
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setAviso(`${pessoa.nome} voltou para a operação, com acesso liberado.`);
    router.refresh();
  }

  const Aviso = () => (
    <>
      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}
      {aviso && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800
                      ring-1 ring-emerald-600/20">{aviso}</p>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      <Cartao
        titulo={`Na operação (${naOperacao.length})`}
        acao={foraDaOperacao.length ? (
          <button type="button" className={botaoSecundario}
                  onClick={() => setMostrarSaidas((v) => !v)}>
            {mostrarSaidas ? 'Esconder' : `Ver desligados (${foraDaOperacao.length})`}
          </button>
        ) : undefined}
      >
        <Aviso />

        <Tabela>
          <thead>
            <tr>
              <Th>Pessoa</Th>
              <Th className="w-36">Papel</Th>
              <Th className="w-40">Entrada</Th>
              <Th className="w-24 text-center">Acesso</Th>
              <Th className="w-44"> </Th>
            </tr>
          </thead>
          <tbody>
            {naOperacao.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium text-slate-800">
                  {p.nome}
                  {p.email && <span className="block text-xs font-normal text-slate-500">{p.email}</span>}
                </Td>
                <Td className="text-sm text-slate-600">{NOMES_PAPEL[p.papel]}</Td>
                <Td>
                  <input
                    type="date" defaultValue={p.admitido_em ?? ''} disabled={ocupado}
                    className={entrada} aria-label={`Entrada de ${p.nome}`}
                    onBlur={(e) => {
                      if ((e.target.value || null) !== (p.admitido_em ?? null)) {
                        salvarData(p.id, 'admitido_em', e.target.value);
                      }
                    }}
                  />
                </Td>
                <Td className="text-center text-xs">
                  {p.ativo
                    ? <span className="text-emerald-700">tem login</span>
                    : <span className="text-slate-400">sem login</span>}
                </Td>
                <Td>
                  {desligando === p.id ? (
                    <FormularioSaida
                      pessoa={p} ocupado={ocupado}
                      onCancelar={() => setDesligando(null)}
                      onConfirmar={(dia, motivo) => registrarSaida(p, dia, motivo)}
                    />
                  ) : (
                    <button type="button" className={botaoSecundario} disabled={ocupado}
                            onClick={() => { setDesligando(p.id); setErro(null); setAviso(null); }}>
                      Registrar saída
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>

        <p className="mt-4 text-xs text-slate-500">
          A <strong>entrada</strong> e a saída decidem quem compõe a média do cargo: quem
          trabalhou a competência pela metade fica de fora dela, sem perder o próprio
          extrato. Entrada em branco significa que a pessoa já estava na equipe antes do
          painel existir, e por isso conta em todos os meses.
        </p>
      </Cartao>

      {mostrarSaidas && (
        <Cartao titulo={`Desligados (${foraDaOperacao.length})`}>
          <Aviso />
          {!foraDaOperacao.length ? (
            <Vazio>Ninguém desligado.</Vazio>
          ) : (
            <div className="space-y-3">
              {foraDaOperacao.map((p) => {
                const s = saidaDe(p.id);
                return (
                  <div key={p.id} className="rounded-lg ring-1 ring-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <p className="font-medium text-slate-800">{p.nome}</p>
                        <p className="text-xs text-slate-500">
                          Saída em {data(p.desligado_em)}
                          {s?.motivo ? ` · ${s.motivo}` : ''}
                          {s?.registrado_por_nome ? ` · registrado por ${s.registrado_por_nome}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {s && (
                          <button type="button" className={botaoSecundario}
                                  onClick={() => setAberta(aberta === p.id ? null : p.id)}>
                            {aberta === p.id ? 'Fechar registro' : 'Ver registro'}
                          </button>
                        )}
                        <button type="button" className={botaoSecundario} disabled={ocupado}
                                onClick={() => reverter(p)}>
                          Voltar para a operação
                        </button>
                      </div>
                    </div>

                    {aberta === p.id && s && <Registro saida={s} />}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-4 text-xs text-slate-500">
            O registro é a foto tirada no dia da saída e não muda depois — nem se os
            dados da competência forem corrigidos ou redistribuídos. Voltar alguém para a
            operação libera o acesso de novo e mantém o registro guardado.
          </p>
        </Cartao>
      )}
    </div>
  );
}

function FormularioSaida({
  pessoa, ocupado, onCancelar, onConfirmar,
}: {
  pessoa: Pessoa;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (dia: string, motivo: string) => void;
}) {
  const [dia, setDia] = useState('');
  const [motivo, setMotivo] = useState('');

  return (
    <div className="space-y-2">
      <input
        type="date" value={dia} disabled={ocupado} className={entrada}
        aria-label={`Data da saída de ${pessoa.nome}`}
        onChange={(e) => setDia(e.target.value)}
      />
      <input
        value={motivo} disabled={ocupado} className={`${entrada} w-full`}
        placeholder="Motivo (opcional)"
        onChange={(e) => setMotivo(e.target.value)}
      />
      <div className="flex gap-2">
        <button type="button" className={botaoPrimario} disabled={ocupado || !dia}
                onClick={() => onConfirmar(dia, motivo)}>
          Confirmar saída
        </button>
        <button type="button" className={botaoSecundario} disabled={ocupado}
                onClick={onCancelar}>
          Cancelar
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        O acesso é encerrado na hora.
      </p>
    </div>
  );
}

/** A foto guardada: ficha cadastral e a cota de cada competência. */
function Registro({ saida }: { saida: Saida }) {
  const ficha = saida.ficha ?? {};
  const cargos = (ficha.cargos ?? []) as { desde: string; cargo: string }[];
  const cota = saida.cota ?? [];

  return (
    <div className="border-t border-slate-100 px-4 py-3 text-sm">
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div><dt className="inline text-slate-500">E-mail: </dt>
          <dd className="inline text-slate-800">{ficha.email ?? '—'}</dd></div>
        <div><dt className="inline text-slate-500">Papel: </dt>
          <dd className="inline text-slate-800">{ficha.papel ?? '—'}</dd></div>
        <div><dt className="inline text-slate-500">Entrada: </dt>
          <dd className="inline text-slate-800">{data(ficha.admitido_em)}</dd></div>
        <div><dt className="inline text-slate-500">Nome no Hub: </dt>
          <dd className="inline text-slate-800">{ficha.nome_hub ?? ficha.nome_huggy ?? '—'}</dd></div>
        <div className="sm:col-span-2"><dt className="inline text-slate-500">Cargos: </dt>
          <dd className="inline text-slate-800">
            {cargos.length
              ? cargos.map((c) => `${c.cargo} desde ${competencia(c.desde)}`).join(' · ')
              : '—'}
          </dd></div>
      </dl>

      {cota.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="pb-1 pr-2 font-semibold">Competência</th>
              <th className="px-2 pb-1 font-semibold">Cargo</th>
              <th className="px-2 pb-1 text-right font-semibold">Pontos</th>
              <th className="px-2 pb-1 text-right font-semibold">Meta</th>
              <th className="pb-1 pl-2 text-right font-semibold">Atingimento</th>
            </tr>
          </thead>
          <tbody>
            {cota.map((c) => (
              <tr key={c.competencia} className="border-t border-slate-100">
                <td className="py-1 pr-2 text-slate-800">{competencia(c.competencia)}</td>
                <td className="px-2 py-1 text-slate-600">{c.cargo ?? '—'}</td>
                <td className="px-2 py-1 text-right tabular-nums text-slate-800">{numero(c.resultado)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-slate-500">{numero(c.meta)}</td>
                <td className="py-1 pl-2 text-right tabular-nums text-slate-800">
                  {c.atingimento == null ? '—'
                    : `${(Number(c.atingimento) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-2 text-[11px] text-slate-500">
        Guardado em {new Date(saida.registrado_em).toLocaleString('pt-BR')}.
      </p>
    </div>
  );
}
