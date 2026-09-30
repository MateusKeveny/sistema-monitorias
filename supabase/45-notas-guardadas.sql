-- ============================================================================
-- 45 · Notas guardadas sem atendente reconhecido
--
-- Até aqui, avaliação de atendente cujo nome não batia com nenhum "Nome no
-- Hub" era descartada na importação. Agora ela fica guardada (sem contar na
-- cota) com o nome como veio no arquivo. Conversas só com o robô ("Sem
-- atendente…") continuam ignoradas: não há a quem atribuir.
--
-- Ao gravar um Nome no Hub (ou um nome a mais), as notas guardadas com esse
-- nome entram sozinhas na cota da pessoa — função salvar_nome_hub. No quadro
-- da tela Importar o gestor também atribui ou descarta à mão.
--
-- Mês já fechado: a nota entra no cálculo vivo, mas o fechamento não muda
-- sozinho. As funções devolvem quais meses fechados foram tocados.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create extension if not exists unaccent with schema extensions;

-- Nome comparável: sem acento, sem espaço nas pontas, minúsculo — a mesma
-- normalização que a tela de importação usa.
create or replace function public.nome_comparavel(p text)
returns text language sql immutable parallel safe set search_path = public, extensions as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, trim(coalesce(p, ''))));
$$;

-- Outros nomes da mesma pessoa no Hub (o relatório às vezes muda a grafia).
alter table public.pessoas add column if not exists nomes_hub_extras text[] not null default '{}';

create table if not exists public.avaliacoes_guardadas (
  id               uuid primary key default uuid_generate_v4(),
  nome_no_arquivo  text not null,
  nome_normalizado text generated always as (public.nome_comparavel(nome_no_arquivo)) stored,
  origem           text not null check (origem in ('huggy', 'diretores')),
  data             date not null,
  protocolo        text not null,
  nota             smallint not null check (nota between 1 and 5),
  tabulacao        text,
  origem_arquivo   text,
  importado_por    uuid references public.pessoas (id) on delete set null,
  importado_em     timestamptz not null default now(),
  situacao         text not null default 'guardada' check (situacao in ('guardada', 'atribuida', 'descartada')),
  pessoa_id        uuid references public.pessoas (id) on delete set null,
  resolvido_por    uuid references public.pessoas (id) on delete set null,
  resolvido_em     timestamptz,
  unique (data, protocolo)
);

create index if not exists guardadas_nome on public.avaliacoes_guardadas (nome_normalizado) where situacao = 'guardada';

alter table public.avaliacoes_guardadas enable row level security;
drop policy if exists guardadas_gestor on public.avaliacoes_guardadas;
create policy guardadas_gestor on public.avaliacoes_guardadas
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- ---------------------------------------------------------------------------
-- Atribuir as notas guardadas de um nome a uma pessoa
--
-- Devolve {quantidade, meses, fechados}: meses em que entraram e, destes, os
-- já fechados — para a tela avisar que o fechamento não muda sozinho.
-- ---------------------------------------------------------------------------
create or replace function public.atribuir_guardadas(p_nome text, p_pessoa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_nome  text := public.nome_comparavel(p_nome);
  v_ids   uuid[];
  v_meses date[];
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor atribui notas guardadas.';
  end if;

  select array_agg(id), array_agg(distinct public.mes_de_competencia(data))
    into v_ids, v_meses
    from public.avaliacoes_guardadas
   where situacao = 'guardada' and nome_normalizado = v_nome;

  if v_ids is null then
    return jsonb_build_object('quantidade', 0, 'meses', '[]'::jsonb, 'fechados', '[]'::jsonb);
  end if;

  -- A mesma avaliação já na cota (data + protocolo) não entra de novo.
  insert into public.avaliacoes (pessoa_id, origem, data, protocolo, nota, tabulacao, origem_arquivo, importado_por, importado_em)
  select p_pessoa, g.origem, g.data, g.protocolo, g.nota, g.tabulacao, g.origem_arquivo, public.pessoa_atual(), now()
    from public.avaliacoes_guardadas g
   where g.id = any (v_ids)
  on conflict (data, protocolo) do nothing;

  update public.avaliacoes_guardadas
     set situacao = 'atribuida', pessoa_id = p_pessoa, resolvido_por = public.pessoa_atual(), resolvido_em = now()
   where id = any (v_ids);

  return jsonb_build_object(
    'quantidade', array_length(v_ids, 1),
    'meses', to_jsonb(v_meses),
    'fechados', coalesce((select jsonb_agg(distinct f.mes_competencia) from public.fechamentos_cota f
                           where f.mes_competencia = any (v_meses)), '[]'::jsonb));
end;
$$;

revoke all on function public.atribuir_guardadas(text, uuid) from public, anon;
grant execute on function public.atribuir_guardadas(text, uuid) to authenticated;

create or replace function public.descartar_guardadas(p_nome text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor descarta notas guardadas.';
  end if;
  update public.avaliacoes_guardadas
     set situacao = 'descartada', resolvido_por = public.pessoa_atual(), resolvido_em = now()
   where situacao = 'guardada' and nome_normalizado = public.nome_comparavel(p_nome);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.descartar_guardadas(text) from public, anon;
grant execute on function public.descartar_guardadas(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Gravar um nome no Hub e trazer as notas guardadas com ele
--
-- p_extra = false troca o Nome no Hub principal; true acrescenta um nome a
-- mais. Em ambos, as notas guardadas com o nome entram na hora.
-- ---------------------------------------------------------------------------
create or replace function public.salvar_nome_hub(p_pessoa uuid, p_nome text, p_extra boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_nome text := nullif(trim(coalesce(p_nome, '')), '');
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor altera o Nome no Hub.';
  end if;

  if p_extra then
    if v_nome is null then raise exception 'Informe o nome.'; end if;
    update public.pessoas
       set nomes_hub_extras = array(select distinct unnest(nomes_hub_extras || v_nome))
     where id = p_pessoa;
  else
    update public.pessoas set nome_hub = v_nome where id = p_pessoa;
  end if;

  if v_nome is null then
    return jsonb_build_object('quantidade', 0, 'meses', '[]'::jsonb, 'fechados', '[]'::jsonb);
  end if;
  return public.atribuir_guardadas(v_nome, p_pessoa);
end;
$$;

revoke all on function public.salvar_nome_hub(uuid, text, boolean) from public, anon;
grant execute on function public.salvar_nome_hub(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select relrowsecurity from pg_class where relname = 'avaliacoes_guardadas') as guardadas_com_rls,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'pessoas' and column_name = 'nomes_hub_extras') as coluna_nomes_extras,
  public.nome_comparavel('  João Vitor ') as teste_do_nome;
