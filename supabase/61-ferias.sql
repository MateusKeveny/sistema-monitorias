-- ===========================================================================
-- 61 · Férias da equipe
--
-- O gestor cadastra os períodos no Performance (/cota/ferias). A Agenda da
-- Gestão mostra o calendário e avisa pela ponte (59): saídas chegando,
-- retornos, duas pessoas fora no mesmo período e o prazo da CLT.
--
-- Prazo (CLT, art. 130 e 134): a cada 12 meses de trabalho (período
-- aquisitivo, contado da entrada — pessoas.admitido_em) a pessoa ganha 30
-- dias, que precisam ser concedidos nos 12 meses seguintes (período
-- concessivo). Férias que começam depois disso são pagas em dobro.
--
-- Simplificações, ditas aqui para ninguém confiar além do que a conta faz:
--   - 30 dias por período, sem desconto por faltas (art. 130);
--   - os dias cadastrados abatem o período mais antigo primeiro, planejadas
--     e aprovadas juntas;
--   - sem data de entrada não há prazo: a pessoa aparece como "sem entrada".
-- ===========================================================================

create table if not exists public.ferias (
  id          uuid primary key default gen_random_uuid(),
  pessoa_id   uuid not null references public.pessoas (id) on delete cascade,
  inicio      date not null,
  fim         date not null,
  situacao    text not null default 'aprovada' check (situacao in ('planejada', 'aprovada')),
  observacao  text check (observacao is null or length(observacao) <= 500),
  criado_por  uuid default public.pessoa_atual() references public.pessoas (id) on delete set null,
  criado_em   timestamptz not null default now(),
  check (fim >= inicio),
  check (fim - inicio < 60)
);
create index if not exists ferias_periodo on public.ferias (inicio, fim);
create index if not exists ferias_pessoa on public.ferias (pessoa_id, inicio);

alter table public.ferias enable row level security;
drop policy if exists ferias_gestor on public.ferias;
create policy ferias_gestor on public.ferias for all to authenticated
  using (public.eh_gestor()) with check (public.eh_gestor());
revoke all on public.ferias from anon;

-- ---------------------------------------------------------------------------
-- Prazo de cada pessoa ativa
--
-- Uma linha por pessoa: o período que mais aperta — o mais antigo já
-- completo com dias sobrando; se nenhum, o período em curso.
--   limite         — último dia para COMEÇAR as férias sem pagar em dobro
--   saldo          — dias desse período ainda sem férias cadastradas
--   dias_ate_limite — negativo = já venceu
-- ---------------------------------------------------------------------------
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
     where pe.ativo and pe.desligado_em is null and pe.papel <> 'gestor'
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

-- Para a tela do Performance (só gestor).
create or replace function public.ferias_prazos()
returns table (pessoa_id uuid, nome text, admitido_em date, aquisitivo_inicio date, aquisitivo_fim date,
               limite date, saldo int, dias_ate_limite int, completo boolean)
language sql stable security definer set search_path = public as $$
  select * from public.ferias_prazos_internos() where public.eh_gestor();
$$;
revoke all on function public.ferias_prazos() from public, anon;
grant execute on function public.ferias_prazos() to authenticated;

-- ---------------------------------------------------------------------------
-- Ponte para a agenda (mesmo segredo da 59). Só nome, datas e prazo — nada
-- de cargo, observação ou outro dado da pessoa.
--   ferias: períodos de 7 dias atrás até 180 dias à frente
--   prazos: quem tem saldo com limite nos próximos 120 dias (ou vencido)
-- ---------------------------------------------------------------------------
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
       where z.saldo > 0 and z.dias_ate_limite <= 120), '[]'::jsonb),
    'sem_entrada', (select count(*) from public.ferias_prazos_internos() z where z.admitido_em is null));
end;
$$;
revoke all on function public.ferias_para_agenda(text) from public, authenticated;
grant execute on function public.ferias_para_agenda(text) to anon;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.ferias) as ferias_cadastradas,
  (select count(*) from public.ferias_prazos_internos()) as pessoas_ativas,
  (select count(*) from public.ferias_prazos_internos() where admitido_em is null) as sem_data_de_entrada,
  (select count(*) from public.ferias_prazos_internos() where saldo > 0 and dias_ate_limite <= 90) as prazo_em_90_dias;
