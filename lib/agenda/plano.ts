import { diaLocal, diasEntre, horaLocal, somarDias } from '@/lib/agenda/tempo';
import { ocorrencias } from '@/lib/agenda/regras';
import type { ItemAgenda, Pendencia } from '@/lib/agenda/tipos';

/**
 * "Organiza meu dia", por regras: junta os lembretes e as pendências do
 * sistema numa ordem só, cada um com o motivo de estar onde está.
 *
 * A ordem:
 *   1. o que está atrasado, a prioridade alta primeiro;
 *   2. o que tem hora na próxima hora;
 *   3. pendências graves do sistema (pagamento, gente sem cargo, reports);
 *   4. o de hoje com prioridade alta;
 *   5. o resto de hoje — com hora, na ordem do relógio; sem hora, depois;
 *   6. as demais pendências do sistema;
 *   7. o de hoje com prioridade baixa.
 *
 * Pura e sem banco, para a tela e para conferir em teste.
 */
export type Agora = { dia: string; hora: string; instante: number };

export type Entrada =
  | { tipo: 'item'; chave: string; item: ItemAgenda; motivo: string; tom: 'atrasado' | 'agora' | 'normal' }
  | { tipo: 'pendencia'; chave: string; pendencia: Pendencia; motivo: string; tom: 'atrasado' | 'normal' };

export const diaDoItem = (i: ItemAgenda) => (i.lembrar_em ? diaLocal(i.lembrar_em) : null);

/** "14:00" ou, com horário de término (agenda/05), "14:00–16:00". */
// O fim só vale se vier depois do início — numa repetição reagendada só nesta
// vez, o fim da série pode ficar para trás.
const fimDe = (i: ItemAgenda, hora: string) => (i.hora_fim && i.hora_fim.slice(0, 5) > hora ? i.hora_fim.slice(0, 5) : null);
export const faixaDeHora = (i: ItemAgenda, hora: string) => { const f = fimDe(i, hora); return f ? `${hora}–${f}` : hora; };

export function atrasado(i: ItemAgenda, agora: Agora): boolean {
  if (!i.lembrar_em) return false;
  const dia = diaLocal(i.lembrar_em);
  return i.dia_inteiro ? dia < agora.dia : Date.parse(i.lembrar_em) <= agora.instante;
}

function motivoDoAtraso(i: ItemAgenda, agora: Agora): string {
  const dias = diasEntre(diaDoItem(i)!, agora.dia);
  if (dias === 0) return `Era às ${horaLocal(i.lembrar_em!)}`;
  if (dias === 1) return 'Atrasado desde ontem';
  return `Atrasado há ${dias} dias`;
}

export function planoDoDia(itens: ItemAgenda[], pendencias: Pendencia[], agora: Agora): Entrada[] {
  const fila: { pos: number; chaveOrdem: string; entrada: Entrada }[] = [];
  const empurrar = (pos: number, chaveOrdem: string, entrada: Entrada) => fila.push({ pos, chaveOrdem, entrada });

  for (const i of itens) {
    if (i.concluido_em || !i.lembrar_em) continue;
    const dia = diaLocal(i.lembrar_em);
    const hora = i.dia_inteiro ? null : horaLocal(i.lembrar_em);
    const base = { tipo: 'item' as const, chave: i.id, item: i };

    if (atrasado(i, agora)) {
      empurrar(i.prioridade === 1 ? 1 : 2, i.lembrar_em, { ...base, motivo: motivoDoAtraso(i, agora), tom: 'atrasado' });
      continue;
    }
    if (dia !== agora.dia) continue;

    const minutos = hora ? (Date.parse(i.lembrar_em) - agora.instante) / 60_000 : Infinity;
    if (minutos <= 60) {
      empurrar(3, i.lembrar_em, { ...base, motivo: `Daqui a ${Math.max(1, Math.round(minutos))} min · ${faixaDeHora(i, hora!)}`, tom: 'agora' });
    } else if (i.prioridade === 1) {
      empurrar(5, hora ?? '99', { ...base, motivo: hora ? `Prioridade alta · ${faixaDeHora(i, hora)}` : 'Prioridade alta', tom: 'normal' });
    } else if (i.prioridade === 3) {
      empurrar(8, hora ?? '99', { ...base, motivo: hora ? `Quando der · ${faixaDeHora(i, hora)}` : 'Quando der', tom: 'normal' });
    } else {
      empurrar(6, hora ?? '99', { ...base, motivo: hora ? (fimDe(i, hora) ? `Das ${hora} às ${fimDe(i, hora)}` : `Às ${hora}`) : 'Hoje', tom: 'normal' });
    }
  }

  for (const p of pendencias) {
    empurrar(p.grave ? 4 : 7, p.chave, { tipo: 'pendencia', chave: `pend:${p.chave}`, pendencia: p,
      motivo: p.grave ? 'Do sistema · importante' : 'Do sistema', tom: p.grave ? 'atrasado' : 'normal' });
  }

  return fila
    .sort((a, b) => a.pos - b.pos || a.chaveOrdem.localeCompare(b.chaveOrdem))
    .map((f) => f.entrada);
}

/** Uma ocorrência na linha do tempo — a real (o item) ou projetada (repetição futura). */
export type Ocorrencia = { item: ItemAgenda; dia: string; hora: string | null; projetada: boolean };

/**
 * Os próximos dias, de amanhã até `dias` à frente, com as repetições
 * projetadas: um item "toda segunda" aparece em todas as segundas do período,
 * e só a primeira é o item de verdade (a que se conclui).
 */
export function linhaDoTempo(itens: ItemAgenda[], agora: Agora, dias: number): { dia: string; ocorrencias: Ocorrencia[] }[] {
  const de = somarDias(agora.dia, 1);
  const ate = somarDias(agora.dia, dias);
  const porDia = new Map<string, Ocorrencia[]>();
  const incluir = (o: Ocorrencia) => porDia.set(o.dia, [...(porDia.get(o.dia) ?? []), o]);

  for (const i of itens) {
    if (i.concluido_em || !i.lembrar_em || atrasado(i, agora)) continue;
    const dia = diaLocal(i.lembrar_em);
    const hora = i.dia_inteiro ? null : horaLocal(i.lembrar_em);
    if (dia >= de && dia <= ate) incluir({ item: i, dia, hora, projetada: false });
    if (i.regra && i.vence_em) {
      const horaBase = i.dia_inteiro ? null : horaLocal(i.vence_em);
      const depois = somarDias(dia > agora.dia ? dia : agora.dia, 1);
      for (const d of ocorrencias(i.regra, depois < de ? de : depois, ate)) {
        incluir({ item: i, dia: d, hora: horaBase, projetada: true });
      }
    }
  }

  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, lista]) => ({
      dia,
      ocorrencias: lista.sort((a, b) => (a.hora ?? '99').localeCompare(b.hora ?? '99') || a.item.prioridade - b.item.prioridade),
    }));
}

export function agoraNoBrasil(): Agora {
  const d = new Date();
  return { dia: diaLocal(d), hora: horaLocal(d), instante: d.getTime() };
}
