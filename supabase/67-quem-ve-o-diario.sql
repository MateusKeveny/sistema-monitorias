-- ============================================================================
-- 67 · Diário de bordo: quem vê cada tipo de registro, configurável
--
-- Até aqui a regra de leitura do diário era fixa: todos viam tudo, menos o
-- problema operacional (migração 51). A pedido do gestor (16/10/2026), quem vê
-- cada tipo passa a ser configuração, em Configuração › Diário de bordo:
--   - quem vê: todos, a gestão (gestor e Pleno — quem aprova, migração 33) ou
--     só o gestor;
--   - se quem registrou continua vendo o próprio registro.
-- Começa como o gestor decidiu: autorização e exceção só para a gestão, com
-- quem registrou vendo o próprio; problema operacional da gestão; processo e
-- treinamento para todos.
--
-- Vale no Performance e na consulta do diário pelo Monitorias (a regra é do
-- banco). Registrar não muda. Processo e treinamento têm leitura obrigatória
-- e aviso no Teams: se um dia ficarem restritos, a leitura só é cobrada de
-- quem vê, e o aviso não vai para o canal da equipe.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo (não apaga o que já foi configurado). No fim ele mostra a
-- configuração e quantos registros de cada tipo há.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A configuração
-- ---------------------------------------------------------------------------
create table if not exists public.diario_visibilidade (
  tipo        text primary key check (tipo in ('processo', 'treinamento', 'autorizacao', 'excecao', 'problema')),
  quem        text not null check (quem in ('todos', 'gestao', 'gestor')),
  autor_ve    boolean not null default true,
  alterado_por_nome text,
  alterado_em timestamptz not null default now()
);

insert into public.diario_visibilidade (tipo, quem, autor_ve) values
  ('processo', 'todos', true),
  ('treinamento', 'todos', true),
  ('autorizacao', 'gestao', true),
  ('excecao', 'gestao', true),
  ('problema', 'gestao', true)
on conflict (tipo) do nothing;

-- Todos leem a configuração (não tem nada sigiloso: é "quem vê o quê");
-- mudar, só o gestor, pela função abaixo.
alter table public.diario_visibilidade enable row level security;
drop policy if exists diario_visibilidade_leitura on public.diario_visibilidade;
create policy diario_visibilidade_leitura on public.diario_visibilidade
  for select using (public.papel_atual() is not null);
revoke all on public.diario_visibilidade from anon;
revoke insert, update, delete, truncate on public.diario_visibilidade from authenticated;
grant select on public.diario_visibilidade to authenticated;

