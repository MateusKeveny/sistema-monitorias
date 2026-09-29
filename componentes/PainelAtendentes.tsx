'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mesRotulo } from '@/lib/formatar';
import { NOMES_PAPEL, type Cargo, type CargoDaPessoa, type Pessoa, type Saida } from '@/lib/tipos';

const entrada = `rounded-lg border border-slate-300 bg-superficie px-2.5 py-1.5 text-sm outline-none
                 focus:border-marca-600 disabled:opacity-50`;
const botaoPrimario = `rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40`;
const botaoSecundario = `rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                         font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40`;

const data = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const numero = (v: unknown) =>
  Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const competenciaCurta = (iso: string) => {
  const [ano, mes] = iso.split('-');
  return `${mes}/${ano}`;
};
const curto = (nome: string) => nome.replace(/^Atendente\s+/, '');

type Filtro = 'operacao' | 'atencao' | 'recentes' | 'desligados';
type Recorte = 'todos' | 'operadores' | 'gestao';

/**
 * Atendentes (1.20.0): tudo de uma pessoa num lugar só.
 *
 * Antes o cargo e o Nome no Hub ficavam na Configuração, a exibição na tela
 * inicial em outra aba e a saída aqui. Agora a lista mostra o essencial e o
 * clique abre a ficha ao lado: entrada, cargo com histórico, Nome no Hub, o
 * que aparece na tela inicial e a saída.
 *
 * As duas datas existem por causa do cálculo: quem entrou ou saiu no meio da
 * competência fica de fora da média do cargo — o extrato dela continua
 * intacto, ela só não entra na conta dos outros. Registrar a saída guarda a
 * foto do que a pessoa produziu, grava a data e corta o acesso aos dois
 * sistemas.
 */
