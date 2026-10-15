-- ===========================================================================
-- 62 · Férias: quem vê e gestores no cadastro
--
-- Na 61, só o gestor via e cadastrava, e o gestor ficava fora da lista.
-- Agora:
--   - VER as férias (calendário, quem está fora, períodos que coincidem):
--     gestor, Qualidade e quem tem cargo Atendente Pleno ou Analista no mês
--     (mesma leitura de cargo do diário, migração 33);
--   - CADASTRAR, editar e excluir: só o gestor;
--   - o prazo da CLT segue só do gestor — é informação de RH;
--   - gestores entram no cadastro e no prazo, como qualquer pessoa.
--
-- Rode no SQL Editor do projeto dos painéis, inteiro. Pode rodar de novo.
-- ===========================================================================

create or replace function public.ve_ferias()
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_gestor() is true
      or coalesce(public.papel_atual() = 'qualidade', false)
      or coalesce(public.cargo_atual_nome() in ('Atendente Pleno', 'Analista'), false);
$$;
revoke all on function public.ve_ferias() from public, anon;
grant execute on function public.ve_ferias() to authenticated;

drop policy if exists ferias_gestor on public.ferias;
drop policy if exists ferias_le on public.ferias;
drop policy if exists ferias_gestor_grava on public.ferias;
drop policy if exists ferias_gestor_altera on public.ferias;
drop policy if exists ferias_gestor_exclui on public.ferias;
create policy ferias_le on public.ferias for select to authenticated using (public.ve_ferias());
create policy ferias_gestor_grava on public.ferias for insert to authenticated with check (public.eh_gestor());
create policy ferias_gestor_altera on public.ferias for update to authenticated
  using (public.eh_gestor()) with check (public.eh_gestor());
create policy ferias_gestor_exclui on public.ferias for delete to authenticated using (public.eh_gestor());

-- Prazo (CLT): o mesmo da 61, agora com os gestores.
create or replace function public.ferias_prazos_internos()
returns table (pessoa_id uuid, nome text, admitido_em date, aquisitivo_inicio date, aquisitivo_fim date,
               limite date, saldo int, dias_ate_limite int, completo boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  p      record;
  v_n    int;
  v_ini  date;
  v_fim  date;
  v_usados int;
  v_resto  int;
begin
  for p in
    select pe.id, pe.nome, pe.admitido_em from public.pessoas pe
     where pe.ativo and pe.desligado_em is null
     order by pe.nome
  loop
    pessoa_id := p.id; nome := p.nome; admitido_em := p.admitido_em;
    if p.admitido_em is null then
      aquisitivo_inicio := null; aquisitivo_fim := null; limite := null;
      saldo := null; dias_ate_limite := null; completo := null;
      return next;
      continue;
    end if;

    -- Dias de férias desde a entrada; abatem os períodos do mais antigo.
    select coalesce(sum(f.fim - f.inicio + 1), 0) into v_resto
      from public.ferias f where f.pessoa_id = p.id and f.inicio >= p.admitido_em;

    v_n := 0;
    loop
      v_ini := (p.admitido_em + make_interval(years => v_n))::date;
      v_fim := (p.admitido_em + make_interval(years => v_n + 1))::date - 1;
      v_usados := least(30, v_resto);
      v_resto := v_resto - v_usados;
      -- Para no primeiro período com saldo, ou no que está correndo.
      if v_usados < 30 or v_fim >= v_hoje then
        aquisitivo_inicio := v_ini;
        aquisitivo_fim := v_fim;
        limite := (p.admitido_em + make_interval(years => v_n + 2))::date - 1;
        saldo := 30 - v_usados;
        dias_ate_limite := limite - v_hoje;
        completo := v_fim < v_hoje;
        return next;
        exit;
      end if;
      v_n := v_n + 1;
      exit when v_n > 60;
    end loop;
  end loop;
end;
$$;
revoke all on function public.ferias_prazos_internos() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_policies where tablename = 'ferias') as politicas,            -- 4
  (select count(*) from public.ferias_prazos_internos()) as pessoas_no_prazo;            -- 61 + os gestores