create or replace function public.definir_visibilidade_diario(p_tipo text, p_quem text, p_autor_ve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor muda quem vê o diário.';
  end if;
  update public.diario_visibilidade
     set quem = p_quem, autor_ve = p_autor_ve, alterado_em = now(),
         alterado_por_nome = (select nome from public.pessoas where id = public.pessoa_atual())
   where tipo = p_tipo;
  if not found then
    raise exception 'Tipo de registro desconhecido: %', p_tipo;
  end if;
end;
$$;
revoke all on function public.definir_visibilidade_diario(text, text, boolean) from public, anon;
grant execute on function public.definir_visibilidade_diario(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A regra, para qualquer pessoa: a leitura obrigatória precisa saber se
--    cada atendente vê o registro, não só quem está logado. "Gestão" é a
--    mesma de aprova_diario(): o gestor e o cargo Pleno na data de hoje.
-- ---------------------------------------------------------------------------
create or replace function public.pessoa_ve_diario(p_pessoa uuid, p_tipo text, p_autor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case v.quem
             when 'todos' then true
             when 'gestor' then p.papel = 'gestor'
             else p.papel = 'gestor'
                  or coalesce((select c.nome from public.cargos c
                                where c.id = public.cargo_na_competencia(
                                  p.id, (now() at time zone 'America/Sao_Paulo')::date)) = 'Atendente Pleno', false)
           end
           or (v.autor_ve and p_autor = p_pessoa)
      from public.diario_visibilidade v
      join public.pessoas p on p.id = p_pessoa
     where v.tipo = p_tipo), false);
$$;
revoke all on function public.pessoa_ve_diario(uuid, text, uuid) from public, anon;
grant execute on function public.pessoa_ve_diario(uuid, text, uuid) to authenticated;

-- A leitura da tabela: quem está logado vê o registro?
drop policy if exists diario_leitura on public.diario_registros;
create policy diario_leitura on public.diario_registros
  for select using (
    public.papel_atual() is not null
    and public.pessoa_ve_diario(public.pessoa_atual(), tipo, pessoa_id)
  );

-- ---------------------------------------------------------------------------
-- 3. Leitura obrigatória (a da migração 39) cobrada só de quem vê o registro
-- ---------------------------------------------------------------------------
create or replace function public.leituras_do_diario()
returns table (registro_id uuid, pessoa_id uuid, nome text, ciente_em timestamptz)
language sql stable security definer set search_path = public as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select r.id, p.id, p.nome, l.ciente_em
    from public.diario_registros r
    cross join hoje
    join public.pessoas p
      on p.ativo and p.desligado_em is null and p.auth_id is not null
     and p.papel <> 'gestor' and p.id <> r.pessoa_id and not p.perfil_de_teste
    left join public.diario_leituras l on l.registro_id = r.id and l.pessoa_id = p.id
   where r.tipo in ('processo', 'treinamento')
     and r.situacao = 'concluido'
     and (r.valido_ate >= hoje.d or (r.valido_ate is null and r.data >= hoje.d - 30))
     and (public.aprova_diario() or p.id = public.pessoa_atual())
     -- 67: só de quem vê o registro.
     and public.pessoa_ve_diario(p.id, r.tipo, r.pessoa_id);
$$;

-- ---------------------------------------------------------------------------
-- 4. Aviso no Teams (o da 51): só quando o tipo é visível a todos
-- ---------------------------------------------------------------------------
create or replace function public.aviso_diario_novo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_rotulo text := case new.tipo when 'treinamento' then 'Novo treinamento' else 'Novo processo' end;
  v_texto  text := regexp_replace(new.descricao, '\s+', ' ', 'g');
  v_fatos  jsonb;
begin
  if new.tipo not in ('processo', 'treinamento') or new.situacao <> 'concluido' then return null; end if;
  if tg_op = 'UPDATE' and old.situacao = 'concluido' then return null; end if;
  -- 67: o canal é da equipe toda; tipo restrito não avisa lá.
  if not exists (select 1 from public.diario_visibilidade where tipo = new.tipo and quem = 'todos') then
    return null;
  end if;
  if not (coalesce(new.valido_ate >= v_hoje, false)
          or (new.valido_ate is null and new.data >= v_hoje - 30)) then
    return null;
  end if;

  -- Só um resumo: o texto inteiro fica no painel, onde a leitura é confirmada.
  if length(v_texto) > 280 then
    v_texto := rtrim(left(v_texto, 280)) || '…';
  end if;

  v_fatos := jsonb_build_array(jsonb_build_object('title', 'Registrado por', 'value',
    coalesce((select nome from public.pessoas where id = new.pessoa_id), '—')));
  if new.valido_ate is not null then
    v_fatos := v_fatos || jsonb_build_object('title', 'Vale até', 'value', to_char(new.valido_ate, 'DD/MM/YYYY'));
  end if;

  perform public.enviar_aviso_teams('diario_novidades', 'diario/' || new.id, new.assunto,
    public.cartao_teams(v_rotulo, 'Accent', new.assunto,
      v_texto || E'\n\nA leitura é obrigatória: confirme no painel.',
      v_fatos, 'Ler e confirmar no painel', public.endereco_do_site('performance') || '/cota'));
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conferência: a configuração e os registros de cada tipo
-- ---------------------------------------------------------------------------
select v.tipo, v.quem, v.autor_ve,
       (select count(*) from public.diario_registros r where r.tipo = v.tipo) as registros
  from public.diario_visibilidade v
 order by array_position(array['processo', 'treinamento', 'autorizacao', 'excecao', 'problema'], v.tipo);
