export type PapelUsuario = 'gestor' | 'qualidade' | 'operador';

/**
 * Uma pessoa, uma linha.
 *
 * Antes havia duas tabelas — `operadores`, de quem é avaliado, e `perfis`, de
 * quem entra no sistema — com nome e e-mail repetidos nas duas. Agora as duas
 * coisas são campos da mesma pessoa: `avaliado` diz se ela entra nas
 * monitorias e `auth_id` diz se ela tem login. Desativar tira tudo de uma vez,
 * sem precisar lembrar em quantos lugares ela existe.
 */
export type Pessoa = {
  id: string;
  /** Usuário do Supabase correspondente. Nulo em quem é avaliado e não acessa. */
  auth_id: string | null;
  nome: string;
  email: string | null;
  /** Nome usado no Huggy — consumido pelo painel de performance. */
  nome_huggy: string | null;
  /** Nome usado no Hub, que substituiu o Huggy em 03/09/2026. */
  nome_hub?: string | null;
  papel: PapelUsuario;
  avaliado: boolean;
  ativo: boolean;
  /** false enquanto a pessoa não trocar a senha inicial no primeiro acesso. */
  senha_definida: boolean;
};

/** Quem está logado: uma pessoa com login. */
export type Perfil = Pessoa;

/** Quem pode ser avaliado: uma pessoa com `avaliado`. */
export type Operador = Pessoa;

export type Canal = { id: string; nome: string; ativo: boolean };

export type Criterio = {
  id: string;
  ordem: number;
  nome: string;
  peso: number;
  ativo: boolean;
};

export type Monitoria = {
  id: string;
  /** Número curto e único da monitoria, para citar e para buscar. */
  codigo: number;
  protocolo: string;
  data_atendimento: string;
  mes_referencia: string;
  ano: number;
  mes: number;
  semana_mes: number;
  numero_monitoria: number;
  operador_id: string;
  operador: string;
  canal: string | null;
  tempo_atendimento_seg: number | null;
  nota_final: number;
  zerado: boolean;
  motivo_zeramento: string | null;
  parecer: string | null;
  monitor: string | null;
  criado_em: string;
};

export type LinhaRanking = {
  mes_referencia: string;
  operador_id: string;
  operador: string;
  total_monitorias: number;
  nota_media: number;
  nota_minima: number;
  nota_maxima: number;
  zeradas: number;
  impecaveis: number;
  nota_media_sem_zeradas: number | null;
};

export type LinhaCriterio = {
  mes_referencia: string;
  criterio_id: string;
  criterio: string;
  peso: number;
  avaliacoes: number;
  reprovacoes: number;
  taxa_reprovacao: number;
  pontos_perdidos: number;
};

export type LinhaFeedback = {
  monitoria_id: string;
  operador_id: string;
  operador: string;
  protocolo: string;
  data_atendimento: string;
  mes_referencia: string;
  semana_mes: number;
  numero_monitoria: number;
  nota_final: number;
  zerado: boolean;
  parecer: string | null;
  criterio_ordem: number;
  criterio: string;
  peso: number;
  conforme: boolean;
  observacao: string | null;
};

// ---------------------------------------------------------------------------
// Painel de cota
// ---------------------------------------------------------------------------

export type Cargo = { id: number; nome: string; ordem: number; ativo: boolean };

/** Catálogo: o que pontua. Quanto vale fica em `PesoCargo`. */
export type RegraCota = {
  chave: string;
  grupo: string;
  rotulo: string;
  /** Valor sugerido ao criar cargo; o que vale é o peso do cargo. */
  peso: number;
  faixa_min: number | null;
  faixa_max: number | null;
  ordem: number;
  /** Entra por lançamento manual. */
  manual: boolean;
  /** O gestor digita os pontos em vez de quantidade × peso. */
  valor_manual: boolean;
  ativo: boolean;
};

export type PesoCargo = { cargo_id: number; regra: string; peso: number; ativo: boolean };

/** `cargo_id` recebe a média de quem está em `referencia_id`. */
export type ReferenciaCargo = { cargo_id: number; referencia_id: number };

/** Cargo da pessoa a partir de uma competência (`desde`, sempre dia 1). */
export type CargoDaPessoa = { pessoa_id: string; desde: string; cargo_id: number };

export type Lancamento = {
  id: number;
  pessoa_id: string;
  mes_competencia: string;
  /** Nulo = lançamento do mês inteiro. */
  semana: number | null;
  /** 'huggy' = Expansão · 'diretores' = Diretores-Expansão. */
  canal: 'huggy' | 'diretores';
  regra: string;
  quantidade: number;
  pontos_manuais: number | null;
  observacao: string | null;
  lancado_por_nome: string | null;
  criado_em: string;
};

export type AvaliacaoDiretores = {
  id: string;
  pessoa_id: string;
  data: string;
  protocolo: string | null;
  nota: number | null;
  observacao: string | null;
  criado_em: string;
};

export type ConferenciaLancamento = {
  pessoa_id: string;
  mes_competencia: string;
  bloco: string;
  atendimentos: number;
  soma_das_faixas: number;
  diferenca: number;
};

/** Chaves de regra com tratamento especial nas telas. */
export const REGRA_META = 'meta';
export const REGRA_MEDIA = 'media_da_equipe';

export const NOMES_PAPEL: Record<PapelUsuario, string> = {
  gestor: 'Gestor',
  qualidade: 'Qualidade',
  operador: 'Operador',
};
