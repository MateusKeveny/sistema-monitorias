-- ============================================================================
-- 98 · Aprovação das cotas pela diretoria (Performance 4.0.0)
--
-- A cota fechada do mês ia para a CEO por fora; ela aprovava ou recusava por
-- equipe. Agora ela tem acesso próprio e decide pessoa a pessoa, no painel:
--
--   · Papel novo `diretoria`: vê o resumo do fechamento de todos os setores e
--     o extrato congelado de cada pessoa — só pontos, nunca valores em R$. Não
--     lança, não edita, não fecha; fica fora de listas, rankings e médias.
--     Não ganha leitura nas tabelas: tudo o que ela vê sai pelas funções
--     abaixo (security definer), que conferem o papel. As políticas atuais não
--     mudam.
--   · `aprovacoes_cota`: cada decisão (aprovado / recusado com motivo) sobre
--     um fechamento. A última decisão do fechamento atual vale; sem decisão, é
--     pendente. Reabrir apaga o fechamento (migração 22) e o novo volta como
--     pendente — a recusa anterior fica no histórico, pela pessoa e o mês.
--   · Avisos no sino (sem Teams): para a CEO quando o gestor fecha o mês (ou refaz o
--     fechamento de uma pessoa já decidida); para os gestores do setor quando
--     ela recusa alguém, e quando o setor fica todo aprovado.
--   · Conta de diretoria: só o administrador cria (ela enxerga todos os
--     setores), por `criar_acesso_diretoria`.
--
-- Aditiva: não mexe em cálculo, fechamento nem nas políticas existentes.
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro. Pode rodar de novo.
-- ============================================================================

-- ---------------------------------------------------------------- 1. O papel
alter table public.pessoas drop constraint if exists pessoas_papel_check;
alter table public.pessoas add constraint pessoas_papel_check
  check (papel in ('administrador', 'gestor', 'qualidade', 'operador', 'diretoria'));

create or replace function public.eh_diretoria() returns boolean language sql stable as $$
  select coalesce(public.papel_atual() = 'diretoria', false);
$$;

-- -------------------------------------------------------- 2. As decisões
create table if not exists public.aprovacoes_cota (
  id               bigint generated always as identity primary key,
  -- Sem chave estrangeira de propósito: reabrir apaga o fechamento, e a
  -- decisão sobre a versão anterior continua no histórico.
  fechamento_id    uuid not null,
  pessoa_id        uuid not null references public.pessoas (id) on delete cascade,
  pessoa_nome      text,
  mes_competencia  date not null,
  setor_id         smallint not null default 1,
  resultado        numeric(14,4),
  -- 'respondido': o gestor respondeu à recusa (texto em `motivo`); volta para a CEO decidir.
  situacao         text not null check (situacao in ('aprovado', 'recusado', 'respondido')),
  motivo           text,
  decidido_por     uuid references public.pessoas (id) on delete set null,
  decidido_por_nome text,
  decidido_em      timestamptz not null default now(),
  check (situacao = 'aprovado' or coalesce(btrim(motivo), '') <> '')
);
-- Quem rodou a versão anterior desta migração: a resposta do gestor entra no check.
alter table public.aprovacoes_cota drop constraint if exists aprovacoes_cota_situacao_check;
alter table public.aprovacoes_cota add constraint aprovacoes_cota_situacao_check
  check (situacao in ('aprovado', 'recusado', 'respondido'));
create index if not exists aprovacoes_cota_fech_idx on public.aprovacoes_cota (fechamento_id, decidido_em desc);
create index if not exists aprovacoes_cota_mes_idx on public.aprovacoes_cota (mes_competencia, setor_id);

alter table public.aprovacoes_cota enable row level security;
-- O gestor lê as decisões das pessoas do seu setor (o administrador, todas);
-- a diretoria lê pelas funções. Ninguém grava direto: só por decidir_cota.
drop policy if exists aprovacoes_cota_leitura on public.aprovacoes_cota;
create policy aprovacoes_cota_leitura on public.aprovacoes_cota
  for select using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
grant select on public.aprovacoes_cota to authenticated;

-- A decisão que vale para cada fechamento atual.
create or replace view public.vw_aprovacao_atual with (security_invoker = true) as
select distinct on (a.fechamento_id)
       a.fechamento_id, a.pessoa_id, a.mes_competencia, a.setor_id, a.situacao, a.motivo,
       a.decidido_por_nome, a.decidido_em
  from public.aprovacoes_cota a
  join public.fechamentos_cota f on f.id = a.fechamento_id
 order by a.fechamento_id, a.decidido_em desc, a.id desc;
