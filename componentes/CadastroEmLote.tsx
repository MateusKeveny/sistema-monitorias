'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro, Tabela, Td, Th } from '@/componentes/ui';
import { dataDoExcel, lerPlanilha, type Linha } from '@/lib/xlsx-navegador';
import { hojeNoBrasil, mesDeCompetencia, mesRotulo } from '@/lib/formatar';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { emailDoLogin } from '@/lib/usuario';
import type { Cargo, PapelUsuario, Pessoa } from '@/lib/tipos';
import type { Setor } from '@/lib/setores';

const normalizar = (v: unknown) => String(v ?? '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** As colunas, pelo cabeçalho (a ordem não importa). */
const COLUNAS = {
  nome: ['nome', 'nome completo'],
  email: ['e-mail', 'email'],
  cargo: ['cargo'],
  setor: ['setor'],
  hub: ['nome no hub', 'hub'],
  entrada: ['entrada', 'admissao', 'na equipe desde', 'data de entrada'],
  papel: ['papel', 'perfil', 'acesso'],
} as const;

const PAPEIS: Record<string, PapelUsuario> = {
  operador: 'operador', atendente: 'operador', qualidade: 'qualidade', monitor: 'qualidade', gestor: 'gestor',
};

type Planejada = {
  linha: number; nome: string; email: string | null; papel: PapelUsuario;
  setor: Setor | null; cargo: Cargo | null; hub: string | null; entrada: string | null;
  problemas: string[];
};
type Resultado = { nome: string; email: string | null; senha: string | null; erro: string | null };

function lerData(v: unknown): string | null {
  if (typeof v === 'number') return v > 36_500 && v < 73_000 ? dataDoExcel(v) : null;
  const t = String(v ?? '').trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/**
 * Cadastro em lote (3.0, etapa 4): uma planilha com várias pessoas de uma vez.
 *
 * Cada linha vira o que o gestor faria à mão na ficha: a pessoa, o setor e o
 * cargo a partir do mês de entrada e, com e-mail, o acesso — pela mesma
 * função do "Criar acesso" (migração 68), que gera a senha temporária. Nada é
 * gravado antes da conferência; linha com problema fica de fora. As senhas
 * aparecem uma vez só, nesta tela.
 */
export default function CadastroEmLote({ pessoas, setores, cargos }: {
  pessoas: Pessoa[]; setores: Setor[]; cargos: Cargo[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [plano, setPlano] = useState<Planejada[] | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado[] | null>(null);
  const [copiado, setCopiado] = useState(false);

  const competencia = mesDeCompetencia(hojeNoBrasil());
  const emails = useMemo(() => new Set(pessoas.map((p) => normalizar(p.email)).filter(Boolean)), [pessoas]);
  const hubs = useMemo(() => new Set(pessoas.flatMap((p) => [p.nome_hub, ...(p.nomes_hub_extras ?? [])])
    .map(normalizar).filter(Boolean)), [pessoas]);

  async function escolher(f: File | undefined) {
    setPlano(null); setErro(null); setResultado(null);
    if (!f) return;
    setArquivo(f.name);
    let abas: Map<string, Linha[]>;
    try { abas = await lerPlanilha(f); } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler a planilha.'); return;
    }
    const [, linhas] = [...abas].find(([, l]) => l.length > 1) ?? ['', []];
    if (!linhas.length) { setErro('A planilha está vazia.'); return; }

    const [cabecalho, ...dados] = linhas;
    const por = new Map(Object.entries(cabecalho).map(([col, v]) => [normalizar(v), col]));
    const col = Object.fromEntries(Object.entries(COLUNAS)
      .map(([k, nomes]) => [k, nomes.map((n) => por.get(n)).find(Boolean)])) as Record<keyof typeof COLUNAS, string | undefined>;
    if (!col.nome) { setErro('Falta a coluna "Nome" no cabeçalho.'); return; }

    const vistosEmail = new Set<string>();
    const vistosHub = new Set<string>();
    const lista: Planejada[] = [];
    dados.forEach((l, i) => {
      const nome = String(l[col.nome!] ?? '').trim();
      if (!nome) return;
      const problemas: string[] = [];
      // E-mail ou nome de usuário ("admin" vira o endereço interno, 3.0).
      const textoEmail = col.email ? String(l[col.email] ?? '').trim() : '';
      const email = textoEmail ? emailDoLogin(textoEmail) : null;
      if (email) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problemas.push('e-mail inválido');
        else if (emails.has(email)) problemas.push('e-mail já é de alguém do cadastro');
        else if (vistosEmail.has(email)) problemas.push('e-mail repetido na planilha');
        vistosEmail.add(email);
      }
      const textoPapel = col.papel ? normalizar(l[col.papel]) : '';
      const papel = textoPapel ? PAPEIS[textoPapel] : 'operador';
      if (!papel) problemas.push(`papel "${String(l[col.papel!])}" desconhecido (use Atendente, Qualidade ou Gestor)`);

      const textoSetor = col.setor ? normalizar(l[col.setor]) : '';
      const setor = textoSetor ? setores.find((s) => normalizar(s.nome) === textoSetor) ?? null
        : setores.length === 1 ? setores[0] : null;
      if (!setor) problemas.push(textoSetor ? `setor "${String(l[col.setor!])}" não existe` : 'falta o setor');

      const textoCargo = col.cargo ? normalizar(l[col.cargo]) : '';
      const cargo = textoCargo && setor
        ? cargos.find((c) => (c.setor_id ?? 1) === setor.id && normalizar(c.nome) === textoCargo) ?? null : null;
      if (textoCargo && papel && papel !== 'operador') problemas.push('gestão e qualidade não têm cargo (deixe a coluna Cargo em branco)');
      else if (textoCargo && setor && !cargo) problemas.push(`cargo "${String(l[col.cargo!])}" não existe em ${setor.nome}`);

      const hub = col.hub ? String(l[col.hub] ?? '').trim() || null : null;
      if (hub) {
        if (hubs.has(normalizar(hub))) problemas.push('nome no Hub já é de alguém do cadastro');
        else if (vistosHub.has(normalizar(hub))) problemas.push('nome no Hub repetido na planilha');
        vistosHub.add(normalizar(hub));
      }
      const entrada = col.entrada ? lerData(l[col.entrada]) : null;
      if (col.entrada && l[col.entrada] != null && String(l[col.entrada]).trim() && !entrada) {
        problemas.push('data de entrada inválida (use dd/mm/aaaa)');
      }
      lista.push({ linha: i + 2, nome, email, papel: papel ?? 'operador', setor, cargo, hub, entrada, problemas });
    });
    if (!lista.length) { setErro('Nenhuma linha com nome.'); return; }
    setPlano(lista);
  }

  const prontas = (plano ?? []).filter((p) => !p.problemas.length);

  async function cadastrar() {
    if (!prontas.length) return;
    const comAcesso = prontas.filter((p) => p.email).length;
    if (!confirm(`Cadastrar ${prontas.length} pessoa(s)${comAcesso ? ` e criar ${comAcesso} acesso(s)` : ''}?`
      + '\n\nAs senhas temporárias aparecem uma vez só, no fim.')) return;
    const db = criarClienteNavegador();
    const feitos: Resultado[] = [];
    for (const [i, p] of prontas.entries()) {
      setOcupado(`Cadastrando ${i + 1} de ${prontas.length}: ${p.nome}…`);
      const { data: criada, error } = await db.from('pessoas').insert({
        nome: p.nome, email: p.email, papel: p.papel, nome_hub: p.hub, admitido_em: p.entrada,
        // Pelo papel (3.0, como no "+ Novo usuário"): só o atendente entra nas
        // listas, nas médias e nas monitorias.
        avaliado: p.papel === 'operador', exibir_no_painel: p.papel === 'operador',
        conta_nas_medias: p.papel === 'operador', ativo: true,
      }).select('id').single();
      if (error || !criada) { feitos.push({ nome: p.nome, email: p.email, senha: null, erro: await mensagemDoErro(error!) }); continue; }

      // Setor e cargo a partir do mês de entrada (ou do mês aberto). O setor
      // padrão que o banco põe na pessoa nova (migração 86) dá lugar ao da planilha.
      const desde = p.entrada ? mesDeCompetencia(p.entrada) : competencia;
      const passos = [
        () => db.from('setores_da_pessoa').delete().eq('pessoa_id', criada.id),
        () => db.from('setores_da_pessoa').insert({ pessoa_id: criada.id, desde, setor_id: p.setor!.id }),
        ...(p.cargo && p.papel === 'operador' ? [() => db.from('cargos_da_pessoa').insert({ pessoa_id: criada.id, desde, cargo_id: p.cargo!.id })] : []),
      ];
      let falha: string | null = null;
      for (const passo of passos) {
        const { error: e } = await passo();
        if (e) { falha = `ficha criada, mas setor/cargo não: ${await mensagemDoErro(e)}`; break; }
      }
      let senha: string | null = null;
      if (!falha && p.email) {
        const { data, error: e } = await db.rpc('criar_acesso', { p_pessoa: criada.id, p_email: p.email, p_papel: p.papel });
        if (e) falha = `ficha criada, mas o acesso não: ${await mensagemDoErro(e)}`;
        else senha = String(data);
      }
      feitos.push({ nome: p.nome, email: p.email, senha, erro: falha });
    }
    setOcupado(null); setPlano(null); setArquivo(null); setCopiado(false);
    setResultado(feitos);
    router.refresh();
  }

  async function copiarSenhas() {
    const texto = (resultado ?? []).filter((r) => r.senha)
      .map((r) => `${r.nome}\t${r.email}\t${r.senha}`).join('\n');
    try { await navigator.clipboard.writeText(texto); setCopiado(true); } catch { setCopiado(false); }
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)}
              className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Cadastrar várias pessoas (planilha)
      </button>
    );
  }

  return (
    <Quadro titulo="Cadastrar várias pessoas"
            subtitulo="Uma planilha (.xlsx) com uma pessoa por linha. Nada é gravado antes da conferência."
            acao={<button type="button" onClick={() => { setAberto(false); setPlano(null); setResultado(null); }}
                          className="text-sm text-slate-500 hover:underline">Fechar</button>}>
      <p className="mb-3 text-sm text-slate-600">
        Colunas pelo nome do cabeçalho, em qualquer ordem: <b>Nome</b> (obrigatória), <b>E-mail</b> (com e-mail, o acesso é
        criado), <b>Setor</b>{setores.length === 1 ? ` (em branco: ${setores[0].nome})` : ''}, <b>Cargo</b>, <b>Nome no Hub</b>,{' '}
        <b>Entrada</b> (dd/mm/aaaa; setor e cargo valem desse mês) e <b>Papel</b> (Atendente, Qualidade ou Gestor; em branco:
        Atendente). Gestão e qualidade entram sem cargo e fora das listas, das médias e das monitorias. Na coluna E-mail
        vale também um nome de usuário, como &ldquo;admin&rdquo;.
      </p>
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-4 text-sm text-slate-600 hover:border-marca-600">
        <input type="file" accept=".xlsx" className="sr-only" disabled={!!ocupado}
               onChange={(e) => { escolher(e.target.files?.[0]); e.target.value = ''; }} />
        {arquivo ? <span><b>{arquivo}</b> · clique para trocar</span> : <span><b>Escolha a planilha</b> (.xlsx)</span>}
      </label>

      {erro && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {ocupado && <p className="mt-3 text-sm text-slate-500">{ocupado}</p>}

      {plano && (
        <div className="mt-4 space-y-3">
          <Tabela noQuadro>
            <thead>
              <tr><Th>Linha</Th><Th>Nome</Th><Th>E-mail</Th><Th>Setor · cargo</Th><Th>Nome no Hub</Th><Th>Desde</Th><Th>Situação</Th></tr>
            </thead>
            <tbody>
              {plano.map((p) => (
                <tr key={p.linha} className={p.problemas.length ? 'opacity-70' : ''}>
                  <Td className="text-xs text-slate-500">{p.linha}</Td>
                  <Td className="font-medium text-slate-800">{p.nome}</Td>
                  <Td className="text-xs">{p.email ?? <span className="text-slate-400">sem acesso</span>}</Td>
                  <Td className="text-xs">{p.setor?.nome ?? '—'} · {p.cargo?.nome ?? <span className="text-slate-400">sem cargo</span>}</Td>
                  <Td className="text-xs">{p.hub ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-xs">{mesRotulo(p.entrada ? mesDeCompetencia(p.entrada) : competencia)}</Td>
                  <Td className="text-xs">
                    {p.problemas.length
                      ? <span className="text-rose-700 dark:text-rose-300">{p.problemas.join('; ')}</span>
                      : <span className="font-semibold text-marca-700 dark:text-marca-400">✓ pronta</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-sm text-slate-600">
              {prontas.length} de {plano.length} pronta(s){plano.length > prontas.length ? ' — as com problema ficam de fora' : ''}
            </span>
            <button type="button" onClick={cadastrar} disabled={!!ocupado || !prontas.length}
                    className="rounded-lg bg-marca-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
              Cadastrar {prontas.length}
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <div className="mt-4 space-y-3">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20">
            As senhas temporárias aparecem <b>só agora</b>: copie e repasse a cada pessoa. Elas trocam a senha no primeiro acesso.
          </p>
          <Tabela noQuadro>
            <thead><tr><Th>Nome</Th><Th>E-mail</Th><Th>Senha temporária</Th><Th>Situação</Th></tr></thead>
            <tbody>
              {resultado.map((r) => (
                <tr key={r.nome + (r.email ?? '')}>
                  <Td className="font-medium text-slate-800">{r.nome}</Td>
                  <Td className="text-xs">{r.email ?? '—'}</Td>
                  <Td className="font-mono text-sm">{r.senha ?? '—'}</Td>
                  <Td className="text-xs">{r.erro
                    ? <span className="text-rose-700 dark:text-rose-300">{r.erro}</span>
                    : <span className="font-semibold text-marca-700 dark:text-marca-400">✓ cadastrada</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          {resultado.some((r) => r.senha) && (
            <button type="button" onClick={copiarSenhas}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {copiado ? '✓ Copiado' : 'Copiar nomes, e-mails e senhas'}
            </button>
          )}
        </div>
      )}
    </Quadro>
  );
}
