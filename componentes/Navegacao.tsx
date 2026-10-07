'use client';

import Link from '@/componentes/Link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import BotaoTema from '@/componentes/BotaoTema';
import BotaoReportar from '@/componentes/BotaoReportar';
import { NOMES_PAPEL, type Perfil } from '@/lib/tipos';
import { NOME_SISTEMA, type Sistema } from '@/lib/sistema';

/**
 * `grupo` junta itens num menu que abre ao clicar. Nove links soltos quebravam
 * o cabeçalho em três ou quatro linhas em janela média, e ele fica fixo no
 * topo — chegava a comer um terço da tela. Grupo com um item só visível (o
 * operador vê só o Presencial de "Registrar") vira link comum.
 */
export type Item = { href: string; rotulo: string; papeis: Perfil['papel'][]; grupo?: string };

// O operador não tem "Relatórios": todos eles são recortes do time, e o que é
// dele já está em "Monitorias" e no painel. Menu com item que não acrescenta
// nada é ruído.
export const ITENS: Record<Sistema, Item[]> = {
  monitorias: [
    { href: '/', rotulo: 'Painel', papeis: ['gestor', 'qualidade', 'operador'] },
    { href: '/monitorias', rotulo: 'Monitorias', papeis: ['gestor', 'qualidade', 'operador'] },
    { href: '/monitorias/nova', rotulo: 'Nova monitoria', papeis: ['gestor', 'qualidade'], grupo: 'Registrar' },
    { href: '/diario', rotulo: 'Diário de bordo', papeis: ['gestor', 'qualidade'], grupo: 'Registrar' },
    { href: '/relatorios', rotulo: 'Relatórios', papeis: ['gestor', 'qualidade'] },
    { href: '/configuracoes', rotulo: 'Configurações', papeis: ['gestor'], grupo: 'Administrar' },
    { href: '/reportes', rotulo: 'Reports', papeis: ['gestor'], grupo: 'Administrar' },
  ],
  cota: [
    { href: '/cota', rotulo: 'Início', papeis: ['gestor', 'qualidade', 'operador'] },
    { href: '/cota/comparativo', rotulo: 'Comparativo', papeis: ['gestor', 'qualidade', 'operador'] },
    { href: '/cota/extrato', rotulo: 'Extrato', papeis: ['gestor', 'qualidade', 'operador'] },
    { href: '/cota/historico', rotulo: 'Histórico', papeis: ['gestor', 'qualidade', 'operador'] },
    { href: '/cota/monitorias', rotulo: 'Monitorias', papeis: ['gestor', 'qualidade', 'operador'] },
    { href: '/cota/diario', rotulo: 'Diário de bordo', papeis: ['gestor', 'qualidade', 'operador'], grupo: 'Registrar' },
    { href: '/cota/presencial', rotulo: 'Presencial', papeis: ['gestor', 'qualidade', 'operador'], grupo: 'Registrar' },
    { href: '/cota/lancamentos', rotulo: 'Lançamentos', papeis: ['gestor'], grupo: 'Registrar' },
    { href: '/cota/importar', rotulo: 'Importar', papeis: ['gestor'], grupo: 'Registrar' },
    { href: '/cota/fechamento', rotulo: 'Fechamento', papeis: ['gestor'] },
    { href: '/cota/atendentes', rotulo: 'Atendentes', papeis: ['gestor'], grupo: 'Administrar' },
    { href: '/cota/acessos', rotulo: 'Acessos', papeis: ['gestor'], grupo: 'Administrar' },
    { href: '/cota/configuracao', rotulo: 'Configuração', papeis: ['gestor'], grupo: 'Administrar' },
    { href: '/reportes', rotulo: 'Reports de problemas', papeis: ['gestor'], grupo: 'Administrar' },
  ],
};