grant select on public.vw_aprovacao_atual to authenticated;

-- --------------------------------------------- 3. O painel da diretoria
-- O primeiro mês que passa pela aprovação. Os fechamentos de antes não
-- entram na lista da diretoria (seguiram o fluxo antigo, por fora), mas
-- contam na comparação dos 3 meses. Para mudar: recriar esta função.
create or replace function public.inicio_da_aprovacao() returns date
language sql immutable as $$ select date '2026-11-01' $$;

-- Os meses com fechamento, a partir do início (e os anteriores com cota
-- aprovada, para consultar), do mais novo, com quantos aguardam decisão.
-- (A versão anterior não tinha `aprovadas`: muda o retorno, então sai antes.)
drop function if exists public.meses_para_aprovar();
create or replace function public.meses_para_aprovar()
returns table (mes_competencia date, pessoas integer, pendentes integer, aprovadas integer)
language sql stable security definer set search_path = public as $$
  select f.mes_competencia, count(*)::int,
         -- Aguardando: sem decisão, ou recusada e já respondida pelo gestor.
         count(*) filter (where coalesce(a.situacao, 'respondido') = 'respondido')::int,
         count(*) filter (where a.situacao = 'aprovado')::int
    from fechamentos_cota f
    left join vw_aprovacao_atual a on a.fechamento_id = f.id
   where (public.eh_diretoria() or public.eh_gestor())
     -- A partir do início; antes dele, só o que já tiver sido aprovado (para consultar).
     and (f.mes_competencia >= public.inicio_da_aprovacao() or a.situacao = 'aprovado')
   group by f.mes_competencia
   order by f.mes_competencia desc;
$$;

-- As pessoas que contam no panorama de um setor num mês: todas as do setor
-- (não só quem pontua), sem perfil de teste, administrador e diretoria.
create or replace function public.pessoas_do_panorama(p_setor smallint, p_mes date)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}') from pessoas p
   where public.setor_na_competencia(p.id, p_mes) = p_setor
     and not p.perfil_de_teste and p.papel not in ('administrador', 'diretoria');
$$;
revoke all on function public.pessoas_do_panorama(smallint, date) from public, anon, authenticated;

