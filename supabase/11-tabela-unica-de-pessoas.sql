-- ============================================================================
-- Uma tabela de pessoas no lugar de duas.
-- Rode DEPOIS de 10-fecha-funcoes-internas.sql.
--
-- Havia `operadores` (quem é avaliado) e `perfis` (quem entra no sistema), com
-- nome e e-mail repetidos nas duas e uma coluna ligando uma à outra. Quem
-- cadastrava um operador esperava que ele passasse a existir como acesso, e não
-- passava. Some a duplicação: `pessoas` guarda a pessoa uma vez, com duas
-- perguntas separadas — se ela é avaliada e se ela entra no sistema.
--
-- Os ids de `operadores` são reaproveitados como ids de `pessoas`, então as
-- 52 monitorias continuam apontando para o mesmo lugar, sem remapeamento.
-- ============================================================================

create table if not exists public.pessoas (
  id              uuid primary key default uuid_generate_v4(),

  -- Login correspondente, quando existe. Nulo é o caso de quem é avaliado mas
  -- não acessa o sistema — comum, e o motivo de a pessoa não poder ser
  -- identificada pelo id do usuário como era antes.
  auth_id         uuid unique references auth.users (id) on delete set null,

  nome            text not null unique,
  email           text unique,
  -- Nome usado no Huggy. Só o painel de performance consome, mas fica aqui
  -- para os dois sistemas lerem a mesma pessoa.
  nome_huggy      text,

  papel           text not null default 'operador'
                    check (papel in ('gestor', 'qualidade', 'operador')),
  /** Entra na lista de quem pode ser monitorado. */
  avaliado        boolean not null default true,
  ativo           boolean not null default true,
  senha_definida  boolean not null default false,
  criado_em       timestamptz not null default now()
);

create index if not exists pessoas_auth_idx on public.pessoas (auth_id);

-- ---------------------------------------------------------------------------
-- Migração dos dados
-- ---------------------------------------------------------------------------

-- 1. Quem é avaliado, mantendo o id para as monitorias continuarem válidas.
insert into public.pessoas (id, nome, email, avaliado, ativo)
select o.id, o.nome, o.email, true, o.ativo
  from public.operadores o
 where not exists (select 1 from public.pessoas p where p.id = o.id);

-- 2. Quem entra no sistema. Casa com a pessoa pelo vínculo, e no que sobrar
--    pelo e-mail; o que não casar vira pessoa nova, não avaliada.
update public.pessoas p
   set auth_id = f.id, papel = f.papel, senha_definida = f.senha_definida,
       ativo = f.ativo, email = coalesce(p.email, f.email)
  from public.perfis f
 where f.operador_id = p.id;

update public.pessoas p
   set auth_id = f.id, papel = f.papel, senha_definida = f.senha_definida
  from public.perfis f
 where p.auth_id is null
   and f.operador_id is null
   and lower(f.email) = lower(p.email);

insert into public.pessoas (auth_id, nome, email, papel, avaliado, ativo, senha_definida)
select f.id, f.nome, f.email, f.papel, false, f.ativo, f.senha_definida
  from public.perfis f
 where not exists (select 1 from public.pessoas p where p.auth_id = f.id);

-- 3. As colunas que apontavam para perfis guardam id de usuário; passam a
--    guardar id de pessoa.
alter table public.monitorias            drop constraint if exists monitorias_monitor_id_fkey;
alter table public.monitoria_alteracoes  drop constraint if exists monitoria_alteracoes_autor_id_fkey;
alter table public.monitorias_excluidas  drop constraint if exists monitorias_excluidas_excluida_por_fkey;
alter table public.solicitacoes_exclusao drop constraint if exists solicitacoes_exclusao_solicitada_por_fkey;
alter table public.solicitacoes_exclusao drop constraint if exists solicitacoes_exclusao_decidida_por_fkey;

update public.monitorias m
   set monitor_id = p.id from public.pessoas p where p.auth_id = m.monitor_id;
update public.monitoria_alteracoes a
   set autor_id = p.id from public.pessoas p where p.auth_id = a.autor_id;
update public.monitorias_excluidas e
   set excluida_por = p.id from public.pessoas p where p.auth_id = e.excluida_por;
