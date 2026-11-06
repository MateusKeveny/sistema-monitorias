-- ============================================================================
-- 99 · Assuntos do C-SAT e volume da Sol (Performance 3.9.0)
--
--   · Assuntos mais tratados: a tabulação já vem no relatório do C-SAT e já é
--     gravada em cada avaliação (avaliacoes.tabulacao). assuntos_do_mes()
--     soma, no mês e por fila, as avaliações e as positivas de cada
--     tabulação (completa, como vem no relatório) — a mesma regra do C-SAT:
--     notas de 1 a 5, positiva a partir de 4. Respeita quem vê o quê (RLS).
--   · Volume da Sol (a IA): a gestão lança, por fila e semana, o número geral
--     de atendimentos e quantos a Sol resolveu. Só informação: não pontua.
--
-- Aditiva: não mexe em cálculo nem em nada que existe. Independe da 98 (4.0).
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro. Pode rodar de novo.
-- ============================================================================

-- ------------------------------------------------------- 1. Volume da Sol
create table if not exists public.volume_ia (
  id               bigint generated always as identity primary key,
  canal_id         smallint not null references public.canais_do_setor (id) on delete cascade,
  mes_competencia  date not null,
  semana           smallint not null check (semana between 1 and 4),
  -- O número geral do canal na semana e quantos a Sol resolveu.
  total            integer check (total >= 0),
  resolvidos_ia    integer check (resolvidos_ia >= 0),
  salvo_por        uuid references public.pessoas (id) on delete set null,
  salvo_por_nome   text,
  salvo_em         timestamptz not null default now(),
  unique (canal_id, mes_competencia, semana),
  check (total is null or resolvidos_ia is null or resolvidos_ia <= total)
);
create index if not exists volume_ia_mes_idx on public.volume_ia (mes_competencia);

alter table public.volume_ia enable row level security;
-- Quem vê o time lê o da fila do seu setor (o administrador, todas); o
-- gestor do setor lança. Mesmo critério das outras tabelas da árvore (94).
drop policy if exists volume_ia_leitura on public.volume_ia;
create policy volume_ia_leitura on public.volume_ia
  for select using ((select public.ve_o_time()) and public.cuida_do_canal(canal_id));
drop policy if exists volume_ia_gestor on public.volume_ia;
create policy volume_ia_gestor on public.volume_ia
  for all using ((select public.eh_gestor()) and public.cuida_do_canal(canal_id))
  with check ((select public.eh_gestor()) and public.cuida_do_canal(canal_id));
grant select, insert, update, delete on public.volume_ia to authenticated;

-- Quem salvou, gravado pelo banco (não pela tela).
create or replace function public.volume_ia_quem_salvou()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.salvo_por := public.pessoa_atual();
  new.salvo_por_nome := (select nome from pessoas where id = new.salvo_por);
  new.salvo_em := now();
  return new;
end;
$$;
drop trigger if exists volume_ia_quem_salvou on public.volume_ia;
create trigger volume_ia_quem_salvou before insert or update on public.volume_ia
  for each row execute function public.volume_ia_quem_salvou();

-- ------------------------------------------------ 2. Assuntos mais tratados
-- O mês de competência vai do dia 26 do anterior ao 25 (mes_de_competencia).
-- Por fila (canal_id), para valer para qualquer setor que entrar na árvore;
-- avaliação antiga sem canal_id cai na fila pelo apelido (origem).
-- Espaços repetidos viram um só, para a mesma tabulação não se dividir.
drop function if exists public.assuntos_do_mes(date);
create or replace function public.assuntos_do_mes(p_mes date)
returns table (canal_id smallint, assunto text, avaliacoes bigint, positivas bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(a.canal_id, (select c.id from canais_do_setor c where c.apelido = a.origem order by c.id limit 1))::smallint,
         coalesce(nullif(regexp_replace(btrim(a.tabulacao), '\s+', ' ', 'g'), ''), '(sem tabulação)') as assunto,
         count(*) as avaliacoes,
         count(*) filter (where a.nota >= 4) as positivas
    from avaliacoes a
   where a.data between ((p_mes - interval '1 month')::date + 25) and (p_mes + 24)
     and a.nota between 1 and 5
   group by 1, 2;
$$;
revoke all on function public.assuntos_do_mes(date) from public, anon;
grant execute on function public.assuntos_do_mes(date) to authenticated;

notify pgrst, 'reload schema';
