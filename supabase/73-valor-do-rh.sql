-- ============================================================================
-- 73 · Valor encaminhado pelo RH
--
-- No Fechamento, o gestor informa, por pessoa, o valor que o RH mandou pagar
-- (R$). Com valor por ponto informado, a tela mostra o calculado ao lado e a
-- diferença; sem ele, só guarda e mostra. O atendente vê no extrato o valor
-- do RH no lugar do calculado (decisão do gestor, 21/10/2026).
--
-- Só para quem está fechado no mês e bateu a meta. Mudar um valor já
-- informado pede o motivo; toda mudança fica em valores_rh_alteracoes.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

create table if not exists public.valores_rh (
  pessoa_id          uuid not null references public.pessoas (id) on delete cascade,
  mes_competencia    date not null,
  valor              numeric(12,2) not null check (valor >= 0),
  informado_por      uuid references public.pessoas (id) on delete set null,
  informado_por_nome text,
  informado_em       timestamptz not null default now(),
  primary key (pessoa_id, mes_competencia)
);
alter table public.valores_rh enable row level security;
drop policy if exists valores_rh_leitura on public.valores_rh;
create policy valores_rh_leitura on public.valores_rh
  for select using (public.eh_gestor() or pessoa_id = public.pessoa_atual());

create table if not exists public.valores_rh_alteracoes (
  id              bigint generated always as identity primary key,
  pessoa_id       uuid references public.pessoas (id) on delete set null,
  pessoa_nome     text,
  mes_competencia date not null,
  valor_anterior  numeric(12,2),
  valor_novo      numeric(12,2),
  motivo          text,
  autor_nome      text,
  criado_em       timestamptz not null default now()
);
alter table public.valores_rh_alteracoes enable row level security;
drop policy if exists valores_rh_alteracoes_leitura on public.valores_rh_alteracoes;
create policy valores_rh_alteracoes_leitura on public.valores_rh_alteracoes for select using (public.eh_gestor());

-- p_valores = [{ pessoa_id, valor }] — valor nulo apaga. Devolve quantos mudaram.
create or replace function public.salvar_valores_rh(p_mes date, p_valores jsonb, p_motivo text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_eu    text;
  v_x     jsonb;
  v_p     uuid;
  v_novo  numeric(12,2);
  v_antes numeric(12,2);
  v_n     integer := 0;
begin
  if public.eh_gestor() is not true then raise exception 'Só o gestor informa o valor do RH.'; end if;
  select nome into v_eu from public.pessoas where id = public.pessoa_atual();

  for v_x in select * from jsonb_array_elements(coalesce(p_valores, '[]'::jsonb)) loop
    v_p := (v_x->>'pessoa_id')::uuid;
    v_novo := nullif(v_x->>'valor', '')::numeric;
    if v_novo is not null and v_novo < 0 then raise exception 'Valor negativo não vale.'; end if;
    if v_novo is not null and not exists (
         select 1 from public.fechamentos_cota f
          where f.pessoa_id = v_p and f.mes_competencia = p_mes and f.meta is not null and f.resultado >= f.meta) then
      raise exception 'Só quem está fechado no mês e bateu a meta recebe valor (%).',
        (select nome from public.pessoas where id = v_p);
    end if;
    select valor into v_antes from public.valores_rh where pessoa_id = v_p and mes_competencia = p_mes;
    if v_antes is not distinct from v_novo then continue; end if;
    if v_antes is not null and nullif(trim(coalesce(p_motivo, '')), '') is null then
      raise exception 'Escreva o motivo: um valor já informado está mudando.';
    end if;

    if v_novo is null then
      delete from public.valores_rh where pessoa_id = v_p and mes_competencia = p_mes;
    else
      insert into public.valores_rh (pessoa_id, mes_competencia, valor, informado_por, informado_por_nome, informado_em)
      values (v_p, p_mes, v_novo, public.pessoa_atual(), v_eu, now())
      on conflict (pessoa_id, mes_competencia) do update
        set valor = excluded.valor, informado_por = excluded.informado_por,
            informado_por_nome = excluded.informado_por_nome, informado_em = now();
    end if;
    insert into public.valores_rh_alteracoes (pessoa_id, pessoa_nome, mes_competencia, valor_anterior, valor_novo, motivo, autor_nome)
    values (v_p, (select nome from public.pessoas where id = v_p), p_mes, v_antes, v_novo, nullif(trim(coalesce(p_motivo, '')), ''), v_eu);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.salvar_valores_rh(date, jsonb, text) from public, anon;
grant execute on function public.salvar_valores_rh(date, jsonb, text) to authenticated;

-- Conferência
select (select count(*) from pg_proc where proname = 'salvar_valores_rh') as funcao_criada,
       (select count(*) from information_schema.tables where table_schema = 'public'
         and table_name in ('valores_rh', 'valores_rh_alteracoes')) as tabelas_criadas;