-- Os números de um setor num mês, para a comparação dos 3 meses (4.0.0):
-- atendimentos, avaliações, pontos do fechamento, quantos bateram a meta e o
-- C-SAT do mês por canal. `fechado` = o setor já fechou o mês.
create or replace function public.numeros_do_setor_no_mes(p_setor smallint, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_pessoas uuid[] := public.pessoas_do_panorama(p_setor, p_mes);
begin
  return jsonb_build_object(
    'mes', p_mes,
    'fechado', exists (select 1 from fechamentos_cota where mes_competencia = p_mes and setor_id = p_setor),
    'atendimentos', (select coalesce(sum(finalizados), 0) from volume_semanal
                      where mes_competencia = p_mes and pessoa_id = any (v_pessoas)),
    'avaliacoes', (select coalesce(sum(avaliacoes), 0) from vw_csat_semanal
                    where mes_competencia = p_mes and pessoa_id = any (v_pessoas)),
    'positivas', (select coalesce(sum(positivas), 0) from vw_csat_semanal
                   where mes_competencia = p_mes and pessoa_id = any (v_pessoas)),
    'pontos', (select coalesce(sum(resultado), 0) from fechamentos_cota where mes_competencia = p_mes and setor_id = p_setor),
    'pessoas', (select count(*) from fechamentos_cota where mes_competencia = p_mes and setor_id = p_setor),
    'bateram', (select count(*) from fechamentos_cota where mes_competencia = p_mes and setor_id = p_setor
                   and meta is not null and resultado >= meta),
    'csat_canal', (select coalesce(jsonb_agg(jsonb_build_object('canal', x.canal, 'avaliacoes', x.av, 'positivas', x.pos)
                                             order by x.ordem), '[]')
                     from (select coalesce(c.nome, 'Outros') as canal, coalesce(c.ordem, 999) as ordem,
                                  sum(v2.avaliacoes) as av, sum(v2.positivas) as pos
                             from vw_csat_semanal v2 left join canais_do_setor c on c.id = v2.canal_id
                            where v2.mes_competencia = p_mes and v2.pessoa_id = any (v_pessoas)
                            group by 1, 2) x)
  );
end;
$$;
revoke all on function public.numeros_do_setor_no_mes(smallint, date) from public, anon, authenticated;

-- Tudo o que a tela da diretoria mostra de um mês, um item por setor ativo
-- (quem ainda não fechou vem com `fechado` falso e sem pessoas): números do
-- mês, C-SAT por canal e semana, os 3 últimos meses e cada pessoa com a
-- decisão e os pontos dos 2 meses anteriores. Só pontos. Atendimentos e
-- avaliações são de todas as pessoas do setor no mês (o panorama geral).
create or replace function public.painel_da_diretoria(p_mes date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := '[]'::jsonb;
  s record;
  v_pessoas uuid[];
begin
  if not (public.eh_diretoria() or public.eh_admin()) then
    raise exception 'Só a CEO vê esta tela.';
  end if;

  for s in
    select st.id, st.nome,
           (select min(f.fechado_em) from fechamentos_cota f where f.mes_competencia = p_mes and f.setor_id = st.id) as fechado_em,
           (select f.fechado_por_nome from fechamentos_cota f where f.mes_competencia = p_mes and f.setor_id = st.id
             order by f.fechado_em limit 1) as fechado_por,
           (select string_agg(g.nome, ', ' order by g.nome) from pessoas g
             where g.papel = 'gestor' and g.ativo and public.setor_na_competencia(g.id, p_mes) = st.id) as gestores
      from setores st
     where st.ativo or exists (select 1 from fechamentos_cota f where f.mes_competencia = p_mes and f.setor_id = st.id)
     order by st.ordem, st.id
  loop
    v_pessoas := public.pessoas_do_panorama(s.id, p_mes);

    v := v || jsonb_build_array(jsonb_build_object(
      'id', s.id, 'nome', s.nome, 'fechado', s.fechado_em is not null,
      'fechado_em', s.fechado_em, 'fechado_por', s.fechado_por, 'gestores', s.gestores,
      'tres_meses', (select jsonb_agg(public.numeros_do_setor_no_mes(s.id, (p_mes - make_interval(months => k))::date) order by k desc)
                       from generate_series(0, 2) k),
      'atendimentos', (select coalesce(sum(finalizados), 0) from volume_semanal
                        where mes_competencia = p_mes and pessoa_id = any (v_pessoas)),
      'avaliacoes', (select coalesce(sum(avaliacoes), 0) from vw_csat_semanal
                      where mes_competencia = p_mes and pessoa_id = any (v_pessoas)),
      'positivas', (select coalesce(sum(positivas), 0) from vw_csat_semanal
                     where mes_competencia = p_mes and pessoa_id = any (v_pessoas)),
      'csat_semanal', (
        select coalesce(jsonb_agg(jsonb_build_object('canal', x.canal, 'semana', x.semana,
                                                     'avaliacoes', x.av, 'positivas', x.pos)
                                  order by x.ordem, x.semana), '[]')
          from (select coalesce(c.nome, 'Outros') as canal, coalesce(c.ordem, 999) as ordem, v2.semana,
                       sum(v2.avaliacoes) as av, sum(v2.positivas) as pos
                  from vw_csat_semanal v2
                  left join canais_do_setor c on c.id = v2.canal_id
                 where v2.mes_competencia = p_mes and v2.pessoa_id = any (v_pessoas)
                 group by 1, 2, 3) x),
      'pessoas', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'fechamento_id', f.id, 'pessoa_id', f.pessoa_id, 'nome', f.pessoa_nome, 'cargo', f.cargo,
                 'pontos', f.resultado,
                 -- A meta não aparece na tela; só a situação em relação a ela.
                 'situacao_meta', case when f.meta is null or f.meta = 0 then null
                                       when f.resultado >= f.meta then 'atingida'
                                       when f.resultado >= f.meta * 0.7 then 'proxima'
                                       else 'abaixo' end,
                 'decisao', a.situacao, 'motivo', a.motivo, 'decidido_em', a.decidido_em,
                 -- Respondida: o motivo da recusa que o gestor respondeu.
                 'recusa', (select r.motivo from aprovacoes_cota r where r.fechamento_id = f.id and r.situacao = 'recusado'
                             order by r.decidido_em desc, r.id desc limit 1),
                 -- Os fechamentos dos 2 meses anteriores, para abrir o extrato de cada um.
                 'anteriores_ids', (select jsonb_agg((select a3.id from fechamentos_cota a3
                                                       where a3.pessoa_id = f.pessoa_id
                                                         and a3.mes_competencia = (p_mes - make_interval(months => k))::date)
                                                     order by k desc)
                                      from generate_series(1, 2) k),
                 'recusas_anteriores', (select count(*) from aprovacoes_cota h
                                         where h.pessoa_id = f.pessoa_id and h.mes_competencia = p_mes
                                           and h.situacao = 'recusado' and h.fechamento_id <> f.id),
                 -- Os pontos fechados dos 2 meses anteriores (null = sem fechamento).
                 'anteriores', (select jsonb_agg((select a2.resultado from fechamentos_cota a2
                                                   where a2.pessoa_id = f.pessoa_id
                                                     and a2.mes_competencia = (p_mes - make_interval(months => k))::date)
                                                 order by k desc)
                                  from generate_series(1, 2) k))
                 order by f.pessoa_nome), '[]')
          from fechamentos_cota f
          left join vw_aprovacao_atual a on a.fechamento_id = f.id
         where f.mes_competencia = p_mes and f.setor_id = s.id)
    ));
  end loop;
  return v;
