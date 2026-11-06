'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Novidades (aprovado em 30/10/2026): aparece sozinha no primeiro acesso de
 * cada pessoa depois de uma versão com novidade para ela — uma vez por
 * navegador. Depois do "Entendi", some também o link do rodapé (3.2.0).
 * Texto e versão diferentes para o atendente e para a gestão: o atendente não
 * teve novidade depois da 3.0.
 */
const ITENS = {
  atendente: {
    versao: '3.0',
    titulo: 'Bem-vindo à nova versão do Painel de Performance',
    itens: [
      ['Visual novo', 'telas mais limpas e gráficos que mostram o valor exato ao passar o mouse.'],
      ['Seu TME agora é seu', 'a partir de novembro, a pontuação de TME vem do seu tempo na semana, e não mais da média da equipe.'],
      ['Para bater a meta', 'no Início, quanto falta para a meta do mês e os caminhos para chegar lá. Se o ritmo ficar abaixo, você recebe um aviso no sino.'],
      ['C-SAT em destaque', 'em "Meu C-SAT", o seu percentual do mês e a proporção das suas notas de 1 a 5, de relance.'],
      ['Menu organizado', 'Acompanhar, Qualidade e Registrar.'],
    ],
  },
  gestao: {
    versao: '3.9',
    titulo: 'O que mudou da 3.7 à 3.9',
    itens: [
      ['Assuntos mais tratados', 'em C-SAT (visão da equipe), o Top 10 das tabulações do mês, com a % das avaliações, o volume estimado e o C-SAT de cada assunto. Geral e por fila.'],
      ['Atendimento da Sol', 'em Lançamentos, um cartão por fila para lançar, por semana, o número geral e quantos a Sol resolveu. No Comparativo › Volume, a evolução mês a mês, em Geral e por fila.'],
      ['Cores novas', 'a paleta do Dashboard iGreen nos dois temas, e as mesmas cores para cada métrica em todos os gráficos.'],
      ['Comparativo › Geral', 'atendimentos × avaliações, C-SAT, monitoria e pontos mês a mês, com gráficos; e, em C-SAT, os atendimentos lançados × avaliações da equipe.'],
    ],
    administrador: [
      ['Administrador', 'você vê e ajusta todos os setores, cria setor (em etapas: nome e base, filas, monitorias e revisão) e move atendentes entre setores pela Árvore.'],
    ],
    anteriores: [
      ['Cada um no seu setor', 'gestão e qualidade veem e mexem só no setor em que estão; o banco recusa qualquer gravação em outro setor.'],
      ['Árvore dos setores', 'em Usuários e setores › Árvore, a operação desenhada como organograma: gestão, qualidade, filas e atendentes de cada setor.'],
      ['Configuração por setor e cargo', 'primeiro o setor, depois um cargo por vez nos pesos (com "Todos lado a lado" para comparar).'],
      ['Setores e filas', 'a operação agora é organizada em setores, cada um com as suas filas, cargos, métricas, monitorias e fechamento. O seletor de setor no topo do menu vale para todas as telas.'],
      ['Usuários e setores', 'pessoas, logins e setores num só lugar. O login pode ser por nome de usuário.'],
      ['Ciclo do mês', 'Importar, Lançamentos, Métricas da semana, Conferência e Fechamento, no menu, na ordem do trabalho.'],
      ['Fechamento', 'agora roda em segundo plano, e você recebe um aviso no sino quando termina.'],
      ['TME por pessoa', 'a partir de novembro, configurável por fila.'],
      ['Para bater a meta', 'o Início do atendente mostra quanto falta e os caminhos para a meta, contando a escala de cada um (na ficha da pessoa) e as férias.'],
      ['Monitorias por setor', 'critérios, quantidade por semana e piso de cada setor, configuráveis.'],
      ['Desempenho', 'o sistema ficou várias vezes mais rápido e preparado para vários setores ao mesmo tempo.'],
    ],
  },
} as const;

export default function Novidades({ gestao, administrador = false }: { gestao: boolean; administrador?: boolean }) {
  // null: ainda não sabe; true: já viu (sem janela nem link).
  const [vista, setVista] = useState<boolean | null>(null);
  const [aberta, setAberta] = useState(false);
  const VERSAO = gestao ? ITENS.gestao.versao : ITENS.atendente.versao;
  const CHAVE = `novidades-vistas-${VERSAO}${gestao ? '-gestao' : ''}`;
  const itens: readonly (readonly [string, string])[] = gestao
    ? [...(administrador ? ITENS.gestao.administrador : []), ...ITENS.gestao.itens] : ITENS.atendente.itens;
  const titulo = gestao ? ITENS.gestao.titulo : ITENS.atendente.titulo;

  // Abre sozinha na primeira vez (o navegador pode não deixar guardar: aí fica só o link).
  useEffect(() => {
    try {
      const ja = !!localStorage.getItem(CHAVE);
      setVista(ja);
      if (!ja) setAberta(true);
    } catch { setVista(false); }
  }, [CHAVE]);

  function fechar() {
    try { localStorage.setItem(CHAVE, new Date().toISOString()); } catch { /* sem armazenamento */ }
    setAberta(false);
    setVista(true);
  }

  if (vista !== false && !aberta) return null;
  return (
    <>
      {!aberta && (
        <button type="button" onClick={() => setAberta(true)}
                className="text-xs text-slate-500 underline-offset-2 hover:text-marca-700 hover:underline dark:hover:text-marca-400">
          Novidades da {VERSAO}
        </button>
      )}
      {/* No corpo da página: dentro do menu (que é uma camada própria), os cartões da tela ficavam por cima. */}
      {aberta && createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="novidades-titulo"
             className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6" onClick={fechar}>
          <div className="w-full max-w-lg rounded-[20px] bg-superficie p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-semibold uppercase tracking-wider text-marca-700 dark:text-marca-400">Versão {VERSAO}</p>
            <h2 id="novidades-titulo" className="mt-1 text-xl font-bold tracking-tight text-slate-900">{titulo}</h2>
            <ul className="mt-4 space-y-3">
              {itens.map(([titulo, texto]) => (
                <li key={titulo} className="flex gap-3 text-sm leading-relaxed text-slate-600">
                  <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-marca-600" />
                  <span><b className="font-semibold text-slate-900">{titulo}:</b> {texto}</span>
                </li>
              ))}
            </ul>
            {gestao && (
              <p className="mt-4 text-xs leading-relaxed text-slate-500">
                <b className="font-semibold text-slate-600">Na 3.0:</b>{' '}
                {ITENS.gestao.anteriores.map(([t]) => t).join(' · ')}.
              </p>
            )}
            <div className="mt-6 flex justify-end">
              <button type="button" onClick={fechar} autoFocus
                      className="rounded-full bg-marca-600 px-5 py-2 text-sm font-semibold text-white hover:bg-marca-700">
                Entendi
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
