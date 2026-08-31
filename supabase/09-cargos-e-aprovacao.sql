-- ============================================================================
-- Reestruturação dos cargos.
-- Rode DEPOIS de 08-corrige-guarda-de-admin.sql.
--
--   Gestor    — o antigo admin: vê tudo, monitora, edita pesos e cadastros,
--               administra acessos e exclui monitoria direto.
--   Qualidade — vê tudo e monitora (lança e edita), mas não mexe em pesos,
--               cadastros nem acessos. Excluir depende de aprovação de gestor.
--   Operador  — vê apenas as próprias monitorias.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- O papel deixa de ser enum e vira texto com restrição.
--
-- Um enum não aceita remover valor, e 'admin' precisava sair. Com texto mais
-- restrição, mudar a lista de cargos no futuro é uma linha, sem migração de
-- tipo — e a restrição continua impedindo qualquer valor fora da lista.
-- ---------------------------------------------------------------------------
alter table public.perfis alter column papel drop default;
alter table public.perfis alter column papel type text using papel::text;

update public.perfis set papel = 'gestor' where papel = 'admin';

alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check
  check (papel in ('gestor', 'qualidade', 'operador'));

alter table public.perfis alter column papel set default 'operador';

-- ---------------------------------------------------------------------------
-- Funções de papel. Sempre com coalesce: quem não tem perfil recebe false,
-- nunca NULL — foi um NULL escapando de uma guarda que abriu a falha corrigida
-- na migração 08.
--
-- A ordem aqui importa: papel_atual() ainda devolve o enum antigo, então o tipo
-- só pode ser removido depois que ela for recriada devolvendo texto.
-- ---------------------------------------------------------------------------
drop function if exists public.papel_atual() cascade;

create function public.papel_atual()
returns text language sql stable security definer set search_path = public as $$
  select papel from public.perfis where id = auth.uid() and ativo;
$$;

drop type if exists public.papel_usuario;

/** Gestor: o papel com poder de administração. */
create or replace function public.eh_gestor()
returns boolean language sql stable as $$
  select coalesce(public.papel_atual() = 'gestor', false);
$$;

/** Quem lança e edita monitoria: gestor e qualidade. */
create or replace function public.pode_monitorar()
returns boolean language sql stable as $$
  select coalesce(public.papel_atual() in ('gestor', 'qualidade'), false);
$$;

/** Quem enxerga o time inteiro, e não só a si mesmo. */
create or replace function public.ve_o_time()
returns boolean language sql stable as $$
  select coalesce(public.papel_atual() in ('gestor', 'qualidade'), false);
$$;

-- ---------------------------------------------------------------------------
-- Políticas reescritas para os cargos novos.
-- ---------------------------------------------------------------------------
drop policy if exists perfis_ler_proprio on public.perfis;
create policy perfis_ler_proprio on public.perfis
  for select using (id = auth.uid() or public.ve_o_time());

drop policy if exists perfis_admin_total on public.perfis;
drop policy if exists perfis_gestor_total on public.perfis;
create policy perfis_gestor_total on public.perfis
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- Cadastros: todos leem, só gestor altera.
drop policy if exists operadores_admin on public.operadores;
drop policy if exists operadores_gestor on public.operadores;
create policy operadores_gestor on public.operadores
  for all using (public.eh_gestor()) with check (public.eh_gestor());

drop policy if exists canais_admin on public.canais;
drop policy if exists canais_gestor on public.canais;
create policy canais_gestor on public.canais
  for all using (public.eh_gestor()) with check (public.eh_gestor());

drop policy if exists criterios_admin on public.criterios;
drop policy if exists criterios_gestor on public.criterios;
create policy criterios_gestor on public.criterios
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- Monitorias: gestor e qualidade lançam e editam; operador só lê as próprias.
drop policy if exists monitorias_leitura on public.monitorias;
create policy monitorias_leitura on public.monitorias
  for select using (public.ve_o_time() or operador_id = public.operador_atual());

