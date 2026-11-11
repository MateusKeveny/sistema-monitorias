/**
 * Escala e feriados (4.6.0, migração 107): o que o SLA dos chamados usa para
 * contar só o tempo dentro do expediente de quem tratou.
 *
 * A planilha tem duas abas — "Horários" (uma linha por pessoa e grupo de dias
 * com o mesmo horário) e "Feriados" (um por linha) — e é lida no navegador,
 * como as outras importações. Aqui ficam só as contas, sem tela.
 */
import { dataDoExcel, type Linha } from '@/lib/xlsx-navegador';

export type LinhaDeEscala = {
  pessoa_id: string; dia_semana: number; entrada: string; inicio_intervalo: string | null;
  fim_intervalo: string | null; saida: string; vale_desde: string | null;
};
export type Escala = LinhaDeEscala & { id: number };
export type Feriado = {
  id: number; setor_id: number; data: string; nome: string; facultativo: boolean;
  confirmado: boolean | null; observacao: string | null;
};
export type FeriadoNovo = Pick<Feriado, 'data' | 'nome' | 'facultativo' | 'observacao'>;

export const NOMES_DOS_DIAS = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const DIA: Record<string, number> = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, dom: 7 };

/** Sem acento, minúsculo e sem espaço sobrando: para comparar nomes. */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** 'seg a sex' → [1..5]; 'sáb' → [6]; 'seg, qua, sex'; 'ter a qui e sáb'. */
export function diasDaCelula(texto: string): number[] | null {
  const partes = normalizar(texto).split(/\s*(?:,|;|\be\b)\s*/).filter(Boolean);
  if (!partes.length) return null;
  const dias = new Set<number>();
  for (const p of partes) {
    const m = /^([a-z]{3})[a-z-]*(?:\s+(?:a|ate)\s+([a-z]{3})[a-z-]*)?$/.exec(p);
    if (!m || !(m[1] in DIA) || (m[2] && !(m[2] in DIA))) return null;
    const de = DIA[m[1]], ate = m[2] ? DIA[m[2]] : de;
    if (ate < de) return null;
    for (let d = de; d <= ate; d++) dias.add(d);
  }
  return [...dias].sort((a, b) => a - b);
}

/** Hora da célula: fração do dia (0,375) ou texto ('9:00', '09h00') → 'HH:MM'. */
export function horaDaCelula(v: Linha[string] | undefined): string | null | 'erro' {
  if (v == null || v === '') return null;
  let min: number;
  if (typeof v === 'number') {
    min = Math.round((v % 1) * 24 * 60);
  } else {
    const m = /^(\d{1,2})\s*[:h]\s*(\d{2})?$/i.exec(String(v).trim());
    if (!m) return 'erro';
    min = Number(m[1]) * 60 + Number(m[2] ?? 0);
  }
  if (!(min >= 0 && min < 24 * 60)) return 'erro';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Data da célula: número do Excel ou 'DD/MM/AAAA' → 'AAAA-MM-DD'. */
export function dataDaCelula(v: Linha[string] | undefined): string | null | 'erro' {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return dataDoExcel(v);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v).trim());
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()) ? String(v).trim() : 'erro';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Colunas pelo cabeçalho (primeira linha), sem depender da ordem. */
function colunas(linhas: Linha[], nomes: Record<string, string>): Record<string, string | undefined> {
  const cab = linhas[0] ?? {};
  const achadas: Record<string, string | undefined> = {};
  for (const [chave, titulo] of Object.entries(nomes)) {
    achadas[chave] = Object.keys(cab).find((col) => normalizar(String(cab[col])) === normalizar(titulo));
  }
  return achadas;
}

const ehExemplo = (...v: (Linha[string] | undefined)[]) => v.some((x) => typeof x === 'string' && normalizar(x).startsWith('(exemplo)'));

export type LeituraDaPlanilha = {
  escala: LinhaDeEscala[];
  pessoas: string[];          // ids de quem veio na planilha (a escala delas é trocada)
  feriados: FeriadoNovo[];
  erros: string[];
  avisos: string[];
};

/**
 * Lê as abas "Horários" e "Feriados". Pessoa pelo nome (sem acento e sem
 * maiúscula); horário em branco = não trabalha naquele dia; linha "(exemplo)"
 * é ignorada; feriado de outro setor também.
 */
