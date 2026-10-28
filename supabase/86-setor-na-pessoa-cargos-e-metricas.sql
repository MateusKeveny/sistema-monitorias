-- ============================================================================
-- 86 · Setores e filas em árvore — etapa 4, parte 1 (o cadastro por setor)
--
-- O que passa a ter setor (docs/PLANO-SETORES.md, etapa 4):
--
--   setores.monitorias      monitorias ligadas no setor (a Conexão Expansão: sim)
--   setores_da_pessoa       o setor da pessoa, com histórico — como o cargo
--   cargos.setor_id         cada setor com os seus cargos (e o cargo leva os
--                           pesos e a meta)
--   regras.setor_id         as definições das métricas são do setor
--   valores_da_cota.setor_id, fechamentos_cota.setor_id
--
-- Tudo o que já existe vai para a Conexão Expansão (setor 1), e o setor 1 é o
-- padrão: o site oficial (2.11.2), que grava sem saber de setor, continua
-- gravando como sempre. NENHUM ponto e NENHUM acesso mudam aqui.
--
-- Criar setor copiando outro (`clonar_setor`): o setor novo ganha cópias
-- independentes das DEFINIÇÕES — faixas e nomes de C-SAT, notas e TME, a regra
-- de finalizado e as métricas manuais — e cópias dos cargos com os pesos e a
-- meta. As regras estruturais (meta, média da equipe, monitoria, atestado,
-- presencial, chamados) mantêm a chave que o cálculo conhece; o que muda por
-- setor nelas é o peso, que vem do cargo. Monitorias desligadas = os cargos do
-- setor novo nascem sem peso de monitoria.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

begin;

-- 1. Monitorias por setor.
alter table public.setores add column if not exists monitorias boolean not null default true;

-- 2. O setor da pessoa, com histórico (uma pessoa, um setor por mês).
create table if not exists public.setores_da_pessoa (
  pessoa_id uuid     not null references public.pessoas (id) on delete cascade,
  desde     date     not null check (extract(day from desde) = 1),
  setor_id  smallint not null references public.setores (id) on delete restrict,
  primary key (pessoa_id, desde)
);
alter table public.setores_da_pessoa enable row level security;
drop policy if exists setores_pessoa_gestor  on public.setores_da_pessoa;
drop policy if exists setores_pessoa_leitura on public.setores_da_pessoa;
create policy setores_pessoa_gestor on public.setores_da_pessoa for all
  using (public.eh_gestor()) with check (public.eh_gestor());
create policy setores_pessoa_leitura on public.setores_da_pessoa for select
  using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

-- Todos de hoje na Conexão Expansão, desde o primeiro mês deles no painel.
insert into public.setores_da_pessoa (pessoa_id, desde, setor_id)
select p.id,
       least(coalesce((select min(cp.desde) from public.cargos_da_pessoa cp where cp.pessoa_id = p.id), 'infinity'::date),
             date_trunc('month', p.criado_em)::date),
       1
  from public.pessoas p
 where not exists (select 1 from public.setores_da_pessoa s where s.pessoa_id = p.id);

-- Pessoa nova sem setor (o site de hoje não sabe de setor): Conexão Expansão.
create or replace function public.setor_inicial_da_pessoa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.setores_da_pessoa (pessoa_id, desde, setor_id)
  values (new.id, date_trunc('month', coalesce(new.criado_em, now()))::date, 1)
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists setor_inicial on public.pessoas;
create trigger setor_inicial after insert on public.pessoas
  for each row execute function public.setor_inicial_da_pessoa();

-- O setor da pessoa num mês. Antes do primeiro registro, vale o primeiro.
create or replace function public.setor_na_competencia(p_pessoa uuid, p_mes date)
returns smallint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select setor_id from public.setores_da_pessoa where pessoa_id = p_pessoa and desde <= p_mes order by desde desc limit 1),
    (select setor_id from public.setores_da_pessoa where pessoa_id = p_pessoa order by desde limit 1));
$$;

-- 3. Cargos por setor. O nome só precisa ser único dentro do setor.
alter table public.cargos add column if not exists setor_id smallint not null default 1
  references public.setores (id) on delete restrict;
alter table public.cargos drop constraint if exists cargos_nome_key;
alter table public.cargos drop constraint if exists cargos_setor_nome_key;
alter table public.cargos add constraint cargos_setor_nome_key unique (setor_id, nome);

-- 4. Métricas por setor. `copia_de`: a regra de origem, numa cópia.
alter table public.regras add column if not exists setor_id smallint not null default 1
  references public.setores (id) on delete restrict;
alter table public.regras add column if not exists copia_de text;

-- 5. Valor por ponto e fechamento: de qual setor. (As funções que gravam
-- passam a pedir o setor na parte 2, junto com as telas.)
alter table public.valores_da_cota  add column if not exists setor_id smallint not null default 1
  references public.setores (id) on delete restrict;
