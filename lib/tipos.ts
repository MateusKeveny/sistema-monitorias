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
  /** Entrada na operação. Nulo = já estava antes do painel existir. */
  admitido_em?: string | null;
  /** Saída da operação. Nulo = continua na equipe. */
  desligado_em?: string | null;
};

/** Resumo da cota de uma competência, congelado no dia da saída. */
export type CotaDaSaida = {
  competencia: string;
  cargo: string | null;
  resultado: number;
  meta: number | null;
  atingimento: number | null;
};

/**
 * O que fica guardado de quem saiu.
 *
 * O extrato é vivo: se as avaliações de quem saiu forem reatribuídas, o mês
 * dele esvazia. Esta é a foto do dia da saída, que nada depois altera.
 */
export type Saida = {
  id: string;
  pessoa_id: string;
  pessoa_nome: string;
  data: string;
  motivo: string | null;
  ficha: {
    email?: string | null;
    papel?: string | null;
    nome_huggy?: string | null;
    nome_hub?: string | null;
    admitido_em?: string | null;
    cargos?: { desde: string; cargo: string }[];
  };
  cota: CotaDaSaida[];
  registrado_por_nome: string | null;
  registrado_em: string;
  revertida_em: string | null;
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

/** Valor por ponto de uma competência, informado pelo gestor. */
export type ValorDaCota = {
  mes_competencia: string;
  valor_por_ponto: number;
  percentual_bonus: number;
  observacao: string | null;
  definido_por_nome: string | null;
  definido_em: string;
  atualizado_em: string | null;
};

/** Correção de um valor já definido: só existe com motivo. */
export type AlteracaoDeValor = {
  id: number;
  mes_competencia: string;
  valor_antes: number | null;
  valor_depois: number | null;
  motivo: string;
  alterado_por_nome: string | null;
  alterado_em: string;
};

/**
 * O que a pessoa recebe numa competência fechada.
 *
 * Sai do fechamento, não do extrato ao vivo: o que se paga é o que foi
 * enviado.
 */
export type PagamentoMensal = {
  pessoa_id: string;
  pessoa_nome: string;
  mes_competencia: string;
  cargo: string | null;
  resultado: number;
  meta: number | null;
  mes_inteiro: boolean;
  recebe_bonus: boolean;
  media_base: number | null;
  bonus_liberado: boolean;
  quantos_faltaram: number;
  valor_por_ponto: number | null;
  percentual_bonus: number;
  bonus: number;
  /** Abaixo da meta não se calcula valor: é para isso que a meta existe. */
  atingiu_meta: boolean;
  pontos_pagos: number;
  /** Nulo enquanto o valor por ponto do mês não for informado. */
  valor: number | null;
};
