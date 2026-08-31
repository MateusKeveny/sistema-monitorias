-- ============================================================================
-- Row Level Security: quem enxerga e edita o quê.
-- Rode DEPOIS de 01-schema.sql.
-- ============================================================================

-- Funções auxiliares. SECURITY DEFINER para poderem ler public.perfis
-- sem cair na própria RLS (evita recursão infinita nas políticas).
create or replace function public.papel_atual()
returns public.papel_usuario language sql stable security definer set search_path = public as $$
  select papel from public.perfis where id = auth.uid() and ativo;
$$;

create or replace function public.operador_atual()
returns uuid language sql stable security definer set search_path = public as $$
  select operador_id from public.perfis where id = auth.uid() and ativo;
$$;

create or replace function public.eh_admin()
returns boolean language sql stable as $$ select public.papel_atual() = 'admin'; $$;

create or replace function public.eh_gestor_ou_admin()
returns boolean language sql stable as $$
  select public.papel_atual() in ('admin', 'gestor');
$$;

alter table public.perfis           enable row level security;
alter table public.operadores       enable row level security;
alter table public.canais           enable row level security;
alter table public.criterios        enable row level security;
alter table public.monitorias       enable row level security;
alter table public.monitoria_itens  enable row level security;

-- ------------------------------------------------------------------ perfis
drop policy if exists perfis_ler_proprio on public.perfis;
create policy perfis_ler_proprio on public.perfis
  for select using (id = auth.uid() or public.eh_gestor_ou_admin());

drop policy if exists perfis_editar_proprio on public.perfis;
create policy perfis_editar_proprio on public.perfis
  for update using (id = auth.uid())
  with check (id = auth.uid() and papel = public.papel_atual());

drop policy if exists perfis_admin_total on public.perfis;
create policy perfis_admin_total on public.perfis
  for all using (public.eh_admin()) with check (public.eh_admin());

-- ------------------------------------------------- cadastros (leitura geral)
drop policy if exists operadores_leitura on public.operadores;
create policy operadores_leitura on public.operadores
  for select using (auth.uid() is not null);

drop policy if exists operadores_admin on public.operadores;
create policy operadores_admin on public.operadores
  for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists canais_leitura on public.canais;
create policy canais_leitura on public.canais
  for select using (auth.uid() is not null);

drop policy if exists canais_admin on public.canais;
create policy canais_admin on public.canais
  for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists criterios_leitura on public.criterios;
create policy criterios_leitura on public.criterios
  for select using (auth.uid() is not null);

drop policy if exists criterios_admin on public.criterios;
create policy criterios_admin on public.criterios
  for all using (public.eh_admin()) with check (public.eh_admin());

-- -------------------------------------------------------------- monitorias
-- Operador vê apenas as próprias; gestor e admin veem todas.
drop policy if exists monitorias_leitura on public.monitorias;
create policy monitorias_leitura on public.monitorias
  for select using (
    public.eh_gestor_ou_admin()
    or operador_id = public.operador_atual()
  );

-- Somente a qualidade (admin) lança e edita monitorias.
drop policy if exists monitorias_escrita on public.monitorias;
create policy monitorias_escrita on public.monitorias
  for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists itens_leitura on public.monitoria_itens;
create policy itens_leitura on public.monitoria_itens
  for select using (
    exists (
      select 1 from public.monitorias m
      where m.id = monitoria_id
        and (public.eh_gestor_ou_admin() or m.operador_id = public.operador_atual())
    )
  );

drop policy if exists itens_escrita on public.monitoria_itens;
create policy itens_escrita on public.monitoria_itens
  for all using (public.eh_admin()) with check (public.eh_admin());
