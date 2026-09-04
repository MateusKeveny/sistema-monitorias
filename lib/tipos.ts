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

export const NOMES_PAPEL: Record<PapelUsuario, string> = {
  gestor: 'Gestor',
  qualidade: 'Qualidade',
  operador: 'Operador',
};
