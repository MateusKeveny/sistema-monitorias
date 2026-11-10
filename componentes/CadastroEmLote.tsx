'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro, Tabela, Td, Th } from '@/componentes/ui';
import { dataDoExcel, lerPlanilha, type Linha } from '@/lib/xlsx-navegador';
import { hojeNoBrasil, mesDeCompetencia, mesRotulo } from '@/lib/formatar';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { emailDoLogin } from '@/lib/usuario';
import type { Cargo, PapelUsuario, Pessoa } from '@/lib/tipos';
import type { Setor } from '@/lib/setores';
import { gerarXlsx } from '@/lib/xlsx-escrever';
import { baixarArquivo } from '@/componentes/MetasPorLista';

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

/**
 * O gabarito do cadastro (4.1.0), como o modelo das metas por lista: a aba
 * "Pessoas" para preencher (só o cabeçalho), "Como preencher" com cada coluna
 * e "Setores e cargos" com os nomes exatamente como o sistema aceita.
 */
function gabaritoXlsx(setores: Setor[], cargos: Cargo[]): Uint8Array {
  const ativos = setores.filter((s) => s.ativo !== false);
  const primeiro = ativos[0];
  const exemploSetor = primeiro?.nome ?? '';
  const exemploCargo = cargos.find((c) => (c.setor_id ?? 1) === primeiro?.id)?.nome ?? '';
  const umSetor = ativos.length === 1;
  return gerarXlsx([
    { nome: 'Pessoas', linhas: [], colunas: [
      { cabecalho: 'Nome', chave: 'nome', largura: 34 },
      { cabecalho: 'E-mail', chave: 'email', largura: 34 },
      { cabecalho: 'Setor', chave: 'setor', largura: 24 },
      { cabecalho: 'Cargo', chave: 'cargo', largura: 24 },
      { cabecalho: 'Nome no Hub', chave: 'hub', largura: 28 },
      { cabecalho: 'Entrada', chave: 'entrada', largura: 14 },
      { cabecalho: 'Papel', chave: 'papel', largura: 14 },
    ] },
    { nome: 'Como preencher', colunas: [
      { cabecalho: 'Coluna', chave: 'coluna', largura: 16 },
      { cabecalho: 'Obrigatória', chave: 'obrigatoria', largura: 12 },
      { cabecalho: 'O que colocar', chave: 'oque', largura: 72, formato: 'quebra' },
      { cabecalho: 'Exemplo', chave: 'exemplo', largura: 26 },
    ], linhas: [
      { coluna: 'Nome', obrigatoria: 'Sim', oque: 'O nome completo. Uma pessoa por linha, na aba Pessoas (as outras abas são só de consulta).', exemplo: 'Maria da Silva Souza' },
      { coluna: 'E-mail', obrigatoria: 'Não', oque: 'Com e-mail (ou nome de usuário), o acesso já é criado e a senha temporária aparece no fim. Em branco: só a ficha, sem acesso.', exemplo: 'maria.souza@empresa.com.br' },
      { coluna: 'Setor', obrigatoria: umSetor ? 'Não' : 'Sim', oque: `O setor exatamente como na aba Setores e cargos.${umSetor ? ` Em branco: ${exemploSetor}.` : ''}`, exemplo: exemploSetor },
      { coluna: 'Cargo', obrigatoria: 'Não', oque: 'Só para Atendente: o cargo da pessoa no setor, como na aba Setores e cargos. Cargo que o setor ainda não tem é criado no cadastro, sem meta (a meta e os pesos se definem em Configuração › Pesos por cargo). Gestão e qualidade ficam sem cargo (em branco, ou "Gestão").', exemplo: exemploCargo },
      { coluna: 'Setor novo', obrigatoria: '—', oque: 'Para um setor que ainda vai ser criado: escreva o nome dele em Setor (ou deixe em branco) e os cargos que ele terá em Cargo. No assistente de Novo setor, o passo "Cargos e metas" cria os cargos a partir desta coluna, e no fim as pessoas são cadastradas com este mesmo arquivo.', exemplo: '' },
      { coluna: 'Nome no Hub', obrigatoria: 'Não', oque: 'Como a pessoa aparece nos relatórios do Hub, para ligar volume e avaliações a ela. Não pode repetir o de outra pessoa.', exemplo: 'Maria Souza' },
      { coluna: 'Entrada', obrigatoria: 'Não', oque: 'A data de entrada (dd/mm/aaaa). Setor e cargo valem a partir do mês dessa data. Em branco: o mês aberto.', exemplo: '01/11/2026' },
      { coluna: 'Papel', obrigatoria: 'Não', oque: 'Atendente, Qualidade ou Gestor (Gestão vale como Gestor). Em branco: Atendente. Gestão e qualidade ficam fora das listas, das médias e das monitorias.', exemplo: 'Atendente' },
    ] },
    { nome: 'Setores e cargos', colunas: [
      { cabecalho: 'Setor', chave: 'setor', largura: 28 },
      { cabecalho: 'Cargo', chave: 'cargo', largura: 32 },
    ], linhas: [
      ...ativos.flatMap((s) => {
        const doSetor = cargos.filter((c) => (c.setor_id ?? 1) === s.id);
        return doSetor.length ? doSetor.map((c) => ({ setor: s.nome, cargo: c.nome })) : [{ setor: s.nome, cargo: '(sem cargos)' }];
      }),
      { setor: '', cargo: '' },
      { setor: 'Papéis válidos', cargo: 'Atendente · Qualidade · Gestor' },
    ] },
  ]);
}

