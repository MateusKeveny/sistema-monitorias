import Link from '@/componentes/Link';
import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import { Quadro, Indicador, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { data as formatarData, diaMes, hojeNoBrasil } from '@/lib/formatar';
import { NOME_SISTEMA, type Sistema } from '@/lib/sistema';
import { NOMES_PAPEL, type PapelUsuario } from '@/lib/tipos';

const JANELA = 30;
const PARADO = 7;

type Acesso = { pessoa_id: string; dia: string; ultimo: string; aberturas: number };

/** Dia ('AAAA-MM-DD') e hora ('HH:MM') de um instante, no fuso da operação. */
function noBrasil(iso: string) {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { dia: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour')}:${v('minute')}` };
}

/** 'AAAA-MM-DD' deslocado em dias. */
function somarDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

/**
 * Acessos (1.37.0, migração 52): quem abre cada painel e com que frequência.
 *
 * Mora só no Performance, com um seletor para o Monitorias — o registro
 * acontece nos dois sistemas, a consulta fica num lugar só. O histórico começa
 * na publicação; para quem ainda não tem registro, aparece a data do último
 * login, que é o que existia antes.
 */
export default async function TelaAcessos({ sistema }: { sistema: Sistema }) {
  await exigirGestor();
  const db = await criarClienteServidor();

  const hoje = hojeNoBrasil();
  const inicio = somarDias(hoje, -(JANELA - 1));
  const [{ data: pessoas }, { data: cargos }, { data: historico }, { data: recentes },
    { data: ultimos }, { data: logins }, { data: tentativas }] = await Promise.all([
    db.from('pessoas').select('id, nome, papel').eq('ativo', true).not('auth_id', 'is', null).order('nome'),
    db.from('cargos').select('id, nome'),
    db.from('cargos_da_pessoa').select('pessoa_id, desde, cargo_id').lte('desde', hoje)
      .order('desde', { ascending: false }),
    db.from('acessos').select('pessoa_id, dia, ultimo, aberturas')
      .eq('sistema', sistema).gte('dia', inicio),
    db.from('vw_ultimo_acesso').select('pessoa_id, ultimo').eq('sistema', sistema),
    db.rpc('ultimo_login_das_pessoas'),
    // 4.11.0 (migração 110): tentativas de login dos últimos 7 dias (os dois sistemas).
    db.from('tentativas_login').select('chave, ip, sucesso, criado_em')
      .gte('criado_em', new Date(Date.now() - 7 * 86_400_000).toISOString()).order('criado_em', { ascending: false }).limit(2000)
      .then((r) => ({ data: r.data })),
  ]);

  // Erros de senha por usuário e endereço: quantos, o último, e se chegou a bloquear (5 seguidos).
  type Tentativa = { chave: string; ip: string; sucesso: boolean; criado_em: string };
  const erradas = new Map<string, { chave: string; ip: string; erros: number; ultimo: string; bloqueou: boolean; seguidos: number; fechou: boolean }>();
  for (const t of [...((tentativas ?? []) as Tentativa[])].reverse()) {
    const k = `${t.chave}|${t.ip}`;
    const g = erradas.get(k) ?? { chave: t.chave, ip: t.ip, erros: 0, ultimo: t.criado_em, bloqueou: false, seguidos: 0, fechou: false };
    if (t.sucesso) { g.seguidos = 0; } else { g.erros++; g.seguidos++; g.ultimo = t.criado_em; if (g.seguidos >= 5) g.bloqueou = true; }
    erradas.set(k, g);
  }
  const listaErradas = [...erradas.values()].filter((g) => g.erros > 0).sort((a, b) => b.ultimo.localeCompare(a.ultimo));

  // Cargo atual: o mais recente já em vigor. Quem não tem cargo (gestão,
  // qualidade) aparece pelo papel.
  const nomeDoCargo = new Map((cargos ?? []).map((c) => [c.id as number, c.nome as string]));
  const cargoDe = new Map<string, string>();
  for (const h of historico ?? []) {
    if (!cargoDe.has(h.pessoa_id)) cargoDe.set(h.pessoa_id, nomeDoCargo.get(h.cargo_id) ?? '');
  }

  const porPessoa = new Map<string, Acesso[]>();
  for (const a of (recentes ?? []) as Acesso[]) {
    (porPessoa.get(a.pessoa_id) ?? porPessoa.set(a.pessoa_id, []).get(a.pessoa_id)!).push(a);
  }
  const ultimoDe = new Map((ultimos ?? []).map((u) => [u.pessoa_id as string, u.ultimo as string]));
  const loginDe = new Map(((logins ?? []) as { pessoa_id: string; ultimo_login: string | null }[])
    .map((l) => [l.pessoa_id, l.ultimo_login]));

  const dias = Array.from({ length: JANELA }, (_, i) => somarDias(inicio, i));
  const linhas = ((pessoas ?? []) as { id: string; nome: string; papel: PapelUsuario }[]).map((p) => {
    const lista = porPessoa.get(p.id) ?? [];
    const ultimo = ultimoDe.get(p.id) ?? null;
    const quando = ultimo ? noBrasil(ultimo) : null;
    return {
      ...p,
      cargo: cargoDe.get(p.id) || NOMES_PAPEL[p.papel],
      ultimo,
      quando,
      atras: quando ? diasEntre(quando.dia, hoje) : null,
      comAcesso: new Set(lista.map((a) => a.dia)),
      aberturas: lista.reduce((s, a) => s + a.aberturas, 0),
      login: loginDe.get(p.id) ?? null,
    };
  }).sort((a, b) => (b.ultimo ?? '').localeCompare(a.ultimo ?? '') || a.nome.localeCompare(b.nome));

  const hojeN = linhas.filter((l) => l.atras === 0).length;
  const semana = linhas.filter((l) => l.atras != null && l.atras < PARADO).length;
  const parados = linhas.filter((l) => l.atras != null && l.atras >= PARADO).length;
  const nunca = linhas.filter((l) => l.atras == null).length;

  const quandoRelativo = (atras: number) =>
    atras === 0 ? 'hoje' : atras === 1 ? 'ontem' : `há ${atras} dias`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-sobre-fundo-suave">
            Quem abre o {NOME_SISTEMA[sistema]} e com que frequência · {linhas.length} pessoas com login
          </p>
        </div>
        {/* Os dois sistemas, cada um com a sua lista. */}
        <div role="tablist" className="inline-flex gap-1 rounded-full border border-slate-200 bg-superficie p-1 shadow-sm">
          {(['cota', 'monitorias'] as const).map((s) => (
            <Link key={s} href={s === 'cota' ? '/cota/usuarios?cat=acessos' : '/cota/usuarios?cat=acessos&sistema=monitorias'}
                  role="tab" aria-selected={s === sistema}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${s === sistema
                    ? 'bg-marca-600 font-semibold text-white'
                    : 'text-slate-600 hover:text-slate-900'}`}>
              {s === 'cota' ? 'Performance' : 'Monitorias'}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Acessaram hoje" valor={String(hojeN)} tom={hojeN ? 'bom' : 'neutro'}
                   detalhe={`de ${linhas.length} com login`} />
        <Indicador rotulo={`Nos últimos ${PARADO} dias`} valor={String(semana)} detalhe="pelo menos um acesso" />
        <Indicador rotulo={`Há mais de ${PARADO} dias sem entrar`} valor={String(parados)}
                   tom={parados ? 'alerta' : 'neutro'} detalhe="último acesso antigo" />
        <Indicador rotulo="Sem acesso registrado" valor={String(nunca)} tom={nunca ? 'alerta' : 'neutro'}
                   detalhe="desde 07/10/2026, início do registro" />
      </div>

      <Quadro titulo="Quem acessa" acao={<span className="text-xs text-slate-500">ordenado pelo último acesso</span>}>
        {linhas.length === 0 ? (
          <Vazio>Ninguém com login ativo.</Vazio>
        ) : (
          <>
            <Tabela noQuadro>
              <thead>
                <tr>
                  <Th>Pessoa</Th>
                  <Th>Último acesso</Th>
                  <Th>Últimos {JANELA} dias</Th>
                  <Th className="text-right">Dias com acesso</Th>
                  <Th className="text-right">Aberturas</Th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <Td>
                      <span className="font-medium text-slate-900">{l.nome}</span>
                      <span className="block text-xs text-slate-500">{l.cargo}</span>
                    </Td>
                    <Td>
                      {l.quando && l.atras != null ? (
                        <>
                          <span className="text-slate-900">{quandoRelativo(l.atras)}, {l.quando.hora}</span>
                          {l.atras >= PARADO && (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                              parado
                            </span>
                          )}
                          <span className="block text-xs text-slate-500">{formatarData(l.quando.dia)}</span>
                        </>
                      ) : (
                        <>
                          {l.login
                            ? <span className="text-slate-500">Sem acesso registrado</span>
                            : <span className="font-medium text-rose-700">Nunca entrou</span>}
                          <span className="block text-xs text-slate-400">
                            {l.login ? `último login em ${formatarData(noBrasil(l.login).dia)}` : 'nunca fez login'}
                          </span>
                        </>
                      )}
                    </Td>
                    <Td>
                      <span className="inline-flex gap-0.5 align-middle">
                        {dias.map((d) => {
                          const sem = new Date(`${d}T12:00:00Z`).getUTCDay();
                          const fds = sem === 0 || sem === 6;
                          return (
                            <i key={d} title={diaMes(d)}
                               className={`block h-4 w-1.5 rounded-sm ${l.comAcesso.has(d)
                                 ? 'bg-marca-600' : 'bg-slate-100'} ${fds ? 'opacity-50' : ''}`} />
                          );
                        })}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {l.comAcesso.size ? `${l.comAcesso.size} de ${JANELA}` : '—'}
                    </Td>
                    <Td className="text-right tabular-nums">{l.aberturas || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              <strong>Dias com acesso</strong> é em quantos dos últimos {JANELA} dias a pessoa abriu o painel;
              {' '}<strong>aberturas</strong> é quantas vezes no total, no mesmo período — cada carregamento
              do painel conta uma vez, a troca de tela dentro dele não. O registro começou em 07/10/2026;
              para quem ainda não tem acesso registrado, aparece em cinza a data do último login.
            </p>
          </>
        )}
      </Quadro>

      {/* 4.11.0: senhas erradas na tela de login (Performance e Monitorias). */}
      <Quadro titulo="Tentativas de login erradas"
              subtitulo="Últimos 7 dias. Depois de 1 erro a tela pede uma verificação; com 5 erros seguidos o acesso daquele usuário, naquele endereço, fica bloqueado por 15 minutos.">
        {listaErradas.length === 0 ? (
          <Vazio>Nenhuma senha errada nos últimos 7 dias.</Vazio>
        ) : (
          <Tabela noQuadro>
            <thead>
              <tr><Th>Usuário digitado</Th><Th>Endereço de rede</Th><Th className="text-right">Erros</Th><Th>Último erro</Th><Th>Situação</Th></tr>
            </thead>
            <tbody>
              {listaErradas.map((g) => {
                const q = noBrasil(g.ultimo);
                const bloqueadoAgora = g.seguidos >= 5 && Date.parse(g.ultimo) + 15 * 60_000 > Date.now();
                return (
                  <tr key={`${g.chave}|${g.ip}`}>
                    <Td className="font-medium text-slate-900">{g.chave.replace(/@painel\.interno$/, '')}</Td>
                    <Td className="text-slate-600 tabular-nums">{g.ip}</Td>
                    <Td className="text-right tabular-nums">{g.erros}</Td>
                    <Td className="whitespace-nowrap">{formatarData(q.dia)}, {q.hora}</Td>
                    <Td>
                      {bloqueadoAgora
                        ? <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-700">bloqueado agora</span>
                        : g.bloqueou
                          ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-800">chegou a bloquear</span>
                          : g.seguidos === 0
                            ? <span className="text-xs text-slate-500">entrou depois</span>
                            : <span className="text-xs text-slate-500">{g.seguidos} erro{g.seguidos > 1 ? 's' : ''} seguido{g.seguidos > 1 ? 's' : ''}</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabela>
        )}
      </Quadro>
    </div>
  );
}