end;
$$;

-- O extrato congelado de uma pessoa: as linhas do fechamento, em pontos.
create or replace function public.extrato_para_diretoria(p_fechamento uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f fechamentos_cota;
begin
  if not (public.eh_diretoria() or public.eh_admin()) then
    raise exception 'Só a CEO vê esta tela.';
  end if;
  select * into f from fechamentos_cota where id = p_fechamento;
  if not found then return null; end if;
  return jsonb_build_object(
    'fechamento_id', f.id, 'pessoa_id', f.pessoa_id, 'nome', f.pessoa_nome, 'cargo', f.cargo,
    'mes', f.mes_competencia, 'pontos', f.resultado, 'fechado_em', f.fechado_em,
    'setor', (select nome from setores where id = f.setor_id),
    'decisao', (select jsonb_build_object('situacao', a.situacao, 'motivo', a.motivo, 'em', a.decidido_em)
                  from vw_aprovacao_atual a where a.fechamento_id = f.id),
    'historico', (select coalesce(jsonb_agg(jsonb_build_object('situacao', h.situacao, 'motivo', h.motivo,
                                                              'em', h.decidido_em, 'pontos', h.resultado)
                                            order by h.decidido_em desc), '[]')
                    from aprovacoes_cota h
                   where h.pessoa_id = f.pessoa_id and h.mes_competencia = f.mes_competencia
                     and h.fechamento_id <> f.id),
    -- A pessoa nos 3 últimos meses (4.0.0), do mais antigo ao deste fechamento.
    -- O que aconteceu com ESTE fechamento: recusas e respostas, da mais antiga.
    'conversa', (select coalesce(jsonb_agg(jsonb_build_object('situacao', c.situacao, 'texto', c.motivo,
                                                             'em', c.decidido_em, 'por', c.decidido_por_nome)
                                           order by c.decidido_em, c.id), '[]')
                   from aprovacoes_cota c where c.fechamento_id = f.id and c.situacao <> 'aprovado'),
    'meses', (select jsonb_agg(jsonb_build_object(
                'mes', m.mes,
                'fechamento_id', (select a.id from fechamentos_cota a where a.pessoa_id = f.pessoa_id and a.mes_competencia = m.mes),
                'pontos', (select a.resultado from fechamentos_cota a where a.pessoa_id = f.pessoa_id and a.mes_competencia = m.mes),
                'situacao_meta', (select case when a.meta is null or a.meta = 0 then null when a.resultado >= a.meta then 'atingida'
                                              when a.resultado >= a.meta * 0.7 then 'proxima' else 'abaixo' end
                                    from fechamentos_cota a where a.pessoa_id = f.pessoa_id and a.mes_competencia = m.mes),
                'atendimentos', (select coalesce(sum(finalizados), 0) from volume_semanal
                                  where pessoa_id = f.pessoa_id and mes_competencia = m.mes),
                'avaliacoes', (select coalesce(sum(avaliacoes), 0) from vw_csat_semanal
                                where pessoa_id = f.pessoa_id and mes_competencia = m.mes),
                'positivas', (select coalesce(sum(positivas), 0) from vw_csat_semanal
                               where pessoa_id = f.pessoa_id and mes_competencia = m.mes))
                order by m.mes)
                from (select (f.mes_competencia - make_interval(months => k))::date as mes from generate_series(0, 2) k) m),
    'linhas', (select coalesce(jsonb_agg(jsonb_build_object(
                 'semana', l.semana, 'rotulo', l.rotulo, 'grupo', l.grupo,
                 'quantidade', l.quantidade, 'peso', l.peso, 'pontos', l.cota)
                 order by l.semana nulls last, l.ordem, l.id), '[]')
                 from fechamento_linhas l where l.fechamento_id = f.id)
  );
end;
$$;

-- ------------------------------------------------------------ 4. Decidir
-- Aprova ou recusa uma ou mais pessoas. Recusar exige motivo. Pode mudar a
-- recusa depois (vale a última); a aprovação é final.
create or replace function public.decidir_cota(p_fechamentos uuid[], p_situacao text, p_motivo text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_nome   text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  f        record;
  v_n      integer := 0;
  v_id     bigint;
  v_setor  record;
begin
  if public.eh_diretoria() is not true then
    raise exception 'Só a CEO aprova ou recusa a cota.';
  end if;
  if p_situacao not in ('aprovado', 'recusado') then
    raise exception 'Decisão inválida.';
  end if;
  if p_situacao = 'recusado' and v_motivo is null then
    raise exception 'Informe o motivo da recusa.';
  end if;
  select nome into v_nome from pessoas where id = public.pessoa_atual();

  -- Já aprovada não volta (a aprovação é final; ver trava_cota_aprovada).
  if exists (select 1 from vw_aprovacao_atual a where a.fechamento_id = any (p_fechamentos) and a.situacao = 'aprovado') then
    raise exception 'Cota aprovada está finalizada: a decisão não pode ser alterada.';
  end if;

  for f in select * from fechamentos_cota where id = any (p_fechamentos)
                                           and mes_competencia >= public.inicio_da_aprovacao() loop
    insert into aprovacoes_cota (fechamento_id, pessoa_id, pessoa_nome, mes_competencia, setor_id, resultado,
                                 situacao, motivo, decidido_por, decidido_por_nome)
    values (f.id, f.pessoa_id, f.pessoa_nome, f.mes_competencia, f.setor_id, f.resultado,
            p_situacao, case when p_situacao = 'recusado' then v_motivo end,
            public.pessoa_atual(), v_nome)
    returning id into v_id;
    v_n := v_n + 1;

    if p_situacao = 'recusado' then
      insert into avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
      select g.id, format('recusa/%s/%s', v_id, g.id),
             format('Cota de %s recusada (%s)', f.pessoa_nome, public.nome_do_mes(f.mes_competencia)),
             'Motivo: ' || v_motivo,
             '/cota/fechamento?mes=' || to_char(f.mes_competencia, 'YYYY-MM')
        from pessoas g
       where g.papel = 'gestor' and g.ativo and g.auth_id is not null
         and public.setor_na_competencia(g.id, f.mes_competencia) = f.setor_id
      on conflict (chave) do nothing;
    end if;
  end loop;

  -- Setor todo aprovado: avisa os gestores dele.
  -- (fc, e não f: f é a variável do laço acima.)
  for v_setor in
    select fc.mes_competencia, fc.setor_id
      from fechamentos_cota fc
     where fc.id = any (p_fechamentos)
     group by 1, 2
    having not exists (select 1 from fechamentos_cota x
                         left join vw_aprovacao_atual a on a.fechamento_id = x.id
                        where x.mes_competencia = fc.mes_competencia and x.setor_id = fc.setor_id
                          and coalesce(a.situacao, '') <> 'aprovado')
  loop
    insert into avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
    select g.id, format('aprovado/%s/%s/%s/%s', to_char(v_setor.mes_competencia, 'YYYY-MM'), v_setor.setor_id,
                        g.id, to_char(now(), 'YYYYMMDDHH24MISS')),
           format('Cotas de %s aprovadas', public.nome_do_mes(v_setor.mes_competencia)),
           'A CEO aprovou todas as pessoas do fechamento.',
           '/cota/fechamento?mes=' || to_char(v_setor.mes_competencia, 'YYYY-MM')
      from pessoas g
     where g.papel = 'gestor' and g.ativo and g.auth_id is not null
       and public.setor_na_competencia(g.id, v_setor.mes_competencia) = v_setor.setor_id
    on conflict (chave) do nothing;
  end loop;

  return v_n;
end;
$$;

-- ------------------------------------- 4a. A aprovação é a chave final
-- Aprovada pela CEO, a cota não muda mais: nem ajuste, nem reabertura (que
-- apaga o fechamento), nem nova decisão. A trava fica na tabela, para valer
-- por qualquer caminho.
create or replace function public.trava_cota_aprovada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select situacao from vw_aprovacao_atual where fechamento_id = old.id) = 'aprovado' then
    raise exception 'A cota de % já foi aprovada pela CEO e está finalizada: sem correção nem reabertura.', old.pessoa_nome;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trava_cota_aprovada on public.fechamentos_cota;
create trigger trava_cota_aprovada before update or delete on public.fechamentos_cota
  for each row execute function public.trava_cota_aprovada();

-- -------------------------------------------- 4b. A resposta do gestor
-- Recusada a cota, o gestor responde de um destes jeitos, e ela volta para a
-- CEO decidir de novo, com a resposta à vista e aviso no sino:
--   · Responder (só o texto, sem mudar números): responder_recusa;
--   · Correção › ajustar pontos ou meta: o ajuste vale como resposta (gatilho
--     em fechamento_alteracoes), com o motivo do ajuste e os valores;
--   · reabrir e fechar de novo: o fechamento novo chega como "refeito"
--     (aviso_para_aprovar, abaixo).
create or replace function public.registrar_resposta(p_fechamento uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
declare
  f        fechamentos_cota;
  v_atual  record;
  v_nome   text;
  v_id     bigint;
  v_texto  text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  select * into f from fechamentos_cota where id = p_fechamento;
  if not found then raise exception 'Fechamento não encontrado.'; end if;
  select * into v_atual from vw_aprovacao_atual where fechamento_id = p_fechamento;
  if coalesce(v_atual.situacao, '') <> 'recusado' then
    raise exception 'Esta cota não está recusada pela CEO.';
  end if;
  if v_texto is null then raise exception 'Escreva a resposta para a CEO.'; end if;
  select nome into v_nome from pessoas where id = public.pessoa_atual();

  insert into aprovacoes_cota (fechamento_id, pessoa_id, pessoa_nome, mes_competencia, setor_id, resultado,
                               situacao, motivo, decidido_por, decidido_por_nome)
  values (f.id, f.pessoa_id, f.pessoa_nome, f.mes_competencia, f.setor_id, f.resultado,
          'respondido', v_texto, public.pessoa_atual(), coalesce(v_nome, 'Gestor'))
  returning id into v_id;

  -- O aviso da recusa, para os gestores, sai do sino: já foi atendido.
  update avisos_da_pessoa set lido_em = now()
   where lido_em is null and chave like 'recusa/' || (
     select r.id from aprovacoes_cota r where r.fechamento_id = f.id and r.situacao = 'recusado'
      order by r.decidido_em desc, r.id desc limit 1)::text || '/%';

  insert into avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
  select d.id, format('resposta/%s/%s', v_id, d.id),
         format('Recusa de %s respondida (%s)', f.pessoa_nome, public.nome_do_mes(f.mes_competencia)),
         coalesce(v_nome, 'O gestor') || ': ' || v_texto,
         '/cota/aprovacao?mes=' || to_char(f.mes_competencia, 'YYYY-MM') || '&f=' || f.id
    from pessoas d
   where d.papel = 'diretoria' and d.ativo and d.auth_id is not null
  on conflict (chave) do nothing;
end;
$$;
revoke all on function public.registrar_resposta(uuid, text) from public, anon, authenticated;

-- O botão Responder do gestor (só o texto).
create or replace function public.responder_recusa(p_fechamento uuid, p_resposta text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.eh_gestor() is not true
     or not exists (select 1 from fechamentos_cota f where f.id = p_fechamento
                      and f.pessoa_id = any (public.pessoas_que_vejo()::uuid[])) then
    raise exception 'Só o gestor do setor responde à recusa.';
  end if;
  perform public.registrar_resposta(p_fechamento, p_resposta);
end;
$$;
revoke all on function public.responder_recusa(uuid, text) from public, anon;
grant execute on function public.responder_recusa(uuid, text) to authenticated;

-- Correção › ajuste de pontos ou meta numa cota recusada: vale como resposta.
create or replace function public.ajuste_responde_recusa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.campo in ('resultado', 'meta')
     and (select situacao from vw_aprovacao_atual where fechamento_id = new.fechamento_id) = 'recusado' then
    perform public.registrar_resposta(new.fechamento_id,
      format('Ajustou %s de %s para %s. %s',
             case new.campo when 'resultado' then 'os pontos' else 'a meta' end,
             translate(to_char(new.valor_anterior::numeric, 'FM999,999,990.00'), ',.', '.,'),
             translate(to_char(new.valor_novo::numeric, 'FM999,999,990.00'), ',.', '.,'), new.motivo));
  end if;
  return null;
end;
$$;
drop trigger if exists ajuste_responde_recusa on public.fechamento_alteracoes;
create trigger ajuste_responde_recusa after insert on public.fechamento_alteracoes
  for each row execute function public.ajuste_responde_recusa();

-- ------------------------------------------- 5. Aviso para a diretoria
-- Só no sino (o Teams ficou de fora, a pedido do gestor). Fechar o mês: um
-- aviso por mês e setor. Refazer o fechamento de quem já tinha decisão: um
-- aviso para aquela pessoa.
create or replace function public.aviso_para_aprovar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_refeito boolean := exists (select 1 from aprovacoes_cota a
                                where a.pessoa_id = new.pessoa_id and a.mes_competencia = new.mes_competencia);
begin
  -- Mês anterior ao início da aprovação: segue o fluxo antigo, sem aviso.
  if new.mes_competencia < public.inicio_da_aprovacao() then return null; end if;
  insert into avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
  select d.id,
         case when v_refeito then format('refeito/%s/%s', new.id, d.id)
              else format('aprovar/%s/%s/%s', to_char(new.mes_competencia, 'YYYY-MM'), new.setor_id, d.id) end,
         case when v_refeito then format('Cota de %s refeita para nova análise', new.pessoa_nome)
              else format('Cotas de %s para aprovar', public.nome_do_mes(new.mes_competencia)) end,
         case when v_refeito then 'O gestor corrigiu e fechou de novo. Ela voltou para aprovação.'
              else coalesce((select nome from setores where id = new.setor_id), 'O setor') || ' fechou o mês.' end,
         '/cota/aprovacao?mes=' || to_char(new.mes_competencia, 'YYYY-MM')
    from pessoas d
   where d.papel = 'diretoria' and d.ativo and d.auth_id is not null
  on conflict (chave) do nothing;
  return null;
end;
$$;
drop trigger if exists aviso_para_aprovar on public.fechamentos_cota;
create trigger aviso_para_aprovar after insert on public.fechamentos_cota
  for each row execute function public.aviso_para_aprovar();

-- --------------------------------------------- 5a. Atualização automática
-- O navegador do gestor e da CEO pergunta, a cada 30 s e só com a aba na
-- tela, se algo mudou; a página só se atualiza quando a marca muda. É só um
-- código (md5): nenhum dado sai por aqui. Consultas pequenas, sem passar pelo
-- servidor da Cloudflare (o painel chama o banco direto).
create or replace function public.marca_de_mudancas()
returns text language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else md5(concat_ws('|',
    (select count(*)::text || '/' || coalesce(max(fechado_em)::text, '') from fechamentos_cota
      where mes_competencia >= (current_date - interval '6 months')),
    (select count(*)::text || '/' || coalesce(max(decidido_em)::text, '') from aprovacoes_cota),
    (select count(*)::text || '/' || coalesce(max(criado_em)::text, '') from fechamento_alteracoes
      where criado_em > now() - interval '90 days'),
    (select count(*)::text || '/' || coalesce(max(criado_em)::text, '') from avisos_da_pessoa
      where pessoa_id = public.pessoa_atual() and lido_em is null)
  )) end;
$$;
revoke all on function public.marca_de_mudancas() from public, anon;
grant execute on function public.marca_de_mudancas() to authenticated;

-- ------------------------------------------------------------ 5b. Cruzeiro
-- Ranking por setor com a soma dos pontos dos meses escolhidos. Só entram as
-- cotas APROVADAS pela CEO (finalizadas): número definitivo. O setor é o do
-- fechamento de cada mês. A CEO e o administrador veem todos os setores; o
-- gestor, as pessoas que ele vê (o setor dele). Só pontos, nunca R$.

-- Os meses com alguma cota aprovada, do mais novo.
create or replace function public.meses_do_cruzeiro()
returns setof date language sql stable security definer set search_path = public as $$
  select distinct f.mes_competencia
    from fechamentos_cota f
    join vw_aprovacao_atual a on a.fechamento_id = f.id and a.situacao = 'aprovado'
   where public.eh_diretoria() or public.eh_gestor()
   order by 1 desc;
$$;

-- Gestão (gestor e acima) fica fora do ranking do setor, que é só de quem
-- atende (Júnior, Pleno, Sênior, Analista). Decide pelo cargo do fechamento
-- daquele mês e, por garantia, pelo papel. A gestão tem um ranking à parte,
-- de todos os setores, que só a CEO e o administrador veem.
create or replace function public.eh_gestao_no_cruzeiro(p_cargo text, p_papel text)
returns boolean language sql immutable as $$
  select coalesce(p_papel, '') in ('gestor', 'administrador', 'diretoria')
      or coalesce(p_cargo, '') ~* '(gestor|gerente|coordena|supervis|diretor|\mceo\M|\mhead\M|l[ií]der)';
$$;

create or replace function public.cruzeiro(p_meses date[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_todos boolean := public.eh_diretoria() or public.eh_admin();
begin
  if not (v_todos or public.eh_gestor()) then
    raise exception 'O Cruzeiro é da CEO e dos gestores.';
  end if;
  return jsonb_build_object(
    -- Um ranking por setor, só de quem atende.
    'setores', (
      select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'nome', st.nome, 'pessoas', st.pessoas)
                                order by st.ordem, st.id), '[]')
        from (select s.id, s.nome, s.ordem,
                     (select jsonb_agg(jsonb_build_object(
                               'pessoa_id', x.pessoa_id, 'nome', x.nome, 'cargo', x.cargo,
                               'pontos', x.pontos, 'meses', x.meses, 'por_mes', x.por_mes)
                               order by x.pontos desc, x.nome)
                        from (select f.pessoa_id,
                                     (array_agg(f.pessoa_nome order by f.mes_competencia desc))[1] as nome,
                                     (array_agg(f.cargo order by f.mes_competencia desc))[1] as cargo,
                                     sum(f.resultado) as pontos, count(*) as meses,
                                     jsonb_object_agg(to_char(f.mes_competencia, 'YYYY-MM'), f.resultado) as por_mes
                                from fechamentos_cota f
                                join vw_aprovacao_atual a on a.fechamento_id = f.id and a.situacao = 'aprovado'
                                join pessoas p on p.id = f.pessoa_id
                               where f.setor_id = s.id and f.mes_competencia = any (p_meses)
                                 and not public.eh_gestao_no_cruzeiro(f.cargo, p.papel)
                                 and (v_todos or f.pessoa_id = any (public.pessoas_que_vejo()::uuid[]))
                               group by f.pessoa_id) x) as pessoas
                from setores s) st
       where st.pessoas is not null),
    -- A gestão de todos os setores, num ranking só (CEO e administrador).
    'gestao', case when v_todos then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'pessoa_id', x.pessoa_id, 'nome', x.nome, 'cargo', x.cargo, 'setor', x.setor,
               'pontos', x.pontos, 'meses', x.meses, 'por_mes', x.por_mes)
               order by x.pontos desc, x.nome), '[]')
        from (select f.pessoa_id,
                     (array_agg(f.pessoa_nome order by f.mes_competencia desc))[1] as nome,
                     (array_agg(f.cargo order by f.mes_competencia desc))[1] as cargo,
                     (array_agg(s.nome order by f.mes_competencia desc))[1] as setor,
                     sum(f.resultado) as pontos, count(*) as meses,
                     jsonb_object_agg(to_char(f.mes_competencia, 'YYYY-MM'), f.resultado) as por_mes
                from fechamentos_cota f
                join vw_aprovacao_atual a on a.fechamento_id = f.id and a.situacao = 'aprovado'
                join pessoas p on p.id = f.pessoa_id
                left join setores s on s.id = f.setor_id
               where f.mes_competencia = any (p_meses)
                 and public.eh_gestao_no_cruzeiro(f.cargo, p.papel)
               group by f.pessoa_id) x)
    end
  );