const PAPEIS: Record<string, PapelUsuario> = {
  operador: 'operador', atendente: 'operador', qualidade: 'qualidade', monitor: 'qualidade', gestor: 'gestor',
  // Gestão = Gestor (4.1.1).
  gestao: 'gestor', gestora: 'gestor',
};

/** "Cargo" de quem é da gestão ou da qualidade: só repete o papel, não é cargo (4.1.1). */
const CARGO_DO_PAPEL = new Set(['gestao', 'gestor', 'gestora', 'qualidade', 'monitor']);

/**
 * O papel da linha (4.1.1). Papel que não é Atendente, Qualidade nem Gestor,
 * numa linha com Cargo, é um cargo escrito na coluna errada (ex.: "Analista"):
 * a pessoa entra como Atendente, com aviso. Sem Cargo, continua erro.
 */
function papelDaLinha(textoPapel: string, textoCargo: string): { papel: PapelUsuario | null; aviso: string | null } {
  if (!textoPapel) return { papel: 'operador', aviso: null };
  const papel = PAPEIS[textoPapel];
  if (papel) return { papel, aviso: null };
  if (textoCargo && !CARGO_DO_PAPEL.has(textoCargo)) return { papel: 'operador', aviso: 'papel lido como Atendente' };
  return { papel: null, aviso: null };
}

type Colunas = Record<keyof typeof COLUNAS, string | undefined>;

/**
 * A aba "Pessoas" do gabarito (senão, a primeira com dados, fora as de
 * consulta) e onde está cada coluna. Usada aqui e no assistente de novo setor.
 */
export function linhasDoGabarito(abas: Map<string, Linha[]>): { col: Colunas; dados: Linha[] } | string {
  const consulta = ['como preencher', 'setores e cargos'];
  const [, linhas] = [...abas].find(([nome, l]) => normalizar(nome) === 'pessoas' && l.length > 1)
    ?? [...abas].find(([nome, l]) => l.length > 1 && !consulta.includes(normalizar(nome))) ?? ['', []];
  if (!linhas.length) return 'A planilha está vazia.';
  const [cabecalho, ...dados] = linhas;
  const por = new Map(Object.entries(cabecalho).map(([c, v]) => [normalizar(v), c]));
  const col = Object.fromEntries(Object.entries(COLUNAS)
    .map(([k, nomes]) => [k, nomes.map((n) => por.get(n)).find(Boolean)])) as Colunas;
  if (!col.nome) {
    return por.has('metrica')
      ? 'Este arquivo é a lista de metas (Métrica por linha, cargo por coluna), não o cadastro de pessoas. Use o gabarito de pessoas (Pessoas › Cadastrar várias pessoas › Baixar gabarito).'
      : 'Falta a coluna "Nome" no cabeçalho.';
  }
  return { col, dados };
}

/**
 * Os cargos que o gabarito de pessoas dá a um setor que ainda não existe
 * (4.1.0, assistente de novo setor): os da coluna Cargo das linhas de
 * Atendente com o Setor em branco ou igual ao nome do setor novo, sem repetir
 * (fica a grafia da primeira vez).
 */
