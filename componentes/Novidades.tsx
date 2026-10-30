'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * "Novidades da 3.0" (aprovado em 30/10/2026): aparece sozinha no primeiro
 * acesso de cada pessoa depois da virada — uma vez por navegador — e fica no
 * rodapé do menu para rever. Texto diferente para o atendente e para a gestão.
 */
const VERSAO = '3.0';
const CHAVE = `novidades-vistas-${VERSAO}`;

const ITENS = {
  atendente: {
    titulo: 'Bem-vindo à nova versão do Painel de Performance',
    itens: [
      ['Visual novo', 'telas mais limpas e gráficos que mostram o valor exato ao passar o mouse.'],
      ['Seu TME agora é seu', 'a partir de novembro, a pontuação de TME vem do seu tempo na semana, e não mais da média da equipe.'],
      ['C-SAT em destaque', 'em "Meu C-SAT", o seu percentual do mês e a proporção das suas notas de 1 a 5, de relance.'],
      ['Menu organizado', 'Acompanhar, Qualidade e Registrar.'],
    ],
  },
  gestao: {
    titulo: 'O que mudou na 3.0',
    itens: [
      ['Setores e filas', 'a operação agora é organizada em setores, cada um com as suas filas, cargos, métricas, monitorias e fechamento. O seletor de setor no topo do menu vale para todas as telas.'],
      ['Usuários e setores', 'pessoas, logins e setores num só lugar. O login pode ser por nome de usuário.'],
      ['Ciclo do mês', 'Importar, Lançamentos, Métricas da semana, Conferência e Fechamento, no menu, na ordem do trabalho.'],
      ['Fechamento', 'agora roda em segundo plano, e você recebe um aviso no sino quando termina.'],
      ['TME por pessoa', 'a partir de novembro, configurável por fila.'],
      ['Monitorias por setor', 'critérios, quantidade por semana e piso de cada setor, configuráveis.'],
      ['Desempenho', 'o sistema ficou várias vezes mais rápido e preparado para vários setores ao mesmo tempo.'],
    ],
  },
} as const;

export default function Novidades({ gestao }: { gestao: boolean }) {
  const [aberta, setAberta] = useState(false);
  const conteudo = gestao ? ITENS.gestao : ITENS.atendente;

  // Abre sozinha na primeira vez (o navegador pode não deixar guardar: aí só abre pelo link).
  useEffect(() => {
    try { if (!localStorage.getItem(CHAVE)) setAberta(true); } catch { /* sem armazenamento: só pelo link */ }
  }, []);

  function fechar() {
    try { localStorage.setItem(CHAVE, new Date().toISOString()); } catch { /* idem */ }
    setAberta(false);
  }

  return (
    <>
      <button type="button" onClick={() => setAberta(true)}
              className="text-xs text-slate-500 underline-offset-2 hover:text-marca-700 hover:underline dark:hover:text-marca-400">
        Novidades da {VERSAO}
      </button>
      {/* No corpo da página: dentro do menu (que é uma camada própria), os cartões da tela ficavam por cima. */}
      {aberta && createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="novidades-titulo"
             className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6" onClick={fechar}>
          <div className="w-full max-w-lg rounded-[20px] bg-superficie p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-semibold uppercase tracking-wider text-marca-700 dark:text-marca-400">Versão {VERSAO}</p>
            <h2 id="novidades-titulo" className="mt-1 text-xl font-bold tracking-tight text-slate-900">{conteudo.titulo}</h2>
            <ul className="mt-4 space-y-3">
              {conteudo.itens.map(([titulo, texto]) => (
                <li key={titulo} className="flex gap-3 text-sm leading-relaxed text-slate-600">
                  <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-marca-600" />
                  <span><b className="font-semibold text-slate-900">{titulo}:</b> {texto}</span>
                </li>
              ))}
            </ul>
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
