-- ============================================================================
-- 46 · Diário de bordo: problema operacional
--
-- Tipo novo, "Problema operacional", com subcategoria obrigatória. Só a
-- gestão registra — gestor e Pleno, quem aprova (migração 33) —, e toda a
-- equipe vê. Sem protocolo, com validade opcional, sem leitura obrigatória;
-- avisa no Teams em "Novidades do diário".
--
-- As subcategorias são uma lista que o gestor mantém em Configuração ›
-- Diário de bordo: incluir, renomear, reordenar e desativar. Desativada, sai
-- do formulário mas continua nos registros antigos. Começa com Backoffice,
-- Hub, Operacional e Autorizações.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create table if not exists public.diario_subcategorias (
  id         smallint generated always as identity primary key,
  nome       text not null unique check (length(trim(nome)) > 0),
  ordem      smallint not null default 0,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

insert into public.diario_subcategorias (nome, ordem) values
  ('Backoffice', 1), ('Hub', 2), ('Operacional', 3), ('Autorizações', 4)
on conflict (nome) do nothing;

alter table public.diario_subcategorias enable row level security;
-- Todos leem (o selo aparece para a equipe); só o gestor mantém a lista.
drop policy if exists subcategorias_leitura on public.diario_subcategorias;
create policy subcategorias_leitura on public.diario_subcategorias
  for select using (public.papel_atual() is not null);
drop policy if exists subcategorias_gestor on public.diario_subcategorias;
create policy subcategorias_gestor on public.diario_subcategorias
  for all using (public.eh_gestor()) with check (public.eh_gestor());

alter table public.diario_registros drop constraint if exists diario_registros_tipo_check;
alter table public.diario_registros add constraint diario_registros_tipo_check
  check (tipo in ('processo', 'treinamento', 'autorizacao', 'excecao', 'problema'));

alter table public.diario_registros add column if not exists subcategoria_id smallint
  references public.diario_subcategorias (id) on delete restrict;
alter table public.diario_registros drop constraint if exists diario_subcategoria_valida;
alter table public.diario_registros add constraint diario_subcategoria_valida check (
  (tipo = 'problema' and subcategoria_id is not null) or (tipo <> 'problema' and subcategoria_id is null)
);

-- Registrar: em nome próprio; problema operacional, só a gestão.
drop policy if exists diario_registro on public.diario_registros;
create policy diario_registro on public.diario_registros
  for insert with check (
    public.pessoa_atual() is not null and pessoa_id = public.pessoa_atual()
    and (tipo <> 'problema' or public.aprova_diario())
  );

-- Correção de um devolvido: o autor não transforma o registro em problema.
drop policy if exists diario_correcao on public.diario_registros;
create policy diario_correcao on public.diario_registros
  for update using (pessoa_id = public.pessoa_atual() and situacao = 'devolvido')
  with check (pessoa_id = public.pessoa_atual() and (tipo <> 'problema' or public.aprova_diario()));

-- Aviso no Teams (a da 42, com o problema operacional).
create or replace function public.aviso_diario_novo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_rotulo text := case new.tipo when 'treinamento' then 'Novo treinamento'
                                 when 'problema' then 'Problema operacional · '
                                   || coalesce((select nome from public.diario_subcategorias where id = new.subcategoria_id), '—')
                                 else 'Novo processo' end;
  v_texto  text := regexp_replace(new.descricao, '\s+', ' ', 'g');
  v_fatos  jsonb;
begin
  if new.tipo not in ('processo', 'treinamento', 'problema') or new.situacao <> 'concluido' then return null; end if;
  if tg_op = 'UPDATE' and old.situacao = 'concluido' then return null; end if;
  if not (new.valido_ate >= v_hoje or (new.valido_ate is null and new.data >= v_hoje - 30)) then return null; end if;

  -- Só um resumo: o texto inteiro fica no painel.
  if length(v_texto) > 280 then
    v_texto := rtrim(left(v_texto, 280)) || '…';
  end if;

  v_fatos := jsonb_build_array(jsonb_build_object('title', 'Registrado por', 'value',
    coalesce((select nome from public.pessoas where id = new.pessoa_id), '—')));
  if new.valido_ate is not null then
    v_fatos := v_fatos || jsonb_build_object('title', 'Vale até', 'value', to_char(new.valido_ate, 'DD/MM/YYYY'));
  end if;

  perform public.enviar_aviso_teams('diario_novidades', 'diario/' || new.id, new.assunto,
    public.cartao_teams(v_rotulo, case when new.tipo = 'problema' then 'Attention' else 'Accent' end, new.assunto,
      v_texto || case when new.tipo = 'problema' then '' else E'\n\nA leitura é obrigatória: confirme no painel.' end,
      v_fatos, case when new.tipo = 'problema' then 'Ver no diário' else 'Ler e confirmar no painel' end,
      public.endereco_do_site('performance') || '/cota' || case when new.tipo = 'problema' then '/diario' else '' end));
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select string_agg(nome, ', ' order by ordem) from public.diario_subcategorias where ativo) as subcategorias,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'diario_registros' and column_name = 'subcategoria_id') as coluna_subcategoria,
  (select count(*) from pg_constraint where conname in ('diario_registros_tipo_check', 'diario_subcategoria_valida')) as travas;