update public.solicitacoes_exclusao s
   set solicitada_por = p.id from public.pessoas p where p.auth_id = s.solicitada_por;
update public.solicitacoes_exclusao s
   set decidida_por = p.id from public.pessoas p where p.auth_id = s.decidida_por;

alter table public.monitorias
  add constraint monitorias_monitor_id_fkey
  foreign key (monitor_id) references public.pessoas (id) on delete set null;
alter table public.monitoria_alteracoes
  add constraint monitoria_alteracoes_autor_id_fkey
  foreign key (autor_id) references public.pessoas (id) on delete set null;
alter table public.monitorias_excluidas
  add constraint monitorias_excluidas_excluida_por_fkey
  foreign key (excluida_por) references public.pessoas (id) on delete set null;
alter table public.solicitacoes_exclusao
  add constraint solicitacoes_exclusao_solicitada_por_fkey
  foreign key (solicitada_por) references public.pessoas (id) on delete set null;
alter table public.solicitacoes_exclusao
  add constraint solicitacoes_exclusao_decidida_por_fkey
  foreign key (decidida_por) references public.pessoas (id) on delete set null;

-- 4. A monitoria passa a apontar para pessoas. A coluna continua se chamando
--    operador_id: ela nomeia o papel na relação — quem foi avaliado — e não a
--    tabela de destino.
alter table public.monitorias drop constraint if exists monitorias_operador_id_fkey;
alter table public.monitorias
  add constraint monitorias_operador_id_fkey
  foreign key (operador_id) references public.pessoas (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Funções de identidade, agora sobre pessoas
-- ---------------------------------------------------------------------------
create or replace function public.papel_atual()
returns text language sql stable security definer set search_path = public as $$
  select papel from public.pessoas where auth_id = auth.uid() and ativo;
$$;

create or replace function public.pessoa_atual()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.pessoas where auth_id = auth.uid() and ativo;
$$;

-- Mantida com o nome antigo porque as políticas de monitoria a usam para dizer
-- "as monitorias desta pessoa".
create or replace function public.operador_atual()
returns uuid language sql stable security definer set search_path = public as $$
  select public.pessoa_atual();
$$;

-- Quem se cadastra no Supabase é ligado à pessoa que já existir com o mesmo
-- e-mail, em vez de virar um registro separado — que era como a duplicação
-- começava.
create or replace function public.tratar_novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from public.pessoas where lower(email) = lower(new.email);

  if v_id is not null then
    update public.pessoas set auth_id = new.id where id = v_id;
  else
    insert into public.pessoas (auth_id, nome, email, papel, avaliado)
    values (new.id,
            coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
            new.email, 'operador', false);
  end if;

  return new;
end;
$$;

create or replace function public.marcar_senha_definida()
returns void language sql security definer set search_path = public as $$
  update public.pessoas set senha_definida = true where auth_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Acesso a pessoas
-- ---------------------------------------------------------------------------
alter table public.pessoas enable row level security;

drop policy if exists pessoas_leitura on public.pessoas;
create policy pessoas_leitura on public.pessoas
  for select using (auth.uid() is not null);

drop policy if exists pessoas_gestor on public.pessoas;
create policy pessoas_gestor on public.pessoas
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- ---------------------------------------------------------------------------
-- Views: o nome do monitor vem de pessoas
-- ---------------------------------------------------------------------------
create or replace view public.vw_monitorias with (security_invoker = true) as
select
  m.id, m.protocolo, m.data_atendimento, m.mes_referencia,
  extract(year  from m.data_atendimento)::int as ano,
  extract(month from m.data_atendimento)::int as mes,
  m.semana_mes, m.numero_monitoria,
  o.id as operador_id, o.nome as operador,
  c.nome as canal,
  m.tempo_atendimento_seg, m.nota_final, m.zerado, m.motivo_zeramento, m.parecer,
  p.nome as monitor, m.criado_em
from public.monitorias m
join public.pessoas o on o.id = m.operador_id
left join public.canais  c on c.id = m.canal_id
left join public.pessoas p on p.id = m.monitor_id;

create or replace view public.vw_feedback_individual with (security_invoker = true) as
select
  m.id as monitoria_id, o.id as operador_id, o.nome as operador,
  m.protocolo, m.data_atendimento, m.mes_referencia, m.semana_mes,
  m.numero_monitoria, m.nota_final, m.zerado, m.parecer,
  cr.ordem as criterio_ordem, cr.nome as criterio, cr.peso,
  i.conforme, i.observacao
from public.monitorias m
join public.pessoas o          on o.id = m.operador_id
join public.monitoria_itens i  on i.monitoria_id = m.id
join public.criterios cr       on cr.id = i.criterio_id;

-- ---------------------------------------------------------------------------
-- Funções que liam nome em perfis ou operadores
-- ---------------------------------------------------------------------------
create or replace function public.registrar_alteracao(
  p_monitoria uuid, p_campo text, p_anterior text, p_novo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  select nome into v_nome from public.pessoas where auth_id = auth.uid();
  insert into public.monitoria_alteracoes
    (monitoria_id, autor_id, autor_nome, campo, valor_anterior, valor_novo)
  values (p_monitoria, public.pessoa_atual(), coalesce(v_nome, 'sistema'),
          p_campo, p_anterior, p_novo);
end;
$$;

create or replace function public.auditar_monitoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_antes text; v_depois text;
begin
  if new.protocolo is distinct from old.protocolo then
    perform public.registrar_alteracao(new.id, 'Protocolo', old.protocolo, new.protocolo);
  end if;
  if new.data_atendimento is distinct from old.data_atendimento then
    perform public.registrar_alteracao(new.id, 'Data do atendimento',
      to_char(old.data_atendimento, 'DD/MM/YYYY'), to_char(new.data_atendimento, 'DD/MM/YYYY'));
  end if;
  if new.operador_id is distinct from old.operador_id then
    select nome into v_antes  from public.pessoas where id = old.operador_id;
    select nome into v_depois from public.pessoas where id = new.operador_id;
    perform public.registrar_alteracao(new.id, 'Operador', v_antes, v_depois);
  end if;
  if new.canal_id is distinct from old.canal_id then
    select nome into v_antes  from public.canais where id = old.canal_id;
    select nome into v_depois from public.canais where id = new.canal_id;
    perform public.registrar_alteracao(new.id, 'Canal', v_antes, v_depois);
  end if;
  if new.numero_monitoria is distinct from old.numero_monitoria then
    perform public.registrar_alteracao(new.id, 'Nº da monitoria',
      old.numero_monitoria || 'ª', new.numero_monitoria || 'ª');
  end if;
  if new.zerado is distinct from old.zerado then
    perform public.registrar_alteracao(new.id, 'Zeramento por falha crítica',
      case when old.zerado then 'Sim' else 'Não' end,
      case when new.zerado then 'Sim' else 'Não' end);
  end if;
  if new.motivo_zeramento is distinct from old.motivo_zeramento then
    perform public.registrar_alteracao(new.id, 'Motivo do zeramento',
      old.motivo_zeramento, new.motivo_zeramento);
  end if;
  if new.parecer is distinct from old.parecer then
    perform public.registrar_alteracao(new.id, 'Parecer geral', old.parecer, new.parecer);
  end if;
  if new.nota_final is distinct from old.nota_final then
    perform public.registrar_alteracao(new.id, 'Nota final',
      round(old.nota_final * 100, 1) || '%', round(new.nota_final * 100, 1) || '%');
  end if;
  return new;
end;
$$;

create or replace function public.apagar_monitoria(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m public.monitorias%rowtype;
  v_operador text;
  v_autor text;
begin
  select * into v_m from public.monitorias where id = p_id;
  if not found then raise exception 'Monitoria não encontrada.'; end if;

  select nome into v_operador from public.pessoas where id = v_m.operador_id;
  select nome into v_autor    from public.pessoas where auth_id = auth.uid();

  insert into public.monitorias_excluidas (
    monitoria_id, protocolo, data_atendimento, mes_referencia, semana_mes,
    numero_monitoria, operador_id, operador_nome, nota_final, zerado, parecer,
    motivo, excluida_por, excluida_por_nome, itens)
  values (
    v_m.id, v_m.protocolo, v_m.data_atendimento, v_m.mes_referencia, v_m.semana_mes,
    v_m.numero_monitoria, v_m.operador_id, v_operador, v_m.nota_final, v_m.zerado,
    v_m.parecer, p_motivo, public.pessoa_atual(), coalesce(v_autor, 'sistema'),
    (select jsonb_agg(jsonb_build_object(
              'criterio', c.nome, 'conforme', i.conforme, 'observacao', i.observacao))
       from public.monitoria_itens i
       join public.criterios c on c.id = i.criterio_id
      where i.monitoria_id = p_id));

  delete from public.monitorias where id = p_id;
end;
$$;

create or replace function public.excluir_monitoria(p_id uuid, p_motivo text)
returns text language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da exclusão.';
  end if;

  if public.eh_gestor() is true then
    perform public.apagar_monitoria(p_id, trim(p_motivo));
    return 'excluida';
  end if;

  if public.pode_monitorar() is not true then
    raise exception 'Você não tem permissão para excluir monitorias.';
  end if;

  if not exists (select 1 from public.monitorias where id = p_id) then
    raise exception 'Monitoria não encontrada.';
  end if;

  if exists (select 1 from public.solicitacoes_exclusao
              where monitoria_id = p_id and status = 'pendente') then
    raise exception 'Já existe uma solicitação pendente para esta monitoria.';
  end if;

  select nome into v_nome from public.pessoas where auth_id = auth.uid();

  insert into public.solicitacoes_exclusao
    (monitoria_id, motivo, solicitada_por, solicitada_por_nome)
  values (p_id, trim(p_motivo), public.pessoa_atual(), coalesce(v_nome, 'sistema'));

  return 'solicitada';
end;
$$;

create or replace function public.aprovar_exclusao(p_solicitacao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.solicitacoes_exclusao%rowtype; v_nome text;
begin
  if public.eh_gestor() is not true then
    raise exception 'Apenas gestores aprovam exclusões.';
  end if;

  select * into v_s from public.solicitacoes_exclusao where id = p_solicitacao;
  if not found then raise exception 'Solicitação não encontrada.'; end if;
  if v_s.status <> 'pendente' then raise exception 'Esta solicitação já foi decidida.'; end if;

  select nome into v_nome from public.pessoas where auth_id = auth.uid();

  update public.solicitacoes_exclusao
     set status = 'aprovada', decidida_por = public.pessoa_atual(),
         decidida_por_nome = coalesce(v_nome, 'sistema'), decidida_em = now()
   where id = p_solicitacao;

  perform public.apagar_monitoria(v_s.monitoria_id,
    v_s.motivo || ' (solicitado por ' || coalesce(v_s.solicitada_por_nome, '?')
    || ', aprovado por ' || coalesce(v_nome, '?') || ')');
end;
$$;

create or replace function public.recusar_exclusao(p_solicitacao uuid, p_observacao text)
returns void language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if public.eh_gestor() is not true then
    raise exception 'Apenas gestores decidem exclusões.';
  end if;

  select nome into v_nome from public.pessoas where auth_id = auth.uid();

  update public.solicitacoes_exclusao
     set status = 'recusada', decidida_por = public.pessoa_atual(),
         decidida_por_nome = coalesce(v_nome, 'sistema'), decidida_em = now(),
         observacao_decisao = nullif(trim(p_observacao), '')
   where id = p_solicitacao and status = 'pendente';

  if not found then raise exception 'Solicitação não encontrada ou já decidida.'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões: as internas continuam fechadas, e revogar precisa nomear os
-- papéis do Supabase — revogar de `public` não alcança anon e authenticated.
-- ---------------------------------------------------------------------------
revoke all on function public.apagar_monitoria(uuid, text)
  from public, anon, authenticated;
revoke all on function public.registrar_alteracao(uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.excluir_monitoria(uuid, text) to authenticated;
grant execute on function public.aprovar_exclusao(uuid)        to authenticated;
grant execute on function public.recusar_exclusao(uuid, text)  to authenticated;
grant execute on function public.marcar_senha_definida()       to authenticated;

-- ---------------------------------------------------------------------------
-- As tabelas antigas saem depois que tudo aponta para pessoas.
-- ---------------------------------------------------------------------------
drop table if exists public.perfis cascade;
drop table if exists public.operadores cascade;