export default function PainelAtendentes({
  pessoas, saidas, cargos, historico, competencia, inicioDoCicloAnterior,
}: {
  pessoas: Pessoa[];
  saidas: Saida[];
  cargos: Cargo[];
  historico: CargoDaPessoa[];
  /** Competência corrente ('2026-10-01'): o "cargo em outubro". */
  competencia: string;
  /** Início do ciclo anterior: entradas e saídas a partir daí são "recentes". */
  inicioDoCicloAnterior: string;
}) {
  const nomeCargo = new Map(cargos.map((c) => [c.id, c.nome]));
  const linhasDe = (id: string) => historico.filter((h) => h.pessoa_id === id)
    .sort((a, b) => b.desde.localeCompare(a.desde));
  const vigente = (id: string) => linhasDe(id).find((h) => h.desde <= competencia) ?? null;

  /** O que atrapalha o cálculo da pessoa, em frases curtas. */
  const pendencias = (p: Pessoa) => {
    if (p.desligado_em) return [];
    const l: string[] = [];
    const cargo = vigente(p.id);
    if (!cargo) l.push('sem cargo — não recebe cota');
    const linhas = linhasDe(p.id);
    if (linhas.some((h, i) => i > 0 && h.cargo_id === linhas[i - 1].cargo_id)) l.push('mesmo cargo repetido no histórico');
    if (p.papel === 'operador' && cargo && nomeCargo.get(cargo.cargo_id)?.startsWith('Atendente') && !p.nome_hub) {
      l.push('sem Nome no Hub — a importação não acha as avaliações');
    }
    return l;
  };

  const naOperacao = pessoas.filter((p) => !p.desligado_em);
  const desligados = pessoas.filter((p) => p.desligado_em);
  const atencao = naOperacao.filter((p) => pendencias(p).length);
  const recentes = pessoas.filter((p) => (p.desligado_em && p.desligado_em >= inicioDoCicloAnterior)
    || (p.admitido_em && p.admitido_em >= inicioDoCicloAnterior));

  const [filtro, setFiltro] = useState<Filtro>('operacao');
  const [recorte, setRecorte] = useState<Recorte>('todos');
  const [selecionada, setSelecionada] = useState<string | null>(naOperacao[0]?.id ?? null);

  const base = filtro === 'atencao' ? atencao : filtro === 'recentes' ? recentes
    : filtro === 'desligados' ? desligados : naOperacao;
  const lista = base.filter((p) => recorte === 'todos'
    || (recorte === 'operadores' ? p.papel === 'operador' : p.papel !== 'operador'));
  const pessoa = pessoas.find((p) => p.id === selecionada) ?? null;

  const porCargo = new Map<string, number>();
  for (const p of naOperacao) {
    const c = vigente(p.id);
    const nome = c ? curto(nomeCargo.get(c.cargo_id) ?? '') : 'sem cargo';
    porCargo.set(nome, (porCargo.get(nome) ?? 0) + 1);
  }

  const Cartao = ({ chave, titulo, valor, detalhe, alerta }: {
    chave: Filtro; titulo: string; valor: string; detalhe: React.ReactNode; alerta?: boolean;
  }) => (
    <button type="button" aria-pressed={filtro === chave} onClick={() => setFiltro(chave)}
            className={`rounded-2xl border-2 px-5 py-4 text-left shadow-sm transition-colors ${
              alerta ? 'bg-amber-50' : 'bg-superficie'} ${
              filtro === chave ? 'border-marca-600' : 'border-transparent hover:border-slate-200'}`}>
      <p className="text-[13px] text-slate-500">{titulo}</p>
      <p className={`text-2xl font-semibold tabular-nums ${alerta ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900'}`}>{valor}</p>
      <div className="mt-1 text-xs leading-relaxed text-slate-600">{detalhe}</div>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Cartao chave="operacao" titulo="Na operação" valor={`${naOperacao.length} pessoas`}
                detalhe={[...porCargo].map(([c, q]) => `${q} ${c}`).join(' · ')} />
        <Cartao chave="atencao" titulo="Precisa de atenção" valor={String(atencao.length)} alerta={atencao.length > 0}
                detalhe={atencao.length
                  ? atencao.map((p) => <span key={p.id} className="block truncate">{p.nome.split(' ')[0]}: {pendencias(p)[0]}</span>)
                  : 'nada pendente'} />
        <Cartao chave="recentes" titulo="Entradas e saídas recentes" valor={String(recentes.length)}
                detalhe={recentes.length
                  ? recentes.map((p) => (
                    <span key={p.id} className="block truncate">
                      {p.nome.split(' ')[0]} {p.desligado_em ? `saiu em ${data(p.desligado_em)}` : `entrou em ${data(p.admitido_em)}`}
                    </span>))
                  : 'desde o ciclo anterior, ninguém entrou nem saiu'} />
        <Cartao chave="desligados" titulo="Desligados" valor={String(desligados.length)}
                detalhe="registro guardado · dá para voltar para a operação" />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,1fr)]">
        <section className="rounded-2xl bg-superficie px-6 py-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-800">Pessoas</h2>
              <p className="text-sm text-slate-500">Clique numa pessoa para abrir a ficha.</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([['todos', 'Todos'], ['operadores', 'Operadores'], ['gestao', 'Gestão e qualidade']] as const).map(([k, r]) => (
                <button key={k} type="button" aria-pressed={recorte === k} onClick={() => setRecorte(k)}
                        className={`rounded-full border px-3 py-0.5 text-xs ${recorte === k
                          ? 'border-marca-600 bg-marca-600/10 text-marca-700 dark:text-marca-400'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {lista.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Ninguém neste recorte.</p>
          ) : (
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="border-b border-slate-200 py-2 pl-6 pr-2 font-medium">Pessoa</th>
                    <th className="border-b border-slate-200 px-2 py-2 font-medium">Cargo em {mesRotulo(competencia).split('/')[0].toLowerCase()}</th>
                    <th className="border-b border-slate-200 px-2 py-2 font-medium">Nome no Hub</th>
                    <th className="border-b border-slate-200 px-2 py-2 text-center font-medium" title="Aparece nas listas · Entra nas médias">
                      Aparece · Média
                    </th>
                    <th className="border-b border-slate-200 py-2 pl-2 pr-6 text-center font-medium">Acesso</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((p) => {
                    const c = vigente(p.id);
                    const pend = pendencias(p);
                    const ativa = p.id === selecionada;
                    return (
                      <tr key={p.id} onClick={() => setSelecionada(p.id)} aria-selected={ativa}
                          className={`cursor-pointer ${ativa ? 'bg-marca-600/8' : 'hover:bg-slate-50'} ${p.desligado_em ? 'text-slate-400' : ''}`}>
                        <td className="border-b border-slate-100 py-2.5 pl-6 pr-2">
                          <span className="font-semibold text-slate-800">{p.nome}</span>
                          <span className="block text-xs text-slate-500">
                            {NOMES_PAPEL[p.papel]}{p.desligado_em ? ` · saiu em ${data(p.desligado_em)}` : ''}
                          </span>
                        </td>
                        <td className="border-b border-slate-100 px-2 py-2.5">
                          {c ? <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{curto(nomeCargo.get(c.cargo_id) ?? '')}</span>
                            : <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">sem cargo</span>}
                        </td>
                        <td className="border-b border-slate-100 px-2 py-2.5 text-slate-600">
                          {p.nome_hub ?? (pend.some((x) => x.startsWith('sem Nome no Hub'))
                            ? <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">sem vínculo</span>
                            : <span className="text-slate-400">—</span>)}
                        </td>
                        <td className="border-b border-slate-100 px-2 py-2.5 text-center text-xs">
                          <Bolinha ligada={p.exibir_no_painel ?? true} /> <Bolinha ligada={p.conta_nas_medias ?? true} />
                        </td>
                        <td className="border-b border-slate-100 py-2.5 pl-2 pr-6 text-center">
                          {p.ativo
                            ? <span className="rounded-md bg-marca-600/15 px-2 py-0.5 text-xs font-semibold text-marca-700 dark:text-marca-400">tem login</span>
                            : <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">sem login</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            A <strong>entrada</strong> e a saída decidem quem compõe a média do cargo: quem trabalhou a
            competência pela metade fica de fora dela, sem perder o próprio extrato.
          </p>
        </section>

        {pessoa ? (
          <Ficha key={pessoa.id} pessoa={pessoa} cargos={cargos} linhas={linhasDe(pessoa.id)}
                 competencia={competencia} pendencias={pendencias(pessoa)}
                 saida={saidas.filter((s) => s.pessoa_id === pessoa.id && !s.revertida_em)
                   .sort((a, b) => b.data.localeCompare(a.data))[0]} />
        ) : (
          <section className="rounded-2xl bg-superficie px-6 py-10 text-center text-sm text-slate-500 shadow-sm">
            Escolha uma pessoa na lista.
          </section>
        )}
      </div>
    </div>
  );
}

const Bolinha = ({ ligada }: { ligada: boolean }) => (
  <span aria-label={ligada ? 'sim' : 'não'}
        className={`inline-block h-2.5 w-2.5 rounded-full align-middle ${ligada ? 'bg-marca-600' : 'border border-slate-300'}`} />
);

/** Liga/desliga com a aparência de interruptor. */
function Interruptor({ ligado, disabled, onChange, rotulo }: {
  ligado: boolean; disabled?: boolean; onChange: (v: boolean) => void; rotulo: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} disabled={disabled}
            onClick={() => onChange(!ligado)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${ligado ? 'bg-marca-600' : 'bg-slate-300'}`}>
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${ligado ? 'translate-x-4' : ''}`} />
    </button>
  );
}

/**
 * Copia para a área de transferência e diz se deu certo.
 *
 * O jeito moderno (`navigator.clipboard`) pode ser bloqueado pelo navegador;
 * aí tenta o antigo, por uma caixa de texto escondida. Só devolve `true` se
 * uma das duas funcionou: dizer "copiada" sem ter copiado faz o gestor perder
 * a senha temporária, que não aparece de novo.
 */
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const caixa = document.createElement('textarea');
      caixa.value = texto;
      caixa.setAttribute('readonly', '');
      caixa.style.position = 'fixed';
      caixa.style.opacity = '0';
      document.body.appendChild(caixa);
      caixa.select();
      const ok = document.execCommand('copy');
      caixa.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Uma parte da ficha. Fora de `Ficha`: definida dentro, seria recriada a
 *  cada tecla e o campo em edição perderia o foco. */
const Secao = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <div className="border-t border-slate-100 py-4 first:border-t-0 first:pt-1">
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{titulo}</h3>
    {children}
  </div>
);

function Ficha({
  pessoa, cargos, linhas, competencia, pendencias, saida,
}: {
  pessoa: Pessoa;
  cargos: Cargo[];
  linhas: CargoDaPessoa[];
  competencia: string;
  pendencias: string[];
  saida: Saida | undefined;
}) {
  const router = useRouter();
  const nomeCargo = new Map(cargos.map((c) => [c.id, c.nome]));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [novoCargo, setNovoCargo] = useState({ cargo: '', mes: competencia.slice(0, 7) });
  const [hub, setHub] = useState(pessoa.nome_hub ?? '');
  const [saidaDia, setSaidaDia] = useState('');
  const [motivo, setMotivo] = useState('');
  const [verRegistro, setVerRegistro] = useState(false);
  // A senha temporária só existe nesta tela, até ser fechada: o banco não a
  // guarda em lugar nenhum além do hash.
  const [senhaTemporaria, setSenhaTemporaria] = useState<string | null>(null);
  const [copiada, setCopiada] = useState<'ok' | 'falhou' | null>(null);

  async function executar(acao: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) {
    setOcupado(true); setErro(null); setAviso(null);
    const { error } = await acao();
    setOcupado(false);
    if (error) { setErro(error.message); return false; }
    if (ok) setAviso(ok);
    router.refresh();
    return true;
  }
  const db = () => criarClienteNavegador();

  return (
    <section className="rounded-2xl bg-superficie px-6 py-5 shadow-sm xl:sticky xl:top-6">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{pessoa.nome}</h2>
          <p className="text-sm text-slate-500">
            {NOMES_PAPEL[pessoa.papel]} · {pessoa.ativo ? 'tem login nos dois sistemas' : 'sem login'}
          </p>
        </div>
        {pessoa.desligado_em
          ? <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">desligado</span>
          : <span className="rounded-md bg-marca-600/15 px-2 py-0.5 text-xs font-semibold text-marca-700 dark:text-marca-400">na operação</span>}
      </div>
      {pendencias.map((x) => (
        <p key={x} className="mb-1 inline-block rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">{x}</p>
      ))}
      {erro && <p className="my-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="my-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

      <Secao titulo="Entrada">
        <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
          Na equipe desde
          <input type="date" defaultValue={pessoa.admitido_em ?? ''} disabled={ocupado} className={entrada}
                 aria-label={`Entrada de ${pessoa.nome}`}
                 onBlur={(e) => {
                   if ((e.target.value || null) !== (pessoa.admitido_em ?? null)) {
                     executar(() => db().from('pessoas').update({ admitido_em: e.target.value || null }).eq('id', pessoa.id));
                   }
                 }} />
        </label>
        <p className="mt-1 text-xs text-slate-500">Em branco: já estava antes do painel e conta em todos os meses.</p>
      </Secao>

      <Secao titulo="Cargo">
        {linhas.length ? (
          <ul className="mb-3 ml-1.5 space-y-1.5 border-l-2 border-slate-200 pl-4 text-sm">
            {linhas.map((h, i) => (
              <li key={h.desde} className="relative flex items-center gap-2">
                <i className={`absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full ${i === 0 ? 'bg-marca-600' : 'bg-slate-300'}`} />
                <span className="text-slate-800">{nomeCargo.get(h.cargo_id)}</span>
                <span className="text-xs text-slate-500">desde {mesRotulo(h.desde)}</span>
                <button type="button" disabled={ocupado}
                        onClick={() => {
                          if (!confirm(`Remover "${nomeCargo.get(h.cargo_id)}" de ${pessoa.nome} a partir de ${mesRotulo(h.desde)}? `
                            + 'Os meses desse período passam a usar o cargo anterior.')) return;
                          executar(() => db().from('cargos_da_pessoa').delete().eq('pessoa_id', h.pessoa_id).eq('desde', h.desde));
                        }}
                        className="ml-auto text-xs text-slate-400 hover:text-rose-700 hover:underline">
                  remover
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="mb-3 text-sm text-slate-500">Sem cargo: não recebe cota.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <select value={novoCargo.cargo} disabled={ocupado} aria-label="Novo cargo"
                  onChange={(e) => setNovoCargo((s) => ({ ...s, cargo: e.target.value }))} className={entrada}>
            <option value="">Novo cargo…</option>
            {cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <span className="text-sm text-slate-500">a partir de</span>
          <input type="month" value={novoCargo.mes} disabled={ocupado} aria-label="Competência inicial"
                 onChange={(e) => setNovoCargo((s) => ({ ...s, mes: e.target.value }))} className={entrada} />
          <button type="button" disabled={ocupado || !novoCargo.cargo || !novoCargo.mes} className={botaoPrimario}
                  onClick={async () => {
                    const ok = await executar(() => db().from('cargos_da_pessoa').upsert(
                      { pessoa_id: pessoa.id, desde: `${novoCargo.mes}-01`, cargo_id: Number(novoCargo.cargo) },
                      { onConflict: 'pessoa_id,desde' },
                    ));
                    if (ok) setNovoCargo((s) => ({ ...s, cargo: '' }));
                  }}>
            Aplicar
          </button>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Uma promoção é um cargo novo a partir de um mês: os anteriores continuam no cargo antigo.
        </p>
      </Secao>

      <Secao titulo="Nome no Hub">
        <div className="flex gap-2">
          <input value={hub} disabled={ocupado} onChange={(e) => setHub(e.target.value)}
                 placeholder="Como aparece no relatório do Hub" aria-label={`Nome de ${pessoa.nome} no Hub`}
                 className={`${entrada} min-w-0 flex-1`} />
          <button type="button" disabled={ocupado || hub.trim() === (pessoa.nome_hub ?? '')} className={botaoSecundario}
                  onClick={async () => {
                    setOcupado(true); setErro(null);
                    const { error } = await db().from('pessoas').update({ nome_hub: hub.trim() || null }).eq('id', pessoa.id);
                    setOcupado(false);
                    if (error) { setErro(/duplicate|unique/i.test(error.message) ? 'Esse nome já é de outra pessoa.' : error.message); return; }
                    router.refresh();
                  }}>
            Salvar
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">É por ele que a importação acha a pessoa.</p>
      </Secao>

      <Secao titulo="Tela inicial">
        {([
          ['exibir_no_painel', 'Aparece nas listas', pessoa.exibir_no_painel ?? true],
          ['conta_nas_medias', 'Entra nas médias (C-SAT, TME)', pessoa.conta_nas_medias ?? true],
        ] as const).map(([campo, rotulo, valor]) => (
          <div key={campo} className="flex items-center justify-between gap-3 py-1 text-sm text-slate-600">
            {rotulo}
            <Interruptor ligado={valor} disabled={ocupado} rotulo={rotulo}
                         onChange={(v) => executar(() => db().from('pessoas').update({ [campo]: v }).eq('id', pessoa.id))} />
          </div>
        ))}
        <p className="mt-1 text-xs text-slate-500">Só apresentação: não muda pontuação, média do cargo nem pagamento.</p>
      </Secao>

      <Secao titulo="Diário de bordo">
        <div className="flex items-center justify-between gap-3 py-1 text-sm text-slate-600">
          Registra autorizações sem aprovação
          <Interruptor ligado={pessoa.diario_conclui_direto ?? false} disabled={ocupado} rotulo="Registra autorizações sem aprovação"
                       onChange={(v) => executar(() => db().from('pessoas').update({ diario_conclui_direto: v }).eq('id', pessoa.id))} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Autorização da gestão ou da diretoria registrada por esta pessoa conclui na hora, como a do Pleno e do
          Analista. Gestor, Pleno e Analista já têm isso pelo cargo.
        </p>
      </Secao>

      {pessoa.auth_id && pessoa.ativo && !pessoa.desligado_em && (
        <Secao titulo="Acesso">
          {senhaTemporaria ? (
            <div className="rounded-xl border border-marca-600/40 bg-marca-600/8 px-4 py-3">
              <p className="text-sm text-slate-700">
                Senha temporária de <strong>{pessoa.nome.split(' ')[0]}</strong>. Ela aparece <strong>só agora</strong>:
                passe para a pessoa, que vai trocá-la no primeiro acesso. Não há letras que se confundem
                (sem 0/O nem 1/l/I), então dá para ditar ou digitar lendo da tela.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Um clique seleciona a senha inteira, para copiar à mão. */}
                <code className="select-all rounded-lg bg-superficie px-4 py-2 font-mono text-2xl tracking-[0.2em] text-slate-900 ring-1 ring-slate-200"
                      onClick={(e) => { const s = window.getSelection(); s?.selectAllChildren(e.currentTarget); }}>
                  {senhaTemporaria}
                </code>
                <button type="button" className={botaoSecundario}
                        onClick={async () => setCopiada(await copiar(senhaTemporaria) ? 'ok' : 'falhou')}>
                  {copiada === 'ok' ? 'Copiado, cole para conferir' : 'Copiar'}
                </button>
                <button type="button"
                        onClick={() => {
                          if (!confirm('Já passou a senha para a pessoa (e conferiu que ela está certa)? Depois de fechar, ela não pode ser vista de novo.')) return;
                          setSenhaTemporaria(null); setCopiada(null);
                        }}
                        className="ml-auto text-xs text-slate-500 hover:underline">
                  já passei, fechar
                </button>
              </div>
              {copiada === 'falhou' && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Este navegador bloqueou a cópia. Clique na senha para selecioná-la e use Ctrl+C.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                <span>{pessoa.senha_definida ? 'Senha própria definida' : 'Ainda não trocou a senha provisória'}</span>
                <button type="button" disabled={ocupado} className={botaoSecundario}
                        onClick={async () => {
                          if (!confirm(`Redefinir a senha de ${pessoa.nome}? A senha atual deixa de valer, `
                            + 'as sessões abertas são encerradas e uma senha temporária é gerada para você repassar.')) return;
                          setOcupado(true); setErro(null); setAviso(null);
                          const { data, error } = await db().rpc('redefinir_senha', { p_pessoa: pessoa.id });
                          setOcupado(false);
                          if (error) { setErro(error.message); return; }
                          setSenhaTemporaria(String(data)); setCopiada(null);
                          router.refresh();
                        }}>
                  Redefinir senha
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Para quem esqueceu a senha: gera uma senha temporária, encerra as sessões abertas e
                obriga a troca no próximo acesso.
              </p>
            </>
          )}
        </Secao>
      )}

      <Secao titulo={pessoa.desligado_em ? 'Saída' : 'Saída da operação'}>
        {pessoa.desligado_em ? (
          <>
            <p className="text-sm text-slate-600">
              Saiu em {data(pessoa.desligado_em)}{saida?.motivo ? ` · ${saida.motivo}` : ''}
              {saida?.registrado_por_nome ? ` · registrado por ${saida.registrado_por_nome}` : ''}.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {saida && (
                <button type="button" className={botaoSecundario} onClick={() => setVerRegistro((v) => !v)}>
                  {verRegistro ? 'Fechar registro' : 'Ver registro'}
                </button>
              )}
              <button type="button" className={botaoSecundario} disabled={ocupado}
                      onClick={() => executar(() => db().rpc('reverter_saida', { p_pessoa: pessoa.id }),
                        `${pessoa.nome} voltou para a operação, com acesso liberado.`)}>
                Voltar para a operação
              </button>
            </div>
            {verRegistro && saida && <Registro saida={saida} />}
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <input type="date" value={saidaDia} disabled={ocupado} onChange={(e) => setSaidaDia(e.target.value)}
                     aria-label={`Data da saída de ${pessoa.nome}`} className={entrada} />
              <input value={motivo} disabled={ocupado} onChange={(e) => setMotivo(e.target.value)}
                     placeholder="Motivo (opcional)" className={`${entrada} min-w-0 flex-1`} />
              <button type="button" disabled={ocupado || !saidaDia}
                      className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm font-medium text-rose-700
                                 hover:bg-rose-50 disabled:opacity-40 dark:text-rose-300"
                      onClick={() => {
                        if (!confirm(`Registrar a saída de ${pessoa.nome} em ${data(saidaDia)}? O acesso aos dois sistemas é encerrado na hora.`)) return;
                        executar(() => db().rpc('registrar_saida', { p_pessoa: pessoa.id, p_data: saidaDia, p_motivo: motivo || null }),
                          `Saída de ${pessoa.nome} registrada em ${data(saidaDia)}. O acesso foi encerrado e o histórico ficou guardado.`);
                      }}>
                Registrar saída
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Encerra o acesso aos dois sistemas na hora e guarda a foto do que a pessoa produziu.
            </p>
          </>
        )}
      </Secao>
    </section>
  );
}

/** A foto guardada: ficha cadastral e a cota de cada competência. */
function Registro({ saida }: { saida: Saida }) {
  const ficha = saida.ficha ?? {};
  const cargos = (ficha.cargos ?? []) as { desde: string; cargo: string }[];
  const cota = saida.cota ?? [];

  return (
    <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm">
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div><dt className="inline text-slate-500">E-mail: </dt><dd className="inline text-slate-800">{ficha.email ?? '—'}</dd></div>
        <div><dt className="inline text-slate-500">Papel: </dt><dd className="inline text-slate-800">{ficha.papel ?? '—'}</dd></div>
        <div><dt className="inline text-slate-500">Entrada: </dt><dd className="inline text-slate-800">{data(ficha.admitido_em)}</dd></div>
        <div><dt className="inline text-slate-500">Nome no Hub: </dt><dd className="inline text-slate-800">{ficha.nome_hub ?? ficha.nome_huggy ?? '—'}</dd></div>
        <div className="sm:col-span-2"><dt className="inline text-slate-500">Cargos: </dt>
          <dd className="inline text-slate-800">
            {cargos.length ? cargos.map((c) => `${c.cargo} desde ${competenciaCurta(c.desde)}`).join(' · ') : '—'}
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
              <tr key={c.competencia} className="border-t border-slate-200">
                <td className="py-1 pr-2 text-slate-800">{competenciaCurta(c.competencia)}</td>
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
      <p className="mt-2 text-[11px] text-slate-500">Guardado em {new Date(saida.registrado_em).toLocaleString('pt-BR')}.</p>
    </div>
  );
}