export function cargosDoGabarito(abas: Map<string, Linha[]>, nomeDoSetor: string):
  { cargos: string[]; pessoas: number; deOutroSetor: number } | string {
  const g = linhasDoGabarito(abas);
  if (typeof g === 'string') return g;
  const { col, dados } = g;
  if (!col.cargo) return 'O gabarito não tem a coluna "Cargo".';
  const alvo = normalizar(nomeDoSetor);
  const vistos = new Map<string, string>();
  let pessoas = 0;
  let deOutroSetor = 0;
  for (const l of dados) {
    if (!String(l[col.nome!] ?? '').trim()) continue;
    const setor = col.setor ? normalizar(l[col.setor]) : '';
    if (setor && setor !== alvo) { deOutroSetor++; continue; }
    pessoas++;
    const cargo = String(l[col.cargo] ?? '').trim().replace(/\s+/g, ' ');
    const { papel } = papelDaLinha(col.papel ? normalizar(l[col.papel]) : '', normalizar(cargo));
    if (papel !== 'operador') continue;
    if (cargo && !vistos.has(normalizar(cargo))) vistos.set(normalizar(cargo), cargo);
  }
  return { cargos: [...vistos.values()], pessoas, deOutroSetor };
}

type Planejada = {
  linha: number; nome: string; email: string | null; papel: PapelUsuario;
  setor: Setor | null; cargo: Cargo | null; hub: string | null; entrada: string | null;
  /** Cargo que ainda não existe no setor: é criado no cadastro, sem meta (4.1.1). */
  cargoNovo: string | null;
  problemas: string[];
  avisos: string[];
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
export default function CadastroEmLote({ pessoas, setores, cargos, inicial, setorPadrao }: {
  pessoas: Pessoa[]; setores: Setor[]; cargos: Cargo[];
  /** O gabarito já subido (assistente de novo setor, 4.1.0): abre conferindo este arquivo. */
  inicial?: { arquivo: string; abas: Map<string, Linha[]> };
  /** O setor de quem está com a coluna Setor em branco (o setor recém-criado). */
  setorPadrao?: Setor;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(!!inicial);
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

  // O gabarito que veio do assistente: confere assim que a tela abre.
  useEffect(() => {
    if (inicial) { setArquivo(inicial.arquivo); conferir(inicial.abas); }
  }, [inicial?.abas]); // só um arquivo novo dispara (o objeto `inicial` muda a cada desenho)

  async function escolher(f: File | undefined) {
    setPlano(null); setErro(null); setResultado(null);
    if (!f) return;
    setArquivo(f.name);
    let abas: Map<string, Linha[]>;
    try { abas = await lerPlanilha(f); } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler a planilha.'); return;
    }
    conferir(abas);
  }

  function conferir(abas: Map<string, Linha[]>) {
    const g = linhasDoGabarito(abas);
    if (typeof g === 'string') { setErro(g); return; }
    const { col, dados } = g;

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
      const avisos: string[] = [];
      const textoCargo = col.cargo ? normalizar(l[col.cargo]) : '';
      const { papel, aviso } = papelDaLinha(col.papel ? normalizar(l[col.papel]) : '', textoCargo);
      if (!papel) problemas.push(`papel "${String(l[col.papel!])}" desconhecido (use Atendente, Qualidade ou Gestor)`);
      if (aviso) avisos.push(`papel "${String(l[col.papel!]).trim()}" lido como Atendente`);

      const textoSetor = col.setor ? normalizar(l[col.setor]) : '';
      const setor = textoSetor ? setores.find((s) => normalizar(s.nome) === textoSetor) ?? null
        : setorPadrao ?? (setores.length === 1 ? setores[0] : null);
      if (!setor) problemas.push(textoSetor ? `setor "${String(l[col.setor!])}" não existe` : 'falta o setor');

      const cargo = textoCargo && setor && papel === 'operador'
        ? cargos.find((c) => (c.setor_id ?? 1) === setor.id && normalizar(c.nome) === textoCargo) ?? null : null;
      let cargoNovo: string | null = null;
      // Gestão e qualidade não têm cargo; "Gestão"/"Gestor" na coluna Cargo só repete o papel.
      if (textoCargo && papel && papel !== 'operador') {
        if (!CARGO_DO_PAPEL.has(textoCargo)) problemas.push('gestão e qualidade não têm cargo (deixe a coluna Cargo em branco)');
      } else if (textoCargo && setor && !cargo) {
        cargoNovo = String(l[col.cargo!]).trim().replace(/\s+/g, ' ');
        avisos.push(`cria o cargo "${cargoNovo}" em ${setor.nome} (sem meta: defina em Configuração › Pesos por cargo)`);
      }

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
      lista.push({ linha: i + 2, nome, email, papel: papel ?? 'operador', setor, cargo, cargoNovo, hub, entrada, problemas, avisos });
    });
    if (!lista.length) { setErro('Nenhuma linha com nome.'); return; }
    setPlano(lista);
  }

  const prontas = (plano ?? []).filter((p) => !p.problemas.length);

  async function cadastrar() {
    if (!prontas.length) return;
    const comAcesso = prontas.filter((p) => p.email).length;
    // Os cargos que faltam (4.1.1), um por setor e nome.
    const faltam = new Map<string, { setor: Setor; nome: string }>();
    for (const p of prontas) if (p.cargoNovo && p.setor) faltam.set(`${p.setor.id}|${normalizar(p.cargoNovo)}`, { setor: p.setor, nome: p.cargoNovo });
    const listaFaltam = [...faltam.values()].map((c) => `${c.nome} (${c.setor.nome})`).join(', ');
    if (!confirm(`Cadastrar ${prontas.length} pessoa(s)${comAcesso ? ` e criar ${comAcesso} acesso(s)` : ''}?`
      + (faltam.size ? `\n\nCria ${faltam.size} cargo(s) sem meta: ${listaFaltam}. A meta e os pesos se definem em Configuração › Pesos por cargo.` : '')
      + '\n\nAs senhas temporárias aparecem uma vez só, no fim.')) return;
    const db = criarClienteNavegador();
    const feitos: Resultado[] = [];

    const criados = new Map<string, Cargo | string>(); // chave → cargo criado ou o erro
    for (const [k, c] of faltam) {
      setOcupado(`Criando o cargo ${c.nome} em ${c.setor.nome}…`);
      const ordem = Math.max(0, ...cargos.filter((x) => (x.setor_id ?? 1) === c.setor.id).map((x) => x.ordem),
        ...[...criados.values()].filter((x): x is Cargo => typeof x !== 'string' && x.setor_id === c.setor.id).map((x) => x.ordem)) + 1;
      const { data, error } = await db.from('cargos').insert({ nome: c.nome, ordem, setor_id: c.setor.id }).select('*').single();
      criados.set(k, error || !data ? await mensagemDoErro(error!) : (data as Cargo));
    }

    for (const [i, original] of prontas.entries()) {
      let p = original;
      if (p.cargoNovo && p.setor) {
        const c = criados.get(`${p.setor.id}|${normalizar(p.cargoNovo)}`);
        if (typeof c === 'string' || !c) { feitos.push({ nome: p.nome, email: p.email, senha: null, erro: `o cargo ${p.cargoNovo} não foi criado: ${c ?? ''}` }); continue; }
        p = { ...p, cargo: c };
      }
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
        criado), <b>Setor</b>{setorPadrao ? ` (em branco: ${setorPadrao.nome})` : setores.length === 1 ? ` (em branco: ${setores[0].nome})` : ''}, <b>Cargo</b>, <b>Nome no Hub</b>,{' '}
        <b>Entrada</b> (dd/mm/aaaa; setor e cargo valem desse mês) e <b>Papel</b> (Atendente, Qualidade ou Gestor; em branco:
        Atendente). Gestão e qualidade entram sem cargo e fora das listas, das médias e das monitorias. Na coluna E-mail
        vale também um nome de usuário, como &ldquo;admin&rdquo;.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => baixarArquivo(gabaritoXlsx(setores, cargos), 'gabarito-cadastro-de-pessoas.xlsx')}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          ⬇ Baixar gabarito (.xlsx)
        </button>
        <span className="text-xs text-slate-500">
          Preencha a aba <b>Pessoas</b>; as outras explicam cada coluna e trazem os setores e cargos com o nome exato.
        </span>
      </div>
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
                  <Td className="text-xs">{p.setor?.nome ?? '—'} · {p.cargo?.nome ?? p.cargoNovo ?? <span className="text-slate-400">sem cargo</span>}</Td>
                  <Td className="text-xs">{p.hub ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-xs">{mesRotulo(p.entrada ? mesDeCompetencia(p.entrada) : competencia)}</Td>
                  <Td className="text-xs">
                    {p.problemas.length
                      ? <span className="text-rose-700 dark:text-rose-300">{p.problemas.join('; ')}</span>
                      : <span className="font-semibold text-marca-700 dark:text-marca-400">✓ pronta</span>}
                    {!p.problemas.length && p.avisos.length > 0 && (
                      <span className="block text-amber-700 dark:text-amber-300">{p.avisos.join('; ')}</span>
                    )}
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
