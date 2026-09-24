'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td } from '@/componentes/ui';
import {
  REGRA_MEDIA, REGRA_META,
  type Cargo, type PesoCargo, type ReferenciaCargo, type RegraCota,
} from '@/lib/tipos';

/**
 * O cargo de base é avaliado em todas as regras e serve de referência para os
 * outros. Por decisão do gestor, "recebe por média" não se aplica a ele.
 */
const CARGO_BASE = 'Atendente Júnior';

const entrada = `rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                 focus:border-marca-600 disabled:bg-slate-50`;
const entradaNumero = `${entrada} w-24 text-right tabular-nums`;
const botaoPrimario = `rounded-lg bg-marca-600 px-3 py-1.5 text-xs font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40`;
const botaoSecundario = `rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                         font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40`;

/**
 * Cargos da cota: quanto vale cada regra em cada cargo, a meta e se o cargo
 * recebe pela média de outros cargos.
 *
 * Tudo é linha no banco (`pesos_por_cargo`, `cargos_referencia`), então mudar
 * um peso muda o extrato de todos daquele cargo — inclusive meses ainda não
 * fechados. Meses fechados guardam o valor da época.
 */
export default function PainelCargos({
  cargos, regras, pesos, referencias,
}: {
  cargos: Cargo[];
  regras: RegraCota[];
  pesos: PesoCargo[];
  referencias: ReferenciaCargo[];
}) {
  const router = useRouter();
  const [selecionado, setSelecionado] = useState<number | null>(cargos[0]?.id ?? null);
  const [novo, setNovo] = useState({ nome: '', copiarDe: String(cargos[0]?.id ?? '') });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cargo = cargos.find((c) => c.id === selecionado) ?? null;

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const nome = novo.nome.trim();
    if (!nome) return;

    setOcupado(true); setErro(null);
    const db = criarClienteNavegador();

    const { data, error } = await db.from('cargos')
      .insert({ nome, ordem: Math.max(0, ...cargos.map((c) => c.ordem)) + 1 })
      .select('id').single();

    if (error || !data) {
      setOcupado(false);
      setErro(/duplicate|unique/i.test(error?.message ?? '')
        ? `Já existe um cargo chamado "${nome}".` : error?.message ?? 'Falha ao criar.');
      return;
    }

    // O cargo novo nasce com os pesos do cargo escolhido, para não começar do
    // zero. A média não é copiada: é uma escolha própria de cada cargo.
    const origem = Number(novo.copiarDe);
    const copia = pesos
      .filter((p) => p.cargo_id === origem && p.regra !== REGRA_MEDIA)
      .map((p) => ({ cargo_id: data.id, regra: p.regra, peso: p.peso, ativo: p.ativo }));
    if (copia.length) {
      const { error: e2 } = await db.from('pesos_por_cargo').insert(copia);
      if (e2) { setOcupado(false); setErro(e2.message); return; }
    }

    setOcupado(false);
    setNovo((n) => ({ ...n, nome: '' }));
    setSelecionado(data.id);
    router.refresh();
  }

  return (
    <Cartao titulo={`Cargos (${cargos.length})`}>
      <div className="mb-4 flex flex-wrap gap-2">
        {cargos.map((c) => (
          <button
            key={c.id} type="button" onClick={() => setSelecionado(c.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
              c.id === selecionado
                ? 'bg-marca-50 text-marca-700 ring-marca-600/30 dark:text-marca-400'
                : 'text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
          >
            {c.nome}
          </button>
        ))}
      </div>

      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}

      {cargo && (
        // `key` descarta o rascunho ao trocar de cargo.
        <EditorDoCargo
          key={cargo.id}
          cargo={cargo}
          cargos={cargos}
          regras={regras}
          pesos={pesos.filter((p) => p.cargo_id === cargo.id)}
          referencias={referencias.filter((r) => r.cargo_id === cargo.id)}
        />
      )}

      <form onSubmit={criar} className="mt-5 flex flex-wrap items-end gap-2
                                         border-t border-slate-100 pt-4">
        <label className="min-w-56 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Novo cargo</span>
          <input
            value={novo.nome} disabled={ocupado} className={`${entrada} w-full`}
            placeholder="Ex.: Analista Sênior"
            onChange={(e) => setNovo((n) => ({ ...n, nome: e.target.value }))}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Copiar pesos de</span>
          <select
            value={novo.copiarDe} disabled={ocupado} className={entrada}
            onChange={(e) => setNovo((n) => ({ ...n, copiarDe: e.target.value }))}
          >
            {cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <button type="submit" disabled={!novo.nome.trim() || ocupado} className={botaoSecundario}>
          Criar cargo
        </button>
      </form>
    </Cartao>
  );
}

type Rascunho = Record<string, { peso: string; ativo: boolean }>;

function EditorDoCargo({
  cargo, cargos, regras, pesos, referencias,
}: {
  cargo: Cargo;
  cargos: Cargo[];
  regras: RegraCota[];
  pesos: PesoCargo[];
  referencias: ReferenciaCargo[];
}) {
  const router = useRouter();
  const pesoDe = new Map(pesos.map((p) => [p.regra, p]));

  // Regras que pontuam: tudo menos a meta e a média, que têm campos próprios.
  const pontuaveis = regras.filter((r) => r.ativo && r.chave !== REGRA_META && r.chave !== REGRA_MEDIA);

  const inicial = (): Rascunho => Object.fromEntries(pontuaveis.map((r) => {
    const p = pesoDe.get(r.chave);
    return [r.chave, { peso: String(p?.peso ?? r.peso), ativo: p?.ativo ?? false }];
  }));

  const media = pesoDe.get(REGRA_MEDIA);
  const [nome, setNome] = useState(cargo.nome);
  const [rascunho, setRascunho] = useState<Rascunho>(inicial);
  const [meta, setMeta] = useState(String(pesoDe.get(REGRA_META)?.peso ?? ''));
  const [recebeMedia, setRecebeMedia] = useState(Boolean(media?.ativo));
  const [multiplicador, setMultiplicador] = useState(String(media?.peso ?? '1'));
  const [compoem, setCompoem] = useState<number[]>(referencias.map((r) => r.referencia_id));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const ehBase = cargo.nome === CARGO_BASE;

  async function salvar() {
    const nomeNovo = nome.trim();
    const metaNum = Number(meta);
    const multNum = Number(multiplicador);
    if (!nomeNovo) { setErro('Informe o nome do cargo.'); return; }
    // O cargo de base é reconhecido pelo nome (ver CARGO_BASE): renomeá-lo
    // faria a tela passar a oferecer "recebe por média" a ele, e o cargo que
    // serve de referência para todos os outros deixaria de ser identificado.
    if (ehBase && nomeNovo !== cargo.nome) {
      setErro(`"${CARGO_BASE}" é o cargo de referência dos demais e não pode ser renomeado aqui.`);
      return;
    }
    if (cargos.some((c) => c.id !== cargo.id
      && c.nome.trim().toLowerCase() === nomeNovo.toLowerCase())) {
      setErro(`Já existe um cargo chamado "${nomeNovo}".`); return;
    }
    if (!Number.isFinite(metaNum) || metaNum <= 0) { setErro('Informe uma meta maior que zero.'); return; }
    if (recebeMedia && (!Number.isFinite(multNum) || multNum <= 0)) {
      setErro('Informe um multiplicador maior que zero.'); return;
    }
    if (recebeMedia && !compoem.length) {
      setErro('Escolha ao menos um cargo para compor a média.'); return;
    }
    for (const [chave, d] of Object.entries(rascunho)) {
      if (d.ativo && !Number.isFinite(Number(d.peso))) {
        setErro(`Peso inválido em "${regras.find((r) => r.chave === chave)?.rotulo}".`); return;
      }
    }

    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const agora = new Date().toISOString();

    if (nomeNovo !== cargo.nome) {
      const { error } = await db.from('cargos').update({ nome: nomeNovo }).eq('id', cargo.id);
      if (error) {
        setOcupado(false);
        setErro(/duplicate|unique/i.test(error.message)
          ? `Já existe um cargo chamado "${nomeNovo}".` : error.message);
        return;
      }
    }

    const linhas = [
      ...Object.entries(rascunho).map(([regra, d]) => ({
        cargo_id: cargo.id, regra, peso: Number(d.peso) || 0, ativo: d.ativo, atualizado_em: agora,
      })),
      { cargo_id: cargo.id, regra: REGRA_META, peso: metaNum, ativo: true, atualizado_em: agora },
    ];
    if (!ehBase) {
      linhas.push({
        cargo_id: cargo.id, regra: REGRA_MEDIA,
        peso: recebeMedia ? multNum : Number(media?.peso ?? 1),
        ativo: recebeMedia, atualizado_em: agora,
      });
    }

    const { error } = await db.from('pesos_por_cargo')
      .upsert(linhas, { onConflict: 'cargo_id,regra' });
    if (error) { setOcupado(false); setErro(error.message); return; }

    if (!ehBase) {
      // Regrava a composição inteira: é pequena e evita calcular diferença.
      const { error: e1 } = await db.from('cargos_referencia').delete().eq('cargo_id', cargo.id);
      if (e1) { setOcupado(false); setErro(e1.message); return; }

      if (recebeMedia) {
        const { error: e2 } = await db.from('cargos_referencia')
          .insert(compoem.map((id) => ({ cargo_id: cargo.id, referencia_id: id })));
        if (e2) {
          setOcupado(false);
          setErro(/circular/i.test(e2.message)
            ? 'Configuração circular: um dos cargos escolhidos já recebe a média deste. '
              + 'A composição anterior foi removida — ajuste e salve de novo.'
            : e2.message);
          router.refresh();
          return;
        }
      }
    }

    setOcupado(false);
    setAviso(`${nomeNovo} salvo. Meses já fechados não mudam.`);
    router.refresh();
  }

  const alternarCompoe = (id: number) =>
    setCompoem((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  return (
    <div className="space-y-5">
      {erro && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}
      {aviso && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800
                      ring-1 ring-emerald-600/20">{aviso}</p>
      )}

      <div className="flex flex-wrap items-end gap-6">
        <label className="min-w-56">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nome do cargo</span>
          <input
            value={nome} disabled={ocupado || ehBase} className={`${entrada} w-full`}
            title={ehBase ? `"${CARGO_BASE}" é o cargo de referência e não pode ser renomeado.` : undefined}
            onChange={(e) => setNome(e.target.value)}
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Meta do mês (pontos)</span>
          <input
            type="number" min="1" step="1" value={meta} disabled={ocupado}
            onChange={(e) => setMeta(e.target.value)} className={entradaNumero}
          />
        </label>

        {!ehBase && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox" checked={recebeMedia} disabled={ocupado}
              onChange={(e) => setRecebeMedia(e.target.checked)}
            />
            Recebe por média
          </label>
        )}

        <button type="button" onClick={salvar} disabled={ocupado} className={`${botaoPrimario} ml-auto`}>
          {ocupado ? 'Salvando…' : `Salvar ${cargo.nome}`}
        </button>
      </div>

      {!ehBase && recebeMedia && (
        <div className="rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              Multiplicador
              <input
                type="number" min="0.01" step="0.01" value={multiplicador} disabled={ocupado}
                onChange={(e) => setMultiplicador(e.target.value)} className={entradaNumero}
              />
              {Number(multiplicador) > 0 && (
                <span className="text-xs text-slate-500">
                  ({Number(multiplicador) >= 1 ? '+' : ''}
                  {Math.round((Number(multiplicador) - 1) * 100)}% sobre a média)
                </span>
              )}
            </label>
            <span className="text-sm text-slate-700">Compõem a média:</span>
            {cargos.filter((c) => c.id !== cargo.id).map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox" checked={compoem.includes(c.id)} disabled={ocupado}
                  onChange={() => alternarCompoe(c.id)}
                />
                {c.nome}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Média do resultado mensal de quem está nos cargos marcados e pontuou no mês,
            multiplicada pelo valor acima. As regras abaixo continuam somando por cima.
          </p>
        </div>
      )}

      <Tabela>
        <thead>
          <tr>
            <Th className="w-16">Pontua</Th>
            <Th>Regra</Th>
            <Th className="w-28">Tipo</Th>
            <Th className="w-32 text-right">Peso</Th>
          </tr>
        </thead>
        <tbody>
          {pontuaveis.map((r) => {
            const d = rascunho[r.chave];
            return (
              <tr key={r.chave} className={d.ativo ? '' : 'opacity-60'}>
                <Td>
                  <input
                    type="checkbox" checked={d.ativo} disabled={ocupado}
                    aria-label={`${r.rotulo} pontua neste cargo`}
                    onChange={(e) => setRascunho((s) => ({
                      ...s, [r.chave]: { ...s[r.chave], ativo: e.target.checked } }))}
                  />
                </Td>
                <Td>{r.rotulo}</Td>
                <Td className="text-xs text-slate-500">
                  {r.valor_manual ? 'valor digitado' : r.manual ? 'lançamento' : 'automático'}
                </Td>
                <Td className="text-right">
                  <input
                    type="number" step="0.01" value={d.peso} disabled={ocupado || !d.ativo}
                    onChange={(e) => setRascunho((s) => ({
                      ...s, [r.chave]: { ...s[r.chave], peso: e.target.value } }))}
                    className={entradaNumero}
                  />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Tabela>
    </div>
  );
}
