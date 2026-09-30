/**
 * Diário de bordo (1.22.0): o que vale para os dois sites.
 *
 * O registro mora no Performance (`/cota/diario`); a consulta de gestão e
 * qualidade, no site de Monitorias (`/diario`); e o aviso, no formulário da
 * monitoria. As regras de quem grava o quê ficam no banco (migração 31).
 */

export type TipoRegistro = 'processo' | 'treinamento' | 'autorizacao' | 'excecao';
export type QuemAutorizou = 'gestao' | 'diretoria' | 'outro';
export type SituacaoRegistro = 'concluido' | 'aguardando' | 'devolvido';

export type RegistroDiario = {
  id: string;
  pessoa_id: string;
  data: string;
  tipo: TipoRegistro;
  /** Obrigatório em autorização e exceção; opcional em processo e treinamento (migração 35). */
  protocolo: string | null;
  assunto: string;
  descricao: string;
  autorizado_por: QuemAutorizou | null;
  autorizado_por_nome: string | null;
  /** Até quando vale (migração 36). Vencido, continua no diário, só marcado. */
  valido_ate: string | null;
  situacao: SituacaoRegistro;
  decidido_por: string | null;
  decidido_em: string | null;
  comentario_decisao: string | null;
  criado_em: string;
};

export const TIPOS: { chave: TipoRegistro; rotulo: string; dica: string }[] = [
  { chave: 'processo', rotulo: 'Processo novo', dica: 'mudou como se faz' },
  { chave: 'treinamento', rotulo: 'Treinamento', dica: 'o que foi ensinado' },
  { chave: 'autorizacao', rotulo: 'Autorização', dica: 'alguém liberou algo' },
  { chave: 'excecao', rotulo: 'Exceção', dica: 'fora da regra' },
];
export const ROTULO_TIPO = Object.fromEntries(TIPOS.map((t) => [t.chave, t.rotulo])) as Record<TipoRegistro, string>;

export const ROTULO_QUEM: Record<QuemAutorizou, string> = { gestao: 'Gestão', diretoria: 'Diretoria', outro: 'Outro' };

/**
 * Quem pode ter autorizado, por origem (1.25.0): na gestão e na diretoria o
 * nome é escolhido na lista; em "Outro", digita-se nome, cargo e setor.
 * Mudou alguém na gestão ou na diretoria, é aqui que se ajusta.
 */
export const AUTORIZADORES: Record<'gestao' | 'diretoria', string[]> = {
  diretoria: ['Luciana Freire'],
  gestao: ['Mateus Keveny', 'Suyara Martins'],
};

/**
 * A validade para mostrar: "Vale até 15/10/2026" ou "Vencido em 15/10/2026".
 * Nulo quando o registro não tem validade.
 */
export function validade(r: Pick<RegistroDiario, 'valido_ate'>, hoje: string) {
  if (!r.valido_ate) return null;
  const [a, m, d] = r.valido_ate.split('-');
  const dias = Math.round((Date.parse(r.valido_ate) - Date.parse(hoje)) / 86_400_000);
  const vencido = dias < 0;
  // Nos últimos dias, gestor e Pleno podem renovar (migração 37).
  const vencendo = !vencido && dias <= DIAS_PARA_RENOVAR;
  const texto = vencido ? `Vencido em ${d}/${m}/${a}`
    : dias === 0 ? 'Vence hoje'
    : vencendo ? `Vence em ${dias} dia${dias > 1 ? 's' : ''} (${d}/${m})`
    : `Vale até ${d}/${m}/${a}`;
  return { vencido, vencendo, texto };
}

/** Quantos dias antes de vencer a renovação abre — o mesmo número da migração 37. */
export const DIAS_PARA_RENOVAR = 7;

/** Último dia de validade que já abre a renovação — para a pendência do Início. */
export const limiteDeRenovacao = (hoje: string) =>
  new Date(Date.parse(hoje) + DIAS_PARA_RENOVAR * 86_400_000).toISOString().slice(0, 10);

/**
 * Quem precisa ler cada processo e treinamento, e se já leu (migração 38,
 * função leituras_do_diario). `ciente_em` nulo = leitura pendente.
 */
export type LeituraDiario = {
  registro_id: string;
  pessoa_id: string;
  nome: string;
  ciente_em: string | null;
};

/** O que uma pessoa ainda não leu no diário, para a ficha em Atendentes. */
export type LeituraDaPessoa = {
  pendentes: { id: string; tipo: TipoRegistro; assunto: string; desde: string }[];
  /** Última confirmação dada, de qualquer registro. */
  ultima: string | null;
};

/** Quantas pessoas têm ao menos uma leitura pendente — a pendência do Início. */
export const pessoasComLeituraPendente = (leituras: LeituraDiario[]) =>
  new Set(leituras.filter((l) => !l.ciente_em).map((l) => l.pessoa_id)).size;

/** Uma renovação: de quando para quando a validade passou (migração 37). */
export type RenovacaoDiario = {
  registro_id: string;
  valia_ate: string;
  passa_a_valer: string;
  renovado_por: string | null;
  renovado_em: string;
};

/** "Outro" é gravado como "Nome · Cargo · Setor" no nome de quem autorizou. */
export const juntarOutro = (nome: string, cargo: string, setor: string) =>
  [nome, cargo, setor].map((p) => p.trim()).join(' · ');
export const separarOutro = (texto: string) => {
  const [nome = '', cargo = '', setor = ''] = texto.split(' · ');
  return { nome, cargo, setor };
};

export const ROTULO_SITUACAO: Record<SituacaoRegistro, string> = {
  concluido: 'Concluído', aguardando: 'Aguardando aprovação', devolvido: 'Devolvido',
};

/** Classes da etiqueta de cada tipo e situação. */
export const COR_TIPO: Record<TipoRegistro, string> = {
  processo: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  treinamento: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  autorizacao: 'bg-marca-600/15 text-marca-700 dark:text-marca-400',
  excecao: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
};
export const COR_SITUACAO: Record<SituacaoRegistro, string> = {
  concluido: 'bg-marca-600/15 text-marca-700 dark:text-marca-400',
  aguardando: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  devolvido: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

/**
 * Palavras que, citadas no texto, pedem "quem autorizou".
 *
 * Não travam o texto: pedem a informação que falta. Bloquear por palavra dá
 * falso positivo ("não foi autorizado") e ensina a escrever torto para
 * passar; pedir o campo resolve os dois casos. Comparação por começo de
 * palavra, sem acento, para pegar "autorizou", "autorizada", "liberado"…
 */
export const PALAVRAS_DE_AUTORIZACAO = ['autoriz', 'liberad', 'liberou', 'diretoria', 'gestao', 'gestor', 'excecao', 'excepcional'];

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** As palavras de autorização encontradas no texto, como aparecem nele. */
export function palavrasEncontradas(texto: string): string[] {
  const achadas = new Set<string>();
  for (const palavra of texto.split(/[^\p{L}]+/u)) {
    const limpa = semAcento(palavra);
    if (limpa && PALAVRAS_DE_AUTORIZACAO.some((p) => limpa.startsWith(p))) achadas.add(palavra.toLowerCase());
  }
  return [...achadas];
}

/** Só autorizações e exceções geram o aviso na monitoria. */
export const TIPOS_QUE_AVISAM_NA_MONITORIA: TipoRegistro[] = ['autorizacao', 'excecao'];