alter table public.fechamentos_cota add column if not exists setor_id smallint not null default 1
  references public.setores (id) on delete restrict;

-- 6. Regras que o cálculo conhece pelo nome: não são copiadas; o peso delas
-- vem do cargo (que é do setor).
create or replace function public.regra_estrutural(p_chave text)
returns boolean language sql immutable as $$
  select p_chave in ('meta', 'media_da_equipe', 'monitoria', 'atestado', 'presencial',
                     'chamados_tratados', 'chamados_sla_ate_2d', 'chamados_sla_acima_2d')
      or p_chave like 'outro_setor_%';
$$;

-- A cópia de uma regra (ou grupo) no setor: a própria, no setor de origem.
create or replace function public.chave_no_setor(p_chave text, p_setor smallint)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select chave from public.regras where chave = p_chave and setor_id = p_setor),
    (select chave from public.regras where copia_de = p_chave and setor_id = p_setor),
    p_chave);
$$;
create or replace function public.grupo_no_setor(p_grupo text, p_setor smallint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_grupo is null then null
    when exists (select 1 from public.regras where grupo = p_grupo and setor_id = p_setor) then p_grupo
    else coalesce((select r.grupo from public.regras r join public.regras o on o.chave = r.copia_de
                    where o.grupo = p_grupo and r.setor_id = p_setor limit 1), p_grupo)
  end;
$$;

-- 7. Criar setor copiando outro. Devolve o id do setor novo.
create or replace function public.clonar_setor(p_nome text, p_origem smallint, p_monitorias boolean)
returns smallint language plpgsql security definer set search_path = public as $$
declare
  v_novo  smallint;
  v_sufixo text;
  r public.regras;
  c public.cargos;
  v_cargo smallint;
  v_mapa jsonb := '{}';
begin
  if not public.eh_gestor() then raise exception 'Só o administrador cria setor.'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'O setor precisa de nome.'; end if;

  insert into public.setores (nome, ordem, monitorias)
  values (trim(p_nome), (select coalesce(max(ordem), 0) + 1 from public.setores), p_monitorias)
  returning id into v_novo;
  if p_origem is null then return v_novo; end if;   -- do zero: só o setor
  v_sufixo := '_s' || v_novo;

  -- As definições: cópias independentes, com grupo próprio.
  for r in select * from public.regras where setor_id = p_origem and ativo and not public.regra_estrutural(chave) loop
    insert into public.regras (chave, grupo, rotulo, peso, faixa_min, faixa_max, ordem, manual, valor_manual, ativo, setor_id, copia_de)
    values (r.chave || v_sufixo,
            -- Grupo próprio só nas réguas de faixa (C-SAT, notas, TME), que o
            -- cálculo escolhe pelo grupo da fila; os outros grupos são categorias.
            case when r.grupo in ('csat', 'nota') or r.grupo like 'tme%' then r.grupo || v_sufixo else r.grupo end,
            r.rotulo, r.peso, r.faixa_min, r.faixa_max, r.ordem, r.manual, r.valor_manual, true, v_novo, r.chave);
  end loop;

  -- Os cargos, com os pesos (apontando para as cópias) e a meta.
  for c in select * from public.cargos where setor_id = p_origem and ativo order by ordem loop
    insert into public.cargos (nome, ordem, ativo, recebe_bonus, base_do_bonus, recebe_cota, setor_id)
    values (c.nome, c.ordem, true, c.recebe_bonus, c.base_do_bonus, c.recebe_cota, v_novo)
    returning id into v_cargo;
    v_mapa := v_mapa || jsonb_build_object(c.id::text, v_cargo);
    insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo, motivo_alteracao)
    select v_cargo, public.chave_no_setor(p.regra, v_novo), p.peso, p.ativo,
           format('Setor "%s" criado copiando o cargo %s', trim(p_nome), c.nome)
      from public.pesos_por_cargo p
     where p.cargo_id = c.id
       and (p_monitorias or p.regra <> 'monitoria')
       and p.regra not like 'outro_setor_%'
    on conflict (cargo_id, regra) do nothing;
  end loop;

  -- Média da equipe: as referências entre os cargos copiados.
  insert into public.cargos_referencia (cargo_id, referencia_id)
  select (v_mapa ->> cr.cargo_id::text)::smallint, (v_mapa ->> cr.referencia_id::text)::smallint
    from public.cargos_referencia cr
   where v_mapa ? cr.cargo_id::text and v_mapa ? cr.referencia_id::text
  on conflict do nothing;

  return v_novo;
end;
$$;
revoke all on function public.clonar_setor(text, smallint, boolean) from public, anon;
grant execute on function public.clonar_setor(text, smallint, boolean) to authenticated;

