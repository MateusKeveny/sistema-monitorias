import { diaDaSemana, hoje, horaLocal, partesLocais, somarDias, ultimoDiaDoMes } from '@/lib/agenda/tempo';
import { proximoDia, regraCasa } from '@/lib/agenda/regras';
import type { Categoria, Prioridade } from '@/lib/agenda/tipos';

/**
 * O "assistente" da entrada rápida: lê uma frase do dia a dia e separa o que
 * fazer, quando e com que repetição. Sem API, por regras — previsível, de
 * graça e instantâneo enquanto se digita.
 *
 *   "me lembra sexta às 10 de cobrar o relatório da equipe"
 *     → "Cobrar o relatório da equipe" · sexta · 10:00 · Equipe
 *   "todo dia 5 conferir o pagamento"      → mensal:5
 *   "toda segunda e quarta 9h alinhamento" → semanal:1,3 · 09:00 · Reunião
 *   "último dia útil do mês fechar ciclo"  → mensal:ultimo_util · Cota
 *
 * O que não for reconhecido fica no título. A tela mostra a leitura antes de
 * salvar, e tudo pode ser corrigido no formulário completo.
 */
export type Interpretacao = {
  titulo: string;
  dia: string | null;
  hora: string | null;
  regra: string | null;
  categoria: Categoria;
  prioridade: Prioridade;
};

type Agora = { dia: string; hora: string };

const DIAS: Record<string, number> = {
  segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, domingo: 7,
};
const NOME_DIA = 'segunda|terca|quarta|quinta|sexta|sabado|domingo';
const NUMEROS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, meia: 0.5 };

const CATEGORIA_POR_PALAVRA: [RegExp, Categoria][] = [
  [/\bmonitori/, 'monitorias'],
  [/\b(cota|fechamento|fechar (o )?(mes|ciclo)|ciclo|lancamento|volume|extrato|bonus|pagamento|importa(r|cao)|chamados?)/, 'cota'],
  [/\b(reuniao|call|alinhamento|meet|teams|apresentacao)/, 'reuniao'],
  [/\b(equipe|feedback|1:1|one a one|atendente|operador|time|treinamento|escala|ferias)/, 'equipe'],
  [/\b(medico|dentista|academia|pessoal|consulta|banco|mercado|farmacia)/, 'pessoal'],
];

/** Minúsculas e sem acento, com o mesmo comprimento — os índices valem para o original. */
function normalizar(texto: string): string {
  let s = '';
  for (const c of texto) {
    const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    s += n.length === c.length ? n : c.toLowerCase().length === c.length ? c.toLowerCase() : c;
  }
  return s;
}

