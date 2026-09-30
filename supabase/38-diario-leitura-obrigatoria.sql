-- ============================================================================
-- 38 · Diário de bordo: leitura obrigatória
--
-- Processo novo e treinamento concluídos precisam ser lidos por todos. Quem
-- tem leitura pendente, ao entrar no Performance, confirma "Li e estou
-- ciente" em cada um antes de usar o painel. Gestor e Pleno acompanham quem
-- leu e quem falta.
--
-- Quem confirma: toda pessoa ativa com acesso, menos o gestor e o autor do
-- registro. O que conta: processo e treinamento concluídos que ainda valem —
-- com validade em dia, ou sem validade e do dia do ocorrido para cá há até 30
-- dias. Autorização e exceção seguem só para consulta.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create table if not exists public.diario_leituras (
  registro_id  uuid not null references public.diario_registros (id) on delete cascade,
  pessoa_id    uuid not null default public.pessoa_atual() references public.pessoas (id) on delete cascade,
  ciente_em    timestamptz not null default now(),
  primary key (registro_id, pessoa_id)
);

alter table public.diario_leituras enable row level security;

-- Cada um vê as próprias confirmações; gestor e Pleno veem todas.
drop policy if exists leituras_leitura on public.diario_leituras;
create policy leituras_leitura on public.diario_leituras
  for select using (pessoa_id = public.pessoa_atual() or public.aprova_diario());

-- Confirmar, só em nome próprio. Não há política de alterar nem de apagar:
-- confirmação dada não se desfaz.
drop policy if exists leituras_confirmar on public.diario_leituras;
create policy leituras_confirmar on public.diario_leituras
  for insert with check (pessoa_id = public.pessoa_atual());

-- ---------------------------------------------------------------------------
-- Quem precisa ler o quê (e se já leu)
--
-- Uma linha por registro que exige leitura × pessoa que precisa ler. Só
-- gestor e Pleno veem todas as linhas; os demais, só as próprias.
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
     and p.papel <> 'gestor' and p.id <> r.pessoa_id
    left join public.diario_leituras l on l.registro_id = r.id and l.pessoa_id = p.id
   where r.tipo in ('processo', 'treinamento')
     and r.situacao = 'concluido'
     and (r.valido_ate >= hoje.d or (r.valido_ate is null and r.data >= hoje.d - 30))
     and (public.aprova_diario() or p.id = public.pessoa_atual());
$$;

revoke all on function public.leituras_do_diario() from public, anon;
grant execute on function public.leituras_do_diario() to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: a tabela e quantas leituras cada pessoa tem pendentes hoje
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'diario_leituras') as tabela_de_leituras,
  (select count(*) from pg_proc where proname = 'leituras_do_diario') as funcao_de_leituras,
  (select count(*) from public.diario_registros
    where tipo in ('processo', 'treinamento') and situacao = 'concluido') as registros_que_exigem_leitura;