export function lerEscalaEFeriados(abas: Map<string, Linha[]>, pessoas: { id: string; nome: string }[], setorNome: string): LeituraDaPlanilha {
  const r: LeituraDaPlanilha = { escala: [], pessoas: [], feriados: [], erros: [], avisos: [] };
  const aba = (nome: string) => [...abas.entries()].find(([n]) => normalizar(n) === normalizar(nome))?.[1];
  const porNome = new Map(pessoas.map((p) => [normalizar(p.nome), p.id]));

  const horarios = aba('Horários');
  if (!horarios) r.erros.push('A planilha não tem a aba "Horários".');
  else {
    const c = colunas(horarios, {
      setor: 'Setor', nome: 'Colaborador', dias: 'Dias', entrada: 'Entrada',
      ini: 'Início do intervalo', fim: 'Fim do intervalo', saida: 'Saída', desde: 'Vale desde',
    });
    const faltam = ['nome', 'dias', 'entrada', 'saida'].filter((k) => !c[k]);
    if (faltam.length) r.erros.push('Na aba "Horários" faltam as colunas Colaborador, Dias, Entrada e Saída.');
    else {
      const vistos = new Set<string>();
      const quem = new Set<string>();
      horarios.slice(1).forEach((l, i) => {
        const n = i + 2;
        const nome = String(l[c.nome!] ?? '').trim();
        if (!nome || ehExemplo(l[c.setor ?? ''], nome)) return;
        const id = porNome.get(normalizar(nome));
        if (!id) { r.erros.push(`Linha ${n}: "${nome}" não está no ${setorNome}.`); return; }
        quem.add(id);
        const entrada = horaDaCelula(l[c.entrada!]), saida = horaDaCelula(l[c.saida!]);
        const ini = horaDaCelula(c.ini ? l[c.ini] : undefined), fim = horaDaCelula(c.fim ? l[c.fim] : undefined);
        if (entrada == null && saida == null) return; // não trabalha nesses dias
        const dias = diasDaCelula(String(l[c.dias!] ?? ''));
        const desde = dataDaCelula(c.desde ? l[c.desde] : undefined);
        if (!dias) { r.erros.push(`Linha ${n} (${nome}): não entendi os dias "${l[c.dias!] ?? ''}". Use "seg a sex", "sáb" ou "seg, qua, sex".`); return; }
        if ([entrada, saida, ini, fim].includes('erro') || entrada == null || saida == null) {
          r.erros.push(`Linha ${n} (${nome}): horário inválido. Use o formato 08:00, com entrada e saída.`); return;
        }
        if (desde === 'erro') { r.erros.push(`Linha ${n} (${nome}): "Vale desde" inválido. Use 01/10/2026.`); return; }
        if ((ini == null) !== (fim == null)) { r.erros.push(`Linha ${n} (${nome}): preencha o início e o fim do intervalo, ou deixe os dois em branco.`); return; }
        const ordem = [entrada, ini, fim, saida].filter((x): x is string => x != null);
        if (ordem.some((h, j) => j > 0 && h <= ordem[j - 1])) {
          r.erros.push(`Linha ${n} (${nome}): os horários precisam crescer (entrada, intervalo, saída).`); return;
        }
        for (const d of dias) {
          const chave = `${id}|${d}|${desde ?? ''}`;
          if (vistos.has(chave)) { r.erros.push(`Linha ${n} (${nome}): ${NOMES_DOS_DIAS[d]} aparece em duas linhas.`); continue; }
          vistos.add(chave);
          r.escala.push({ pessoa_id: id, dia_semana: d, entrada: entrada as string, inicio_intervalo: ini as string | null,
            fim_intervalo: fim as string | null, saida: saida as string, vale_desde: desde as string | null });
        }
      });
      r.pessoas = [...quem];
      const semEscala = pessoas.filter((p) => !quem.has(p.id)).map((p) => p.nome);
      if (semEscala.length) r.avisos.push(`Sem linha na planilha (continuam como estão): ${semEscala.join(', ')}.`);
    }
  }

  const feriados = aba('Feriados');
  if (feriados) {
    const c = colunas(feriados, { data: 'Data', nome: 'Feriado', setor: 'Setor', obs: 'Observação' });
    if (!c.data || !c.nome) r.erros.push('Na aba "Feriados" faltam as colunas Data e Feriado.');
    else {
      const datas = new Set<string>();
      let deOutro = 0;
      feriados.slice(1).forEach((l, i) => {
        const nome = String(l[c.nome!] ?? '').trim();
        if (!nome || ehExemplo(nome, l[c.setor ?? ''])) return;
        if (c.setor && l[c.setor] && normalizar(String(l[c.setor])) !== normalizar(setorNome)) { deOutro++; return; }
        const data = dataDaCelula(l[c.data!]);
        if (data == null || data === 'erro') { r.erros.push(`Feriados, linha ${i + 2}: data inválida. Use 25/12/2026.`); return; }
        if (datas.has(data)) { r.erros.push(`Feriados: ${data.split('-').reverse().join('/')} aparece duas vezes.`); return; }
        datas.add(data);
        const obs = c.obs ? String(l[c.obs] ?? '').trim() : '';
        r.feriados.push({ data, nome, facultativo: normalizar(obs).includes('facultativo'), observacao: obs || null });
      });
      if (deOutro) r.avisos.push(`${deOutro} feriado${deOutro > 1 ? 's' : ''} de outro setor ignorado${deOutro > 1 ? 's' : ''}.`);
    }
  }
  return r;
}

/** '09:00:00' → '09:00'. */
export const hora = (h: string | null) => (h ? h.slice(0, 5) : '');

/** O horário de um dia em texto: "09:00–12:30 · 13:30–17:12". */
export function textoDoDia(e: Pick<LinhaDeEscala, 'entrada' | 'inicio_intervalo' | 'fim_intervalo' | 'saida'>): string {
  return e.inicio_intervalo
    ? `${hora(e.entrada)}–${hora(e.inicio_intervalo)} · ${hora(e.fim_intervalo)}–${hora(e.saida)}`
    : `${hora(e.entrada)}–${hora(e.saida)}`;
}

/** Horas trabalhadas no dia (sem o intervalo). */
export function horasDoDia(e: Pick<LinhaDeEscala, 'entrada' | 'inicio_intervalo' | 'fim_intervalo' | 'saida'>): number {
  const m = (h: string | null) => (h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) : 0);
  return (m(e.saida) - m(e.entrada) - (e.inicio_intervalo ? m(e.fim_intervalo) - m(e.inicio_intervalo) : 0)) / 60;
}
