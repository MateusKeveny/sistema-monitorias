'use client';

import { useEffect } from 'react';

/**
 * Ordenar qualquer tabela pelo título da coluna (Performance 3.9.0 /
 * Monitorias): 1º clique, do maior para o menor (▼); 2º, do menor para o
 * maior (▲); 3º, desfaz (volta à ordem original). Um componente só, no
 * layout: vale para toda tabela que aparecer, sem mexer em cada uma.
 *
 * Entende os formatos do painel: 1.234,5 · 95,1% · 2:46 · 05/11/2026 · R$ ·
 * ≈ 540 · 1º. Vazio ("—") fica sempre no fim. Ficam paradas embaixo as linhas
 * de total (com borda dupla em cima, `border-t-2`, ou `data-fixa`). Ficam de
 * fora as tabelas com campo de formulário, com linhas agrupadas (colspan) ou
 * marcadas com `data-sem-ordem`.
 */
export default function OrdenarTabelas() {
  useEffect(() => {
    const ORIGEM = 'data-ordem-original';

    const texto = (td: Element | undefined) => (td?.textContent ?? '').replace(/ /g, ' ').trim();
    const valor = (t: string): { n: number | null; s: string } => {
      if (!t || t === '—' || t === '-') return { n: null, s: '' };
      let m = t.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?/);
      if (m) return { n: Number(`${m[3] ?? '2000'}${m[2]}${m[1]}`), s: t };
      m = t.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
      if (m) return { n: m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]), s: t };
      const limpo = t.replace(/^[≈~]\s*/, '').replace(/^R\$\s*/, '');
      m = limpo.match(/^([+−-]?)\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d+))?\s*(%|pts|pt|º|ª|x)?(?:\s|$)/);
      if (m) {
        const n = Number(`${m[2].replace(/\./g, '')}.${m[3] ?? '0'}`);
        return { n: m[1] && m[1] !== '+' ? -n : n, s: t };
      }
      return { n: null, s: t.toLocaleLowerCase('pt-BR') };
    };

    /** Linhas que se movem (as de total ficam embaixo). */
    const linhasDe = (tbody: HTMLTableSectionElement) => [...tbody.rows].filter((r) =>
      !r.hasAttribute('data-fixa') && !r.className.includes('border-t-2'));

    const ordenavel = (tabela: HTMLTableElement) => {
      if (tabela.hasAttribute('data-sem-ordem') || !tabela.tHead || !tabela.tBodies[0]) return false;
      const corpo = tabela.tBodies[0];
      if (corpo.querySelector('input, select, textarea')) return false;
      const linhas = linhasDe(corpo);
      if (linhas.length < 2) return false;
      return linhas.every((r) => [...r.cells].every((c) => c.colSpan === 1));
    };

    /** A coluna real do título, contando colspan dos títulos anteriores. */
    const colunaDo = (th: HTMLTableCellElement) => {
      let i = 0;
      for (const c of [...(th.parentElement as HTMLTableRowElement).cells]) {
        if (c === th) return i;
        i += c.colSpan;
      }
      return -1;
    };

    const marcar = () => {
      document.querySelectorAll<HTMLTableElement>('main table').forEach((tabela) => {
        if (!ordenavel(tabela)) return;
        const linhaTitulo = tabela.tHead!.rows[tabela.tHead!.rows.length - 1];
        [...linhaTitulo.cells].forEach((th) => {
          if (th.textContent?.trim() && !th.hasAttribute('data-ordenavel')) {
            th.setAttribute('data-ordenavel', '');
            th.setAttribute('title', 'Clique para ordenar: maior → menor, menor → maior, original');
          }
        });
      });
    };

    const aoClicar = (e: MouseEvent) => {
      const th = (e.target as HTMLElement).closest('th[data-ordenavel]') as HTMLTableCellElement | null;
      if (!th) return;
      const tabela = th.closest('table') as HTMLTableElement;
      if (!ordenavel(tabela)) return;
      const corpo = tabela.tBodies[0];
      const coluna = colunaDo(th);
      const linhas = linhasDe(corpo);
      // A ordem original fica guardada na primeira vez.
      linhas.forEach((r, i) => { if (!r.hasAttribute(ORIGEM)) r.setAttribute(ORIGEM, String(i)); });
      const atual = th.getAttribute('data-ordem');
      const prox = atual === 'desc' ? 'asc' : atual === 'asc' ? null : 'desc';
      tabela.querySelectorAll('th[data-ordem]').forEach((x) => x.removeAttribute('data-ordem'));
      if (prox) th.setAttribute('data-ordem', prox);

      const ordenadas = [...linhas].sort((a, b) => {
        if (!prox) return Number(a.getAttribute(ORIGEM)) - Number(b.getAttribute(ORIGEM));
        const va = valor(texto(a.cells[coluna])), vb = valor(texto(b.cells[coluna]));
        const vaziaA = va.n == null && !va.s, vaziaB = vb.n == null && !vb.s;
        if (vaziaA !== vaziaB) return vaziaA ? 1 : -1;
        const d = va.n != null && vb.n != null ? va.n - vb.n : va.s.localeCompare(vb.s, 'pt-BR', { numeric: true });
        return (prox === 'desc' ? -d : d) || Number(a.getAttribute(ORIGEM)) - Number(b.getAttribute(ORIGEM));
      });
      // As de total continuam no fim, na ordem em que estavam.
      const fixas = [...corpo.rows].filter((r) => !linhas.includes(r));
      [...ordenadas, ...fixas].forEach((r) => corpo.appendChild(r));
    };

    marcar();
    // Tabelas que aparecem depois (troca de aba, de mês, atualização).
    const observador = new MutationObserver(() => marcar());
    observador.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', aoClicar);
    return () => { observador.disconnect(); document.removeEventListener('click', aoClicar); };
  }, []);

  return null;
}
