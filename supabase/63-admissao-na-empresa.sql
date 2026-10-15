-- ===========================================================================
-- 63 · Férias: admissão na empresa e atenção só com 1 ano no ano
--
-- Duas datas na ficha da pessoa (Atendentes):
--   - admitido_em         — entrada na EQUIPE (operação). É a da cota: decide
--                           de que mês a pessoa conta. Não muda.
--   - admitido_na_empresa — admissão na EMPRESA. Só para as férias: quem veio
--                           transferido de outra equipe tem o período
--                           aquisitivo contado daqui. Em branco, as férias
--                           usam a entrada na equipe.
--
-- Atenção do prazo da CLT (Performance e agenda): só para quem completa 1 ano
-- de casa até 31/12 do ano corrente. Quem entrou depois não é sinalizado.
--
-- Rode no SQL Editor do projeto dos painéis, inteiro. Pode rodar de novo.
-- ===========================================================================

alter table public.pessoas add column if not exists admitido_na_empresa date;
comment on column public.pessoas.admitido_na_empresa is
  'Admissão na empresa (para as férias). Em branco: as férias contam da entrada na equipe (admitido_em).';

-- Prazo: base = admissão na empresa, ou a entrada na equipe.
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
    select pe.id, pe.nome, coalesce(pe.admitido_na_empresa, pe.admitido_em) as admitido_em from public.pessoas pe
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

-- Ponte para a agenda: só sinaliza prazo de quem completa 1 ano até o fim do ano.
create or replace function public.ferias_para_agenda(p_segredo text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_segredo is null or p_segredo is distinct from (select valor from public.agenda_ponte where agenda_ponte.chave = 'segredo') then
    raise exception 'Não autorizado';
  end if;
  return jsonb_build_object(
    'ferias', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'pessoa', pe.nome, 'inicio', f.inicio, 'fim', f.fim,
                                          'situacao', f.situacao) order by f.inicio, pe.nome)
        from public.ferias f join public.pessoas pe on pe.id = f.pessoa_id
       where f.fim >= v_hoje - 7 and f.inicio <= v_hoje + 180
         and pe.ativo and pe.desligado_em is null), '[]'::jsonb),
    'prazos', coalesce((
      select jsonb_agg(jsonb_build_object('pessoa', z.nome, 'limite', z.limite, 'saldo', z.saldo,
                                          'dias', z.dias_ate_limite, 'completo', z.completo) order by z.dias_ate_limite)
        from public.ferias_prazos_internos() z
       where z.saldo > 0 and z.dias_ate_limite <= 120
         -- Só quem completa 1 ano de casa até o fim deste ano.
         and (z.admitido_em + interval '1 year')::date <= make_date(extract(year from v_hoje)::int, 12, 31)), '[]'::jsonb),
    'sem_entrada', (select count(*) from public.ferias_prazos_internos() z where z.admitido_em is null));
end;
$$;
revoke all on function public.ferias_para_agenda(text) from public, authenticated;
grant execute on function public.ferias_para_agenda(text) to anon;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'pessoas' and column_name = 'admitido_na_empresa') as coluna_nova,          -- 1
  (select count(*) from public.ferias_prazos_internos()) as pessoas_no_prazo,                     -- 12
  (select count(*) from public.ferias_prazos_internos() where admitido_em is null) as sem_data;