drop policy if exists monitorias_escrita on public.monitorias;
create policy monitorias_escrita on public.monitorias
  for all using (public.pode_monitorar()) with check (public.pode_monitorar());

drop policy if exists itens_leitura on public.monitoria_itens;
create policy itens_leitura on public.monitoria_itens
  for select using (
    exists (
      select 1 from public.monitorias m
      where m.id = monitoria_id
        and (public.ve_o_time() or m.operador_id = public.operador_atual())
    )
  );

drop policy if exists itens_escrita on public.monitoria_itens;
create policy itens_escrita on public.monitoria_itens
  for all using (public.pode_monitorar()) with check (public.pode_monitorar());

drop policy if exists alteracoes_leitura on public.monitoria_alteracoes;
create policy alteracoes_leitura on public.monitoria_alteracoes
  for select using (
    exists (
      select 1 from public.monitorias m
      where m.id = monitoria_id
        and (public.ve_o_time() or m.operador_id = public.operador_atual())
    )
  );

drop policy if exists excluidas_leitura on public.monitorias_excluidas;
create policy excluidas_leitura on public.monitorias_excluidas
  for select using (public.ve_o_time());

-- As funções antigas somem para não restar caminho com a regra velha.
drop function if exists public.eh_admin();
drop function if exists public.eh_gestor_ou_admin();

-- ---------------------------------------------------------------------------
-- Exclusão com aprovação
--
-- Gestor exclui direto. Qualidade abre uma solicitação, que fica pendente até
-- um gestor aprovar ou recusar. A monitoria só é apagada no momento da
-- aprovação — enquanto isso ela continua valendo normalmente nos relatórios.
-- ---------------------------------------------------------------------------
create table if not exists public.solicitacoes_exclusao (
  id                 uuid primary key default uuid_generate_v4(),
  monitoria_id       uuid not null references public.monitorias (id) on delete cascade,
  motivo             text not null,
  solicitada_por     uuid references public.perfis (id) on delete set null,
  solicitada_por_nome text,
  solicitada_em      timestamptz not null default now(),
  status             text not null default 'pendente'
                       check (status in ('pendente', 'aprovada', 'recusada')),
  decidida_por       uuid references public.perfis (id) on delete set null,
  decidida_por_nome  text,
  decidida_em        timestamptz,
  observacao_decisao text
);

-- Uma monitoria não pode ter duas solicitações pendentes ao mesmo tempo.
create unique index if not exists solicitacao_pendente_idx
  on public.solicitacoes_exclusao (monitoria_id) where status = 'pendente';

alter table public.solicitacoes_exclusao enable row level security;

drop policy if exists solicitacoes_leitura on public.solicitacoes_exclusao;
create policy solicitacoes_leitura on public.solicitacoes_exclusao
  for select using (public.ve_o_time());