export function interpretar(texto: string, agora: Agora = { dia: hoje(), hora: horaLocal(new Date()) }): Interpretacao {
  let t = normalizar(texto);
  const remover: [number, number][] = [];

  /** Procura, guarda o trecho para tirar do título e o apaga de `t`. */
  const achar = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(t);
    if (!m) return null;
    remover.push([m.index, m.index + m[0].length]);
    t = t.slice(0, m.index) + ' '.repeat(m[0].length) + t.slice(m.index + m[0].length);
    return m;
  };

  let dia: string | null = null;
  let hora: string | null = null;
  let regra: string | null = null;
  let prioridade: Prioridade = 2;
  let semanaSemDia = false;

  // Começo da frase: "me lembra de", "preciso", "tenho que"…
  achar(/^\s*(me\s+)?(lembr(a|e|ar)(-me)?|avis(a|e|ar))(\s+(de|que|para|pra))?\s+|^\s*(preciso(\s+de)?|tenho\s+que|nao\s+esquecer\s+de)\s+/);

  // Prioridade.
  if (achar(/\s*\b(urgente|importante|prioridade\s+alta)\b|\s*!+\s*$/)) prioridade = 1;
  else if (achar(/\s*\b(prioridade\s+baixa|sem\s+pressa|quando\s+der)\b/)) prioridade = 3;

  // ---------- Repetição ----------
  const todo = '(?:todo|toda|todos|todas|cada|sempre)(?:\\s+(?:o|a|os|as|no|na))?';
  if (achar(new RegExp(`\\b${todo}\\s+ultimo\\s+dia\\s+util(\\s+do\\s+mes)?\\b`))) regra = 'mensal:ultimo_util';
  else if (achar(new RegExp(`\\b${todo}\\s+ultimo\\s+dia(\\s+do\\s+mes)?\\b`))) regra = 'mensal:ultimo';
  else if (achar(/\b(todo\s+dia\s+util|(?:nos\s+|em\s+)?dias\s+uteis|de\s+segunda\s+a\s+sexta)\b/)) regra = 'dias_uteis';
  else {
    const mensal = achar(/\b(?:(?:todo|cada)\s+(?:mes\s+)?(?:no\s+)?dia|mensalmente(?:\s+(?:no\s+)?dia)?)\s+(\d{1,2})\b/);
    if (mensal && Number(mensal[1]) >= 1 && Number(mensal[1]) <= 31) regra = `mensal:${Number(mensal[1])}`;
    else if (achar(/\b(todos\s+os\s+dias|todo\s+dia|diariamente)\b/)) regra = 'diaria';
    else if (achar(/\b(todo\s+mes|mensalmente)\b/)) regra = `mensal:${Number(agora.dia.slice(8, 10))}`;
    else {
      const semanal = achar(new RegExp(
        `\\b(?:toda|todas\\s+as|todo|todos\\s+os|cada)\\s+((?:${NOME_DIA})s?(?:-feiras?)?(?:\\s*(?:,|e)\\s*(?:${NOME_DIA})s?(?:-feiras?)?)*)\\b`));
      if (semanal) {
        const dias = [...semanal[1].matchAll(new RegExp(NOME_DIA, 'g'))].map((m) => DIAS[m[0]]);
        regra = `semanal:${[...new Set(dias)].sort().join(',')}`;
      } else if (achar(/\b(toda\s+semana|semanalmente)\b/)) {
        semanaSemDia = true;   // o dia vem de "na segunda", se houver
      }
    }
  }

  // ---------- Quando: relativo ----------
  const rel = achar(/\b(?:em|daqui\s+(?:a|uns|umas)?)\s*(\d+|um|uma|dois|duas|tres|meia)\s+(minutos?|min|horas?|h|dias?)\b/);
  if (rel) {
    const n = NUMEROS[rel[1]] ?? Number(rel[1]);
    if (rel[2].startsWith('d')) dia = somarDias(agora.dia, Math.round(n));
    else {
      const ms = n * (rel[2].startsWith('h') ? 3_600_000 : 60_000);
      const alvo = partesLocais(new Date(Date.parse(`${agora.dia}T${agora.hora}:00-03:00`) + ms));
      dia = alvo.dia;
      hora = alvo.hora;
    }
  }

  // ---------- Quando: o dia ----------
  if (!dia) {
    if (achar(/\bdepois\s+de\s+amanha\b/)) dia = somarDias(agora.dia, 2);
    else if (achar(/\bamanha\b/)) dia = somarDias(agora.dia, 1);
    else if (achar(/\bhoje\b/)) dia = agora.dia;
  }
  if (!dia && !regra) {
    const ultimoUtil = achar(/\b(?:no\s+)?ultimo\s+dia\s+util(\s+do\s+mes)?\b/);
    const ultimo = !ultimoUtil && achar(/\b(?:no\s+)?ultimo\s+dia\s+do\s+mes\b/);
    if (ultimoUtil || ultimo) {
      const r = ultimoUtil ? 'mensal:ultimo_util' : 'mensal:ultimo';
      dia = proximoDia(r, agora.dia);
    }
  }
  if (!dia) {
    const data = achar(/\b(?:(?:no|em)\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (data) {
      const [d, m] = [Number(data[1]), Number(data[2])];
      let a = data[3] ? Number(data[3].length === 2 ? `20${data[3]}` : data[3]) : Number(agora.dia.slice(0, 4));
      const montar = (ano: number) => `${ano}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        if (!data[3] && montar(a) < agora.dia) a += 1;
        dia = montar(a);
      }
    }
  }
  if (!dia && !regra) {
    const n = achar(/\b(?:(?:no|para\s+o|ate\s+o)\s+)?dia\s+(\d{1,2})\b/);
    if (n && Number(n[1]) >= 1 && Number(n[1]) <= 31) {
      const mes = agora.dia.slice(0, 8);
      const noMes = (base: string) => {
        const fim = ultimoDiaDoMes(base);
        return `${base.slice(0, 8)}${String(Math.min(Number(n[1]), Number(fim.slice(8, 10)))).padStart(2, '0')}`;
      };
      dia = noMes(`${mes}01`);
      if (dia < agora.dia) dia = noMes(somarDias(ultimoDiaDoMes(agora.dia), 1));
    }
  }
  if (!dia) {
    const sem = achar(new RegExp(
      `\\b(?:(?:n[ao]|nest[ae]|ness[ae]|(?:n[ao]\\s+)?proxim[ao]|(?:para|ate)\\s+(?:a|o))\\s+)?(${NOME_DIA})(?:-feira)?(\\s+que\\s+vem)?\\b`));
    if (sem) {
      const alvo = DIAS[sem[1]];
      const proxima = /proxim/.test(sem[0]) || !!sem[2];
      let dif = (alvo - diaDaSemana(agora.dia) + 7) % 7;
      if (dif === 0 && proxima) dif = 7;
      dia = somarDias(agora.dia, dif);
    }
  }
  if (!dia && achar(/\b(semana\s+que\s+vem|proxima\s+semana)\b/)) {
    dia = somarDias(agora.dia, 8 - diaDaSemana(agora.dia));   // próxima segunda
  }

  // ---------- Quando: a hora ----------
  if (!hora) {
    if (achar(/\b(?:(?:as|ao|a|pelo|pelas)\s+)?meio[\s-]dia\b/)) hora = '12:00';
    else {
      const h = achar(/\b(?:(?:as|a|pelas|ate\s+as)\s+)?(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?:\s*min)?\b/)
             ?? achar(/\b(?:as|pelas|ate\s+as)\s+(\d{1,2})\b(?!\s*\/)/);
      if (h && Number(h[1]) <= 23 && Number(h[2] ?? 0) <= 59) {
        let hh = Number(h[1]);
        if (hh < 12 && achar(/\b(?:da|de|a)\s+(?:tarde|noite)\b/)) hh += 12;
        else achar(/\b(?:da|de)\s+manha\b/);
        hora = `${String(hh).padStart(2, '0')}:${String(Number(h[2] ?? 0)).padStart(2, '0')}`;
      }
    }
  }
  if (!hora) {
    if (achar(/\b(?:de|pela|na|logo\s+de)\s+manha(?:zinha)?\b/)) hora = '09:00';
    else if (achar(/\b(?:a|de|pela|na)\s+tarde\b/)) hora = '14:00';
    else if (achar(/\b(?:a|de|pela)\s+noite\b/)) hora = '19:00';
    else if (achar(/\b(?:no\s+)?fim\s+do\s+(?:dia|expediente)\b/)) hora = '17:00';
  }

  // ---------- Juntar ----------
  if (semanaSemDia) regra = `semanal:${diaDaSemana(dia ?? agora.dia)}`;

  // Só a hora: hoje, ou amanhã se já passou.
  if (!dia && hora && !regra) dia = hora > agora.hora ? agora.dia : somarDias(agora.dia, 1);

  // Repetição: a primeira ocorrência a partir do dia dito (ou de hoje).
  if (regra) {
    let desde = dia ?? agora.dia;
    if (!dia && hora && hora <= agora.hora && regraCasa(regra, agora.dia)) desde = somarDias(agora.dia, 1);
    dia = proximoDia(regra, desde);
  }

  // Título: o original sem os trechos reconhecidos.
  const tirar = new Array(texto.length).fill(false);
  for (const [a, b] of remover) for (let i = a; i < b; i++) tirar[i] = true;
  let titulo = texto.split('').map((c, i) => (tirar[i] ? ' ' : c)).join('').replace(/\s+/g, ' ').trim();
  const solta = /^(?:de|da|do|para|pra|pro|no|na|em|a|as|às|ao|e|que|,|-|–|:)\s+|\s+(?:de|da|do|para|pra|no|na|em|a|as|às|ao|e|,|-|–|:)$|^[,;:\-–]+|[,;:\-–]+$/i;
  for (let i = 0; i < 6 && solta.test(titulo); i++) titulo = titulo.replace(solta, '').trim();
  titulo = titulo.replace(/^./, (c) => c.toUpperCase());

  const n = normalizar(texto);
  const categoria = CATEGORIA_POR_PALAVRA.find(([re]) => re.test(n))?.[1] ?? 'geral';

  return { titulo, dia, hora, regra, categoria, prioridade };
}