export default function Navegacao({
  perfil, pendentes = 0, sistema, versao, avisosReporte = 0,
}: {
  /** Respostas novas (autor) ou reports novos (gestor), no botão de reportar. */
  avisosReporte?: number;
  perfil: Perfil;
  /** Qual dos dois sites está sendo servido (ver lib/sistema.ts). */
  sistema: Sistema;
  /** Exclusões esperando decisão do gestor. Zero esconde o contador. */
  pendentes?: number;
  /**
   * Versão em uso, vinda do servidor.
   *
   * Chega por propriedade, e não por import do package.json, porque este é um
   * componente de navegador: importar aqui levaria o arquivo inteiro para o
   * pacote enviado ao usuário, só para exibir cinco caracteres.
   */
  versao?: string;
}) {
  const caminho = usePathname();
  const router = useRouter();

  async function sair() {
    await criarClienteNavegador().auth.signOut();
    router.push('/login');
    router.refresh();
  }

  // A raiz de cada sistema só fica ativa nela mesma, senão acenderia junto com
  // todas as páginas de dentro.
  const ativo = (href: string) =>
    href === '/' || href === '/cota' ? caminho === href : caminho.startsWith(href);

  // No Performance (1.15.0) o item ativo é marcado por um traço que desliza
  // até ele, em vez do fundo verde. As Monitorias ficam como estavam: são
  // outro sistema, com versão e público próprios.
  const deslizante = sistema === 'cota';
  const estilo = (aceso: boolean) => `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
    deslizante
      ? aceso ? 'text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
      : aceso
        ? 'bg-marca-50 text-marca-700 dark:text-marca-400'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

  // Posição do traço: medida no item ativo a cada troca de página. O
  // cabeçalho fica montado entre as páginas, então o traço desliza de um item
  // ao outro.
  const menu = useRef<HTMLElement>(null);
  const [traco, setTraco] = useState<{ x: number; y: number; w: number } | null>(null);
  useLayoutEffect(() => {
    if (!deslizante) return;
    const medir = () => {
      const el = menu.current?.querySelector<HTMLElement>('[data-ativo="true"]');
      setTraco(el ? { x: el.offsetLeft + 12, y: el.offsetTop + el.offsetHeight + 2, w: el.offsetWidth - 24 } : null);
    };
    medir();
    addEventListener('resize', medir);
    return () => removeEventListener('resize', medir);
  }, [caminho, deslizante]);

  // Na ordem da lista: cada grupo entra onde aparece o primeiro item dele.
  const visiveis = ITENS[sistema].filter((i) => i.papeis.includes(perfil.papel));
  const entradas: (Item | { grupo: string; itens: Item[] })[] = [];
  for (const item of visiveis) {
    const doGrupo = item.grupo ? visiveis.filter((i) => i.grupo === item.grupo) : [];
    if (doGrupo.length < 2) entradas.push(item);
    else if (doGrupo[0] === item) entradas.push({ grupo: item.grupo!, itens: doGrupo });
  }

  return (
    // Fixo no topo só em tela larga, onde cabe numa linha. Em janela estreita
    // o menu ainda quebra, e fixo ele tomaria a tela.
    <header className="sem-impressao z-20 border-b border-slate-200 bg-superficie lg:sticky lg:top-0">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        {/* A versão fica sob o nome do sistema, apagada de propósito: serve
            para quem reporta um problema dizer em qual versão viu, sem
            competir com o menu. */}
        <span className="flex flex-col justify-center leading-none">
          <span className="text-sm font-bold tracking-tight text-marca-700 dark:text-marca-400">
            {NOME_SISTEMA[sistema]}
          </span>
          {versao && (
            <span
              aria-label={`Versão ${versao}`}
              className="mt-1 select-none text-[10px] tabular-nums text-slate-400/60"
            >
              v{versao}
            </span>
          )}
        </span>

        <nav ref={menu} className="relative flex flex-1 flex-wrap items-center gap-1">
          {traco && (
            <span aria-hidden
                  className="pointer-events-none absolute left-0 top-0 h-0.5 rounded-full bg-marca-600
                             transition-[transform,width] duration-300 ease-out motion-reduce:transition-none"
                  style={{ width: traco.w, transform: `translate(${traco.x}px, ${traco.y}px)` }} />
          )}
          {entradas.map((item) => 'itens' in item ? (
            <MenuDoGrupo key={item.grupo} rotulo={item.grupo} itens={item.itens}
                         ativo={ativo} estilo={estilo} caminho={caminho} />
          ) : (
            <Link
              key={item.href}
              href={item.href}
              data-ativo={ativo(item.href)}
              aria-current={ativo(item.href) ? 'page' : undefined}
              className={estilo(ativo(item.href))}
            >
              {item.rotulo}
              {/* Só no Painel, que é onde a fila de exclusões aparece. */}
              {item.href === '/' && pendentes > 0 && (
                <span
                  title={`${pendentes} exclusão(ões) aguardando sua decisão`}
                  className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center
                             rounded-full bg-amber-500 px-1 text-xs font-bold
                             tabular-nums text-white"
                >
                  {pendentes}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-right xl:block">
            <span className="block font-medium text-slate-800">{perfil.nome}</span>
            <span className="block text-xs text-slate-500">{NOMES_PAPEL[perfil.papel]}</span>
          </span>
          <BotaoReportar sistema={sistema === 'cota' ? 'performance' : 'monitorias'} versao={versao ?? ''}
                         pessoaId={perfil.id} ehGestor={perfil.papel === 'gestor'} avisos={avisosReporte} variante="topo" />
          <BotaoTema />
          <button
            onClick={sair}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm
                       font-medium text-slate-700 hover:bg-slate-50"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * Um grupo do menu: botão que abre a lista dos itens.
 *
 * Fecha ao escolher (a página muda), ao clicar fora e com Esc — que devolve o
 * foco ao botão, para quem navega pelo teclado não se perder. O botão fica
 * aceso quando a página atual é de dentro do grupo, senão o menu não diria
 * onde a pessoa está.
 */
function MenuDoGrupo({ rotulo, itens, ativo, estilo, caminho }: {
  rotulo: string;
  itens: Item[];
  ativo: (href: string) => boolean;
  estilo: (aceso: boolean) => string;
  caminho: string;
}) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  useEffect(() => setAberto(false), [caminho]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAberto(false); botao.current?.focus(); }
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  return (
    // A marca de ativo fica no invólucro, filho direto do menu: é dele que o
    // traço mede a posição (o botão mediria em relação a este invólucro).
    <div ref={raiz} className="relative" data-ativo={itens.some((i) => ativo(i.href))}>
      <button
        ref={botao}
        type="button"
        aria-expanded={aberto}
        aria-haspopup="true"
        onClick={() => setAberto((a) => !a)}
        className={`${estilo(itens.some((i) => ativo(i.href)))} inline-flex items-center gap-1`}
      >
        {rotulo}
        <svg aria-hidden viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${aberto ? 'rotate-180' : ''}`}>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {aberto && (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-44 rounded-lg border border-slate-200
                        bg-superficie p-1 shadow-lg">
          {itens.map((i) => (
            <Link key={i.href} href={i.href}
                  aria-current={ativo(i.href) ? 'page' : undefined}
                  className={`block ${estilo(ativo(i.href))}`}>
              {i.rotulo}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