-- Apaga de fato. Uso interno das funções abaixo, que é onde a permissão é
-- conferida; por isso não recebe permissão de execução para ninguém.
create or replace function public.apagar_monitoria(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m        public.monitorias%rowtype;
  v_operador text;
  v_autor    text;
begin
  select * into v_m from public.monitorias where id = p_id;
  if not found then raise exception 'Monitoria não encontrada.'; end if;

  select nome into v_operador from public.operadores where id = v_m.operador_id;
  select nome into v_autor    from public.perfis     where id = auth.uid();

  insert into public.monitorias_excluidas (
    monitoria_id, protocolo, data_atendimento, mes_referencia, semana_mes,
    numero_monitoria, operador_id, operador_nome, nota_final, zerado, parecer,
    motivo, excluida_por, excluida_por_nome, itens)
  values (
    v_m.id, v_m.protocolo, v_m.data_atendimento, v_m.mes_referencia, v_m.semana_mes,
    v_m.numero_monitoria, v_m.operador_id, v_operador, v_m.nota_final, v_m.zerado,
    v_m.parecer, p_motivo, auth.uid(), coalesce(v_autor, 'sistema'),
    (select jsonb_agg(jsonb_build_object(
              'criterio', c.nome, 'conforme', i.conforme, 'observacao', i.observacao))
       from public.monitoria_itens i
       join public.criterios c on c.id = i.criterio_id
      where i.monitoria_id = p_id));

  delete from public.monitorias where id = p_id;
end;
$$;

revoke all on function public.apagar_monitoria(uuid, text) from public;

-- A versão anterior devolvia void e esta devolve texto. O Postgres não troca o
-- tipo de retorno num `create or replace`: a função precisa sair antes.
drop function if exists public.excluir_monitoria(uuid, text);

/**
 * Ponto de entrada da exclusão.
 * Gestor apaga na hora; qualidade abre solicitação pendente.
 * Devolve 'excluida' ou 'solicitada', para a tela saber o que dizer.
 */
create function public.excluir_monitoria(p_id uuid, p_motivo text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_nome text;
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

  select nome into v_nome from public.perfis where id = auth.uid();

  insert into public.solicitacoes_exclusao
    (monitoria_id, motivo, solicitada_por, solicitada_por_nome)
  values (p_id, trim(p_motivo), auth.uid(), coalesce(v_nome, 'sistema'));

  return 'solicitada';
end;
$$;

revoke all on function public.excluir_monitoria(uuid, text) from public;
grant execute on function public.excluir_monitoria(uuid, text) to authenticated;

/** Gestor aprova: a monitoria é apagada agora. */
create or replace function public.aprovar_exclusao(p_solicitacao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s    public.solicitacoes_exclusao%rowtype;
  v_nome text;
begin
  if public.eh_gestor() is not true then
    raise exception 'Apenas gestores aprovam exclusões.';
  end if;

  select * into v_s from public.solicitacoes_exclusao where id = p_solicitacao;
  if not found then raise exception 'Solicitação não encontrada.'; end if;
  if v_s.status <> 'pendente' then raise exception 'Esta solicitação já foi decidida.'; end if;

  select nome into v_nome from public.perfis where id = auth.uid();

  -- Decide antes de apagar: a solicitação aponta para a monitoria com cascade,
  -- e apagar primeiro levaria a própria solicitação junto.
  update public.solicitacoes_exclusao
     set status = 'aprovada', decidida_por = auth.uid(),
         decidida_por_nome = coalesce(v_nome, 'sistema'), decidida_em = now(),
         monitoria_id = v_s.monitoria_id
   where id = p_solicitacao;

  perform public.apagar_monitoria(v_s.monitoria_id,
    v_s.motivo || ' (solicitado por ' || coalesce(v_s.solicitada_por_nome, '?')
    || ', aprovado por ' || coalesce(v_nome, '?') || ')');
end;
$$;

/** Gestor recusa: a monitoria continua como está. */
create or replace function public.recusar_exclusao(p_solicitacao uuid, p_observacao text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_nome text;
begin
  if public.eh_gestor() is not true then
    raise exception 'Apenas gestores decidem exclusões.';
  end if;

  select nome into v_nome from public.perfis where id = auth.uid();

  update public.solicitacoes_exclusao
     set status = 'recusada', decidida_por = auth.uid(),
         decidida_por_nome = coalesce(v_nome, 'sistema'), decidida_em = now(),
         observacao_decisao = nullif(trim(p_observacao), '')
   where id = p_solicitacao and status = 'pendente';

  if not found then raise exception 'Solicitação não encontrada ou já decidida.'; end if;
end;
$$;

revoke all on function public.aprovar_exclusao(uuid) from public;
revoke all on function public.recusar_exclusao(uuid, text) from public;
grant execute on function public.aprovar_exclusao(uuid) to authenticated;
grant execute on function public.recusar_exclusao(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cargos das pessoas hoje.
-- ---------------------------------------------------------------------------
update public.perfis set papel = 'qualidade'
 where email = 'suyara.ramos@igreenenergy.com.br';
