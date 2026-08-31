export type PapelUsuario = 'admin' | 'gestor' | 'operador';

export type Perfil = {
  id: string;
  nome: string;
  email: string;
  papel: PapelUsuario;
  operador_id: string | null;
  ativo: boolean;
};

export type Operador = {
  id: string;
  nome: string;
  email: string | null;
  ativo: boolean;
};

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
  admin: 'Qualidade (admin)',
  gestor: 'Gestor',
  operador: 'Operador',
};