-- 8. Fila nova: as regras vêm do setor DELA. Copiar uma fila de outro setor
-- aponta para as cópias do setor da fila; regras próprias ficam no setor.
create or replace function public.definir_regras_da_fila(p_fila smallint, p_copiar_de smallint, p_tme boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_fila public.canais_do_setor;
  v_orig public.canais_do_setor;
  v_final text;
  v_grupo text;
  r public.regras;
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor define as regras de uma fila.';
  end if;
  select * into v_fila from public.canais_do_setor where id = p_fila;
  if v_fila.id is null then raise exception 'Fila não encontrada.'; end if;
  if v_fila.regra_finalizado is not null then
    raise exception 'A fila "%" já tem regras.', v_fila.nome;
  end if;

  if p_copiar_de is not null then
    -- Copiar = apontar para as mesmas regras (no setor da fila): acompanha a original.
    select * into v_orig from public.canais_do_setor where id = p_copiar_de;
    if v_orig.regra_finalizado is null then
      raise exception 'A fila de origem não tem regras para copiar.';
    end if;
    update public.canais_do_setor
       set regra_finalizado = public.chave_no_setor(v_orig.regra_finalizado, v_fila.setor_id),
           grupo_tme  = case when p_tme then public.grupo_no_setor(v_orig.grupo_tme, v_fila.setor_id) end,
           grupo_csat = public.grupo_no_setor(v_orig.grupo_csat, v_fila.setor_id),
           grupo_nota = public.grupo_no_setor(v_orig.grupo_nota, v_fila.setor_id),
           copia_de   = v_orig.id
     where id = p_fila;
    return;
  end if;

  -- Próprias: regras novas com peso zero, no setor da fila, para os cargos do
  -- setor que pontuam finalizado. C-SAT e notas: as do setor.
  v_final := v_fila.apelido || '_finalizado';
  insert into public.regras (chave, grupo, rotulo, peso, faixa_min, faixa_max, ordem, manual, valor_manual, ativo, setor_id)
  values (v_final, 'atendimento', 'Finalizado ' || v_fila.nome, 0, null, null, 10 + v_fila.id, false, false, true, v_fila.setor_id)
  on conflict (chave) do nothing;
  insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo, motivo_alteracao)
  select distinct p.cargo_id, v_final, 0, true, format('Fila nova "%s"', v_fila.nome)
    from public.pesos_por_cargo p
    join public.regras x on x.chave = p.regra and x.grupo = 'atendimento'
    join public.cargos cg on cg.id = p.cargo_id and cg.setor_id = v_fila.setor_id
   where p.ativo
  on conflict (cargo_id, regra) do nothing;

  if p_tme then
    v_grupo := 'tme_' || v_fila.apelido;
    for r in select * from public.regras
              where grupo = public.grupo_no_setor('tme', v_fila.setor_id) and ativo order by ordem loop
      insert into public.regras (chave, grupo, rotulo, peso, faixa_min, faixa_max, ordem, manual, valor_manual, ativo, setor_id)
      values (v_fila.apelido || '_' || r.chave, v_grupo,
              replace(r.rotulo, 'TME Médio Equipe', 'TME ' || v_fila.nome), 0,
              r.faixa_min, r.faixa_max, r.ordem, false, false, true, v_fila.setor_id)
      on conflict (chave) do nothing;
      insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo, motivo_alteracao)
      select distinct p.cargo_id, v_fila.apelido || '_' || r.chave, 0, true, format('Fila nova "%s"', v_fila.nome)
        from public.pesos_por_cargo p
        join public.regras x on x.chave = p.regra and x.grupo = 'atendimento'
        join public.cargos cg on cg.id = p.cargo_id and cg.setor_id = v_fila.setor_id
       where p.ativo
      on conflict (cargo_id, regra) do nothing;
    end loop;
  end if;

  update public.canais_do_setor
     set regra_finalizado = v_final,
         grupo_tme  = case when p_tme then v_grupo end,
         grupo_csat = public.grupo_no_setor('csat', v_fila.setor_id),
         grupo_nota = public.grupo_no_setor('nota', v_fila.setor_id),
         copia_de   = null
   where id = p_fila;
end;
$$;

commit;

-- Conferência: tudo na Conexão Expansão, ninguém sem setor.
select 'pessoas sem setor' as item, count(*)::text as valor
  from public.pessoas p where not exists (select 1 from public.setores_da_pessoa s where s.pessoa_id = p.id)
union all
select 'pessoas na Conexão Expansão', count(distinct pessoa_id)::text from public.setores_da_pessoa where setor_id = 1
union all
select 'cargos fora do setor 1', count(*)::text from public.cargos where setor_id <> 1
union all
select 'regras fora do setor 1', count(*)::text from public.regras where setor_id <> 1
union all
select 'fechamentos fora do setor 1', count(*)::text from public.fechamentos_cota where setor_id <> 1
union all
select 'Conexão Expansão com monitorias', (select monitorias::text from public.setores where id = 1);
