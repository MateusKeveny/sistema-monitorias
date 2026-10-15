/**
 * Férias: as regras dos avisos, iguais no Performance, na agenda e no resumo
 * do dia (61-ferias.sql e supabase/agenda/04-minhas-ferias.sql).
 *
 * Puro, sem banco: recebe os períodos e o dia de hoje ('AAAA-MM-DD').
 */

export type PeriodoDeFerias = {
  id: string;
  pessoa: string;
  inicio: string;
  fim: string;
  situacao?: 'planejada' | 'aprovada';
  /** As do próprio usuário da agenda. */
  minha?: boolean;
};

export type PrazoDeFerias = {
  pessoa: string;
  limite: string;
  saldo: number;
  /** Dias até o limite; negativo = venceu. */
  dias: number;
  completo: boolean;
};

export type AvisoDeFerias = { chave: string; texto: string; grave: boolean; dia?: string };

const dia = 86_400_000;
export const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / dia);
export const somar = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * dia).toISOString().slice(0, 10);
export const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const duracao = (p: { inicio: string; fim: string }) => diasEntre(p.inicio, p.fim) + 1;

const quem = (p: PeriodoDeFerias) => (p.minha ? 'Você' : p.pessoa.split(/\s+/).slice(0, 2).join(' '));

/** Quem está fora num dia. */
export const foraNoDia = (lista: PeriodoDeFerias[], d: string) => lista.filter((p) => p.inicio <= d && p.fim >= d);

/**
 * Pares de pessoas diferentes fora ao mesmo tempo, com o trecho comum.
 * Só os que ainda não terminaram.
 */
export function sobreposicoes(lista: PeriodoDeFerias[], hoje: string) {
  const vivos = lista.filter((p) => p.fim >= hoje).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const pares: { a: PeriodoDeFerias; b: PeriodoDeFerias; inicio: string; fim: string }[] = [];
  for (let i = 0; i < vivos.length; i++) {
    for (let j = i + 1; j < vivos.length; j++) {
      const a = vivos[i]; const b = vivos[j];
      if (b.inicio > a.fim) break;
      if (a.pessoa === b.pessoa && !!a.minha === !!b.minha) continue;
      pares.push({ a, b, inicio: b.inicio > a.inicio ? b.inicio : a.inicio, fim: a.fim < b.fim ? a.fim : b.fim });
    }
  }
  return pares;
}

const emDias = (n: number) => (n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`);

/**
 * Os avisos de férias.
 *
 * `modo` muda só a janela: na tela vale tudo o que está perto; no resumo do
 * dia, para não repetir a mesma frase todo dia por meses, o prazo de 90 e de
 * 60 dias aparece só em três dias de cada marco (cobre o fim de semana sem
 * resumo), e o de 30 dias para baixo, todo dia.
 */
export function avisosDeFerias(lista: PeriodoDeFerias[], prazos: PrazoDeFerias[], hoje: string,
  modo: 'tela' | 'resumo' = 'tela'): AvisoDeFerias[] {
  const avisos: AvisoDeFerias[] = [];
  const janelaSaida = 7;

  for (const p of lista) {
    const ate = diasEntre(hoje, p.inicio);
    const volta = somar(p.fim, 1);
    const ateVolta = diasEntre(hoje, volta);
    const planejada = p.situacao === 'planejada' ? ' (planejada)' : '';
    if (ate >= 0 && ate <= janelaSaida) {
      avisos.push({
        chave: `sai:${p.id}`, dia: p.inicio, grave: ate <= 1,
        texto: `${quem(p)} sai de férias ${emDias(ate)}${ate > 1 ? ` (${ddmm(p.inicio)})` : ''} · ${duracao(p)} dias, até ${ddmm(p.fim)}${planejada}`,
      });
    } else if (ate < 0 && ateVolta >= 0 && ateVolta <= 2) {
      avisos.push({
        chave: `volta:${p.id}`, dia: volta, grave: false,
        texto: `${quem(p)} volta ${emDias(ateVolta)}${ateVolta > 1 ? ` (${ddmm(volta)})` : ''}`,
      });
    }
  }

  // Duas pessoas fora juntas: na tela, nos próximos 60 dias; no resumo, só
  // quando o trecho comum começa em até 7 dias.
  const limiteSobreposicao = modo === 'tela' ? 60 : janelaSaida;
  for (const s of sobreposicoes(lista, hoje)) {
    const ate = diasEntre(hoje, s.inicio);
    if (ate > limiteSobreposicao) continue;
    const comVoce = s.a.minha || s.b.minha;
    avisos.push({
      chave: `junto:${s.a.id}:${s.b.id}`, dia: s.inicio, grave: comVoce || ate <= 7,
      texto: `${quem(s.a)} e ${quem(s.b).replace(/^Você$/, 'você')} fora ao mesmo tempo: ${s.inicio === s.fim ? `em ${ddmm(s.inicio)}` : `${ddmm(s.inicio)} a ${ddmm(s.fim)}`}`
        + (ate > 0 ? ` (${emDias(ate)})` : ate <= 0 && s.fim >= hoje ? ' (agora)' : ''),
    });
  }

  for (const z of prazos) {
    if (z.saldo <= 0) continue;
    const marco = modo === 'tela' ? z.dias <= 90
      : z.dias <= 30 || (z.dias <= 90 && z.dias > 87) || (z.dias <= 60 && z.dias > 57);
    if (!marco) continue;
    const nome = z.pessoa.split(/\s+/).slice(0, 2).join(' ');
    avisos.push({
      chave: `prazo:${z.pessoa}`, dia: z.limite, grave: z.dias <= 30,
      texto: z.dias < 0
        ? `Férias vencidas: ${nome}, ${z.saldo} dias desde ${ddmm(z.limite)} (pagamento em dobro)`
        : `Prazo de férias: ${nome} precisa sair até ${ddmm(z.limite)} (${z.dias} dias) · ${z.saldo} dias a tirar`,
    });
  }

  return avisos.sort((a, b) => Number(b.grave) - Number(a.grave) || (a.dia ?? '').localeCompare(b.dia ?? ''));
}