end;
$$;
revoke all on function public.meses_do_cruzeiro() from public, anon;
revoke all on function public.cruzeiro(date[]) from public, anon;
grant execute on function public.meses_do_cruzeiro() to authenticated;
grant execute on function public.cruzeiro(date[]) to authenticated;

-- ------------------------------------------- 6. A conta da diretoria
-- Só o administrador cria: ela enxerga o fechamento de todos os setores. Usa
-- o criar_acesso de sempre (senha provisória, troca no primeiro acesso) e, na
-- mesma transação, põe o papel de diretoria — nunca fica como gestor.
create or replace function public.criar_acesso_diretoria(p_pessoa uuid, p_email text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_senha text;
begin
  if public.eh_admin() is not true then
    raise exception 'Só o administrador cria o acesso da CEO.';
  end if;
  v_senha := public.criar_acesso(p_pessoa, p_email, 'gestor');
  update pessoas
     set papel = 'diretoria', avaliado = false, exibir_no_painel = false, conta_nas_medias = false
   where id = p_pessoa;
  update acessos_criados set papel = 'diretoria'
   where id = (select id from acessos_criados where pessoa_id = p_pessoa order by feito_em desc limit 1);
  return v_senha;
end;
$$;

revoke all on function public.meses_para_aprovar() from public, anon;
revoke all on function public.painel_da_diretoria(date) from public, anon;
revoke all on function public.extrato_para_diretoria(uuid) from public, anon;
revoke all on function public.decidir_cota(uuid[], text, text) from public, anon;
revoke all on function public.criar_acesso_diretoria(uuid, text) from public, anon;
grant execute on function public.meses_para_aprovar() to authenticated;
grant execute on function public.painel_da_diretoria(date) to authenticated;
grant execute on function public.extrato_para_diretoria(uuid) to authenticated;
grant execute on function public.decidir_cota(uuid[], text, text) to authenticated;
grant execute on function public.criar_acesso_diretoria(uuid, text) to authenticated;
