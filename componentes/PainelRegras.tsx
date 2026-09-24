'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td } from '@/componentes/ui';
import type { RegraCota } from '@/lib/tipos';

const entrada = `rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                 focus:border-marca-600 disabled:bg-slate-50`;
const entradaNumero = `${entrada} w-20 text-right tabular-nums`;
const botaoPrimario = `rounded-lg bg-marca-600 px-3 py-1.5 text-xs font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40`;

/**
 * Em que unidade a faixa da métrica é mostrada.
 *
 * No banco, TME é segundo e C-SAT/monitoria é fração (0,95). Ninguém configura
 * "900 segundos" nem "0,95": o gestor pensa em 15 minutos e 95%. A conversão
 * fica aqui, na tela, e o banco continua guardando o que as visões esperam.
 */
type Unidade = 'minutos' | 'percentual' | 'nota' | 'nenhuma';

function unidadeDa(grupo: string): Unidade {
  if (grupo === 'tme' || grupo === 'tme_diretores') return 'minutos';
  if (grupo === 'csat' || grupo === 'monitoria') return 'percentual';
  if (grupo === 'nota') return 'nota';
  return 'nenhuma';
}

const SUFIXO: Record<Unidade, string> = {
  minutos: 'min', percentual: '%', nota: '', nenhuma: '',
};

/** Banco para a tela. */
function paraTela(valor: number | null, unidade: Unidade): string {
  if (valor === null || valor === undefined) return '';
  if (unidade === 'minutos') return String(Math.round((valor / 60) * 100) / 100);
  if (unidade === 'percentual') return String(Math.round(valor * 10000) / 100);
  return String(valor);
}

/** Tela para o banco. Campo vazio é "sem limite", e continua nulo. */
function paraBanco(texto: string, unidade: Unidade): number | null {
  const t = texto.trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) return NaN;
  if (unidade === 'minutos') return Math.round(n * 60);
  if (unidade === 'percentual') return Math.round((n / 100) * 10000) / 10000;
  return n;
}

const NOME_DO_GRUPO: Record<string, string> = {
  atendimento: 'Atendimento',
  tme: 'TME Expansão',
  tme_diretores: 'TME Diretores',
  csat: 'C-SAT',
  nota: 'Notas do C-SAT',
  monitoria: 'Monitoria',
  manual: 'Lançamento manual',
  media: 'Média da equipe',
  config: 'Configuração',
};

/**
 * Chave técnica a partir do nome: é ela que os lançamentos e os pesos por
 * cargo guardam, então não muda depois — renomear a métrica troca só o rótulo.
 */
