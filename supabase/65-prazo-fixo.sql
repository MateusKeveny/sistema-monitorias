-- ===========================================================================
-- 65 · Férias: prazo de saída fixo e período concluído
--
-- Na 64, o "sair até" era o fim do concessivo menos os dias que faltavam: com
-- parte tirada, o prazo andava para frente. Não pode — o prazo é um só:
-- 30 dias antes do fim do período concessivo, tenha a pessoa tirado parte ou
-- não.
--
-- E a tela não dizia quando um período anterior tinha sido quitado (pelas
-- férias cadastradas ou pelos dias "fora do sistema"): pulava para o próximo
-- em silêncio. Agora o prazo devolve quantos períodos estão quitados e as
-- datas do último deles.
--
-- Muda o formato da resposta, por isso as funções são apagadas e criadas de
-- novo. Rode no SQL Editor do projeto dos painéis, inteiro.
-- ===========================================================================

drop function if exists public.ferias_prazos();
drop function if exists public.ferias_prazos_internos();

create or replace function public.ferias_prazos_internos()
returns table (pessoa_id uuid, nome text, admitido_em date, aquisitivo_inicio date, aquisitivo_fim date,
               limite date, saldo int, dias_ate_limite int, completo boolean,
               concluidos int, concluido_inicio date, concluido_fim date)
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
    select pe.id, pe.nome, coalesce(pe.admitido_na_empresa, pe.admitido_em) as admitido_em,
           pe.ferias_dias_fora from public.pessoas pe
     where pe.ativo and pe.desligado_em is null
     order by pe.nome
  loop
    pessoa_id := p.id; nome := p.nome; admitido_em := p.admitido_em;
    if p.admitido_em is null then
      aquisitivo_inicio := null; aquisitivo_fim := null; limite := null;
      saldo := null; dias_ate_limite := null; completo := null;
      concluidos := null; concluido_inicio := null; concluido_fim := null;
      return next;
      continue;
    end if;

    -- Dias de férias desde a entrada — os cadastrados mais os tirados fora do
    -- sistema; abatem os períodos do mais antigo.
    select coalesce(sum(f.fim - f.inicio + 1), 0) + p.ferias_dias_fora into v_resto
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
        saldo := 30 - v_usados;
        -- Último dia para SAIR, fixo: 30 dias antes do fim do concessivo, tenha
        -- tirado parte ou não (as férias têm de terminar dentro dele).
        limite := (p.admitido_em + make_interval(years => v_n + 2))::date - 30;
        dias_ate_limite := limite - v_hoje;
        completo := v_fim < v_hoje;
        -- Os períodos antes deste estão quitados; o último deles, para a tela.
        concluidos := v_n;
        concluido_inicio := case when v_n > 0 then (p.admitido_em + make_interval(years => v_n - 1))::date end;
        concluido_fim := case when v_n > 0 then (p.admitido_em + make_interval(years => v_n))::date - 1 end;
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

-- Para a tela do Performance (só gestor).
create or replace function public.ferias_prazos()
returns table (pessoa_id uuid, nome text, admitido_em date, aquisitivo_inicio date, aquisitivo_fim date,
               limite date, saldo int, dias_ate_limite int, completo boolean,
               concluidos int, concluido_inicio date, concluido_fim date)
language sql stable security definer set search_path = public as $$
  select * from public.ferias_prazos_internos() where public.eh_gestor();
$$;
revoke all on function public.ferias_prazos() from public, anon;
grant execute on function public.ferias_prazos() to authenticated;

-- A ponte da agenda, igual à 63 (lê o prazo novo).
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
select nome, aquisitivo_inicio, aquisitivo_fim, limite as sair_ate, saldo, concluidos, concluido_fim
  from public.ferias_prazos_internos()
 where admitido_em is not null
 order by nome;