function chaveDe(rotulo: string): string {
  return rotulo
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

type Linha = { rotulo: string; min: string; max: string; ativo: boolean };
type Rascunho = Record<string, Linha>;
type Alteracao = {
  chave: string;
  rotulo: string;
  mudanca: Record<string, unknown>;
  invalido?: boolean;
  invertido?: boolean;
};

/**
 * Catálogo de métricas: o nome que aparece em toda tela e os limites de cada
 * faixa. O PESO de cada métrica não fica aqui — ele é por cargo, no painel de
 * cargos, porque a mesma métrica vale valores diferentes para Júnior e Pleno.
 *
 * Mudar o nome é cosmético e vale para os meses abertos; os fechados guardam o
 * nome que valia no dia. Mudar a faixa recalcula os meses abertos.
 */
export default function PainelRegras({ regras }: { regras: RegraCota[] }) {
  const router = useRouter();

  /** O que está gravado, no formato da tela. */
  const linhaDe = (r: RegraCota): Linha => {
    const u = unidadeDa(r.grupo);
    return {
      rotulo: r.rotulo,
      min: paraTela(r.faixa_min, u),
      max: paraTela(r.faixa_max, u),
      ativo: r.ativo,
    };
  };

  const inicial = (): Rascunho =>
    Object.fromEntries(regras.map((r) => [r.chave, linhaDe(r)]));

  const [rascunho, setRascunho] = useState<Rascunho>(inicial);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nova, setNova] = useState({ rotulo: '', peso: '', valorManual: false });

  // A métrica recém-criada ainda não está no rascunho: parte do que veio do
  // banco.
  const editar = (r: RegraCota, campo: keyof Linha, valor: string | boolean) =>
    setRascunho((s) => ({ ...s, [r.chave]: { ...(s[r.chave] ?? linhaDe(r)), [campo]: valor } }));

  // Só as métricas realmente mexidas viram `update`. Evita reescrever as 37
  // linhas a cada salvamento.
  function alteradas(): Alteracao[] {
    return regras.flatMap<Alteracao>((r) => {
      const d = rascunho[r.chave] ?? linhaDe(r);
      const u = unidadeDa(r.grupo);
      const mudanca: Record<string, unknown> = {};

      const rotulo = d.rotulo.trim();
      if (rotulo && rotulo !== r.rotulo) mudanca.rotulo = rotulo;
      if (d.ativo !== r.ativo) mudanca.ativo = d.ativo;

      if (u === 'minutos' || u === 'percentual') {
        const min = paraBanco(d.min, u);
        const max = paraBanco(d.max, u);
        if (Number.isNaN(min) || Number.isNaN(max)) {
          return [{ chave: r.chave, rotulo: r.rotulo, mudanca: {}, invalido: true }];
        }
        if (min !== null && max !== null && min >= max) {
          return [{ chave: r.chave, rotulo: r.rotulo, mudanca: {}, invertido: true }];
        }
        if (min !== r.faixa_min) mudanca.faixa_min = min;
        if (max !== r.faixa_max) mudanca.faixa_max = max;
      }

      return Object.keys(mudanca).length
        ? [{ chave: r.chave, rotulo: r.rotulo, mudanca }] : [];
    });
  }

  async function salvar() {
    const vazio = regras.find((r) => !(rascunho[r.chave] ?? linhaDe(r)).rotulo.trim());
    if (vazio) { setErro('Toda métrica precisa de um nome.'); return; }

    const lista = alteradas();

    const invalida = lista.find((l) => l.invalido);
    if (invalida) { setErro(`Valor inválido na faixa de "${invalida.rotulo}".`); return; }
    const invertida = lista.find((l) => l.invertido);
    if (invertida) {
      setErro(`Em "${invertida.rotulo}", o "de" precisa ser menor que o "até".`); return;
    }

    if (!lista.length) { setErro(null); setAviso('Nada mudou.'); return; }

    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();

    for (const item of lista) {
      const { error } = await db.from('regras').update(item.mudanca).eq('chave', item.chave);
      if (error) { setOcupado(false); setErro(`${item.rotulo}: ${error.message}`); return; }
    }

    setOcupado(false);
    setAviso(`${lista.length} ${lista.length === 1 ? 'métrica salva' : 'métricas salvas'}. `
      + 'Meses já fechados não mudam.');
    router.refresh();
  }

  /**
   * Métrica nova nasce sempre de lançamento manual: as automáticas saem de
   * cálculo no banco (volume, C-SAT, TME, monitoria) e não têm como surgir de
   * um cadastro de tela.
   */
  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const rotulo = nova.rotulo.trim();
    if (!rotulo) return;

    const chave = chaveDe(rotulo);
    if (!chave) { setErro('Dê um nome com letras ou números.'); return; }
    if (regras.some((r) => r.chave === chave)) {
      setErro(`Já existe uma métrica com o nome "${rotulo}".`); return;
    }
    const peso = nova.valorManual ? 0 : Number(nova.peso.replace(',', '.'));
    if (!nova.valorManual && (!nova.peso.trim() || !Number.isFinite(peso))) {
      setErro('Informe o peso sugerido.'); return;
    }

    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();

    const { error } = await db.from('regras').insert({
      chave,
      grupo: 'manual',
      rotulo,
      peso,
      faixa_min: null,
      faixa_max: null,
      ordem: Math.max(0, ...regras.map((r) => r.ordem)) + 1,
      manual: true,
      valor_manual: nova.valorManual,
      ativo: true,
    });

    if (error) {
      setOcupado(false);
      setErro(/duplicate|unique/i.test(error.message)
        ? `Já existe uma métrica com o nome "${rotulo}".` : error.message);
      return;
    }

    setOcupado(false);
    setNova({ rotulo: '', peso: '', valorManual: false });
    setAviso(`"${rotulo}" criada. Agora marque em quais cargos ela pontua, `
      + 'no painel de cargos acima — sem peso no cargo, ela não aparece nos lançamentos.');
    router.refresh();
  }

  let grupoAnterior = '';

  return (
    <Cartao
      titulo={`Métricas (${regras.length})`}
      acao={
        <button type="button" onClick={salvar} disabled={ocupado} className={botaoPrimario}>
          {ocupado ? 'Salvando…' : 'Salvar métricas'}
        </button>
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        O nome de cada métrica e os limites das faixas. O <strong>peso</strong> é por cargo,
        no painel acima — a mesma métrica vale valores diferentes em cada cargo.
      </p>

      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}
      {aviso && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800
                      ring-1 ring-emerald-600/20">{aviso}</p>
      )}

      <Tabela>
        <thead>
          <tr>
            <Th className="w-16">Ativa</Th>
            <Th>Nome</Th>
            <Th className="w-32">Origem</Th>
            <Th className="w-32 text-right">Faixa de</Th>
            <Th className="w-32 text-right">até</Th>
          </tr>
        </thead>
        <tbody>
          {regras.map((r) => {
            const d = rascunho[r.chave] ?? linhaDe(r);
            const u = unidadeDa(r.grupo);
            const novoGrupo = r.grupo !== grupoAnterior;
            grupoAnterior = r.grupo;

            return (
              <Fragment key={r.chave}>
                {novoGrupo && (
                  <tr>
                    <Td colSpan={5} className="bg-slate-50 text-xs font-semibold
                                               uppercase tracking-wide text-slate-500">
                      {NOME_DO_GRUPO[r.grupo] ?? r.grupo}
                    </Td>
                  </tr>
                )}
                <tr className={d.ativo ? '' : 'opacity-60'}>
                  <Td>
                    <input
                      type="checkbox" checked={d.ativo} disabled={ocupado}
                      aria-label={`${r.rotulo} está ativa`}
                      onChange={(e) => editar(r, 'ativo', e.target.checked)}
                    />
                  </Td>
                  <Td>
                    <input
                      value={d.rotulo} disabled={ocupado} className={`${entrada} w-full min-w-56`}
                      aria-label={`Nome de ${r.rotulo}`}
                      onChange={(e) => editar(r, 'rotulo', e.target.value)}
                    />
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {r.valor_manual ? 'valor digitado' : r.manual ? 'lançamento' : 'automático'}
                  </Td>
                  {u === 'minutos' || u === 'percentual' ? (
                    <>
                      <Td className="text-right">
                        <input
                          value={d.min} disabled={ocupado} inputMode="decimal"
                          placeholder="—" className={entradaNumero}
                          aria-label={`Início da faixa de ${r.rotulo}`}
                          onChange={(e) => editar(r, 'min', e.target.value)}
                        />
                        <span className="ml-1 text-xs text-slate-500">{SUFIXO[u]}</span>
                      </Td>
                      <Td className="text-right">
                        <input
                          value={d.max} disabled={ocupado} inputMode="decimal"
                          placeholder="—" className={entradaNumero}
                          aria-label={`Fim da faixa de ${r.rotulo}`}
                          onChange={(e) => editar(r, 'max', e.target.value)}
                        />
                        <span className="ml-1 text-xs text-slate-500">{SUFIXO[u]}</span>
                      </Td>
                    </>
                  ) : (
                    <Td colSpan={2} className="text-right text-xs text-slate-400">
                      {u === 'nota' ? `nota ${r.faixa_min}` : 'sem faixa'}
                    </Td>
                  )}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </Tabela>

      <p className="mt-4 text-xs text-slate-500">
        Faixa vazia é “sem limite”. O “de” conta a partir do valor e o “até” conta até
        antes dele: 0–15 min e 15–30 min não se sobrepõem. Desmarcar “Ativa” tira a
        métrica da conta dos meses ainda abertos.
      </p>

      <form onSubmit={criar} className="mt-5 flex flex-wrap items-end gap-3
                                        border-t border-slate-100 pt-4">
        <label className="min-w-56 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nova métrica</span>
          <input
            value={nova.rotulo} disabled={ocupado} className={`${entrada} w-full`}
            placeholder="Ex.: Atendimento presencial"
            onChange={(e) => setNova((n) => ({ ...n, rotulo: e.target.value }))}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Peso sugerido</span>
          <input
            value={nova.peso} disabled={ocupado || nova.valorManual} inputMode="decimal"
            placeholder={nova.valorManual ? '—' : '0'} className={entradaNumero}
            onChange={(e) => setNova((n) => ({ ...n, peso: e.target.value }))}
          />
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-700">
          <input
            type="checkbox" checked={nova.valorManual} disabled={ocupado}
            onChange={(e) => setNova((n) => ({ ...n, valorManual: e.target.checked }))}
          />
          O gestor digita os pontos
        </label>
        <button type="submit" disabled={!nova.rotulo.trim() || ocupado}
                className={`${botaoPrimario} mb-0.5`}>
          Criar métrica
        </button>
      </form>

      <p className="mt-2 text-xs text-slate-500">
        A métrica nova entra por <strong>lançamento manual</strong> — as automáticas
        (volume, C-SAT, TME, monitoria) vêm de cálculo no banco. Depois de criada, marque
        no painel de cargos em quais cargos ela pontua e com que peso; sem isso ela não
        aparece na tela de lançamentos. Marque “o gestor digita os pontos” quando o valor
        não for quantidade × peso, como no Atestado.
      </p>
    </Cartao>
  );
}
