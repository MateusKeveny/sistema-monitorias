-- 107: SLA dos chamados pela escala de cada pessoa (Performance 4.5.0).
--
-- Até a 106 o relógio do SLA era o tempo do Elo: dias úteis de 24 h (o Elo já
-- desconta fim de semana e feriado nacional). Agora, no setor com a opção
-- "SLA pela escala" ligada (só o Conexão Expansão), conta só o tempo dentro da
-- escala de quem tratou o chamado:
--
--   * do aberto_em ao concluido_em, só nos trechos de trabalho da escala
--     (o intervalo pausa o relógio);
--   * feriados do setor pausam o dia inteiro; ponto facultativo só pausa
--     depois de confirmado como folga (enquanto pendente, é dia normal);
--   * 1 dia útil = o expediente da pessoa naquele dia (dias = soma de
--     horas trabalhadas no chamado ÷ expediente do dia);
--   * limite em horas compara horas úteis; limite em dias compara dias de
--     expediente (regras.unidade_max, a unidade de cada limite);
--   * quem não tem escala (ou setor sem a opção) continua com o Elo.
--
-- Vale desde a competência de novembro/2026 (sla_escala_desde); os meses
-- anteriores continuam no tempo do Elo e os fechados ficam com o fechamento.
--
-- Cada chamado guarda horas_escala, dias_escala e a faixa_sla em que caiu.
-- A cota, a fila de atrasos, a justificativa e a conferência da importação
-- passam a ler a faixa_sla. A faixa é recalculada sozinha quando mudam o
-- chamado, a escala, os feriados ou as faixas.
--
-- As visões e funções são trocadas por substituição do trecho exato, com erro
-- se o trecho não for encontrado (como na 104).

begin;

-- 1. A opção por setor e a data de início.
alter table public.setores add column if not exists sla_pela_escala boolean not null default false;
update public.setores set sla_pela_escala = true where id = 1;

create or replace function public.sla_escala_desde()
returns date language sql immutable as $$ select date '2026-11-01' $$;
grant execute on function public.sla_escala_desde() to authenticated;

-- 2. Escala de cada pessoa, por dia da semana (1 = segunda … 7 = domingo).
--    vale_desde vazio = vale sempre; escala nova = linhas com a data nova (a
--    versão mais recente até o dia é a que vale, inteira).
create table if not exists public.escalas (
  id               bigint generated always as identity primary key,
  pessoa_id        uuid not null references public.pessoas(id) on delete cascade,
  dia_semana       smallint not null check (dia_semana between 1 and 7),
  entrada          time not null,
  inicio_intervalo time,
  fim_intervalo    time,
  saida            time not null,
  vale_desde       date,
  criado_em        timestamptz not null default now(),
  check (saida > entrada),
  check ((inicio_intervalo is null) = (fim_intervalo is null)),
  check (inicio_intervalo is null
         or (inicio_intervalo > entrada and fim_intervalo > inicio_intervalo and saida > fim_intervalo))
);
create unique index if not exists escalas_unica
  on public.escalas (pessoa_id, dia_semana, coalesce(vale_desde, '-infinity'::date));

-- 3. Feriados por setor. Ponto facultativo: confirmado null = a confirmar
--    (conta como dia normal), true = folga (pausa), false = a equipe trabalha.
create table if not exists public.feriados (
  id          bigint generated always as identity primary key,
  setor_id    smallint not null references public.setores(id) on delete cascade,
  data        date not null,
  nome        text not null,
  facultativo boolean not null default false,
  confirmado  boolean,
  observacao  text,
  criado_em   timestamptz not null default now(),
  unique (setor_id, data)
);

alter table public.escalas enable row level security;
alter table public.feriados enable row level security;

create policy escalas_leitura on public.escalas for select
  using (((select ve_o_time()) and pessoa_id = any ((select pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select pessoa_atual()));
create policy escalas_gestor on public.escalas for all
  using ((select eh_gestor()) and cuida_da_pessoa(pessoa_id))
  with check ((select eh_gestor()) and cuida_da_pessoa(pessoa_id));

create policy feriados_leitura on public.feriados for select
  using (setor_id = any ((select meus_setores())::smallint[]));
create policy feriados_gestor on public.feriados for all
  using ((select eh_gestor()) and setor_id = any ((select meus_setores())::smallint[]))
  with check ((select eh_gestor()) and setor_id = any ((select meus_setores())::smallint[]));

grant select, insert, update, delete on public.escalas, public.feriados to authenticated;

-- 4. A unidade de cada limite das faixas do SLA ('h' horas, 'd' dias úteis).
alter table public.regras add column if not exists unidade_max text check (unidade_max in ('h', 'd'));

-- 5. O relógio pela escala: horas e dias úteis entre a abertura e a conclusão.
--    Devolve nulos quando não se aplica (sem escala, setor sem a opção,
--    competência anterior a sla_escala_desde, chamado em aberto).
create or replace function public.sla_pela_escala(p_pessoa uuid, p_ini timestamptz, p_fim timestamptz,
  out horas numeric, out dias numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini   timestamp;
  v_fim   timestamp;
  v_setor smallint;
  v_dia   date;
  v_ver   date;
  e       public.escalas;
  v_trab  numeric;
  v_sob   numeric;
begin
  if p_pessoa is null or p_ini is null or p_fim is null or p_fim < p_ini then return; end if;
  v_ini := p_ini at time zone 'America/Sao_Paulo';
  v_fim := p_fim at time zone 'America/Sao_Paulo';
  if public.mes_de_competencia(v_ini::date) < public.sla_escala_desde() then return; end if;
  if not exists (select 1 from public.escalas x where x.pessoa_id = p_pessoa) then return; end if;

  -- O setor da pessoa no dia da abertura (ou o primeiro, se a abertura for anterior).
  select s.setor_id into v_setor from public.setores_da_pessoa s
   where s.pessoa_id = p_pessoa
   order by (s.desde <= v_ini::date) desc, case when s.desde <= v_ini::date then s.desde end desc nulls last, s.desde
   limit 1;
  if v_setor is null or not exists (select 1 from public.setores t where t.id = v_setor and t.sla_pela_escala) then
    return;
  end if;

  horas := 0; dias := 0;
  for v_dia in select g::date from generate_series(v_ini::date, v_fim::date, interval '1 day') g loop
    continue when exists (select 1 from public.feriados f
                           where f.setor_id = v_setor and f.data = v_dia
                             and (not f.facultativo or f.confirmado));
    select max(coalesce(x.vale_desde, '-infinity'::date)) into v_ver from public.escalas x
     where x.pessoa_id = p_pessoa and coalesce(x.vale_desde, '-infinity'::date) <= v_dia;
    continue when v_ver is null;
    select * into e from public.escalas x
     where x.pessoa_id = p_pessoa and coalesce(x.vale_desde, '-infinity'::date) = v_ver
       and x.dia_semana = extract(isodow from v_dia);
    continue when not found;

    v_trab := extract(epoch from (e.saida - e.entrada) - coalesce(e.fim_intervalo - e.inicio_intervalo, interval '0')) / 3600;
    continue when v_trab <= 0;
    -- Trechos de trabalho: entrada → início do intervalo e fim do intervalo → saída.
    select coalesce(sum(greatest(0, extract(epoch from least(v_fim, v_dia + t.b) - greatest(v_ini, v_dia + t.a)) / 3600)), 0)
      into v_sob
      from (values (e.entrada, coalesce(e.inicio_intervalo, e.saida)),
                   (coalesce(e.fim_intervalo, e.saida), e.saida)) t(a, b)
     where t.b > t.a;
    horas := horas + v_sob;
    dias := dias + v_sob / v_trab;
  end loop;
  horas := round(horas, 4);
  dias := round(dias, 4);
end $$;
grant execute on function public.sla_pela_escala(uuid, timestamptz, timestamptz) to authenticated;

-- 6. A faixa do chamado: a primeira (da mais rápida à mais lenta) cujo limite
--    ainda não foi alcançado, medido na unidade do limite.
create or replace function public.sla_faixa(p_horas numeric, p_dias numeric, p_tempo_util numeric)
returns text language sql stable security definer set search_path = public as $$
  select case when coalesce(p_horas, p_tempo_util) is null then null else (
    select s.chave from public.regras s
     where s.ativo and starts_with(s.chave, 'chamados_sla_')
       and (s.faixa_max is null
            or (case when s.unidade_max = 'h' then coalesce(p_horas, p_tempo_util * 24)
                     else coalesce(p_dias, p_tempo_util) * 24 end) < s.faixa_max)
     order by coalesce(s.faixa_min, 0), s.faixa_max nulls last
     limit 1) end
$$;
grant execute on function public.sla_faixa(numeric, numeric, numeric) to authenticated;

-- 7. Colunas no chamado e o gatilho que as mantém.
alter table public.chamados_elo
  add column if not exists horas_escala numeric(10,4),
  add column if not exists dias_escala  numeric(10,4),
  add column if not exists faixa_sla    text;

create or replace function public.calcula_sla_do_chamado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if new.concluido_em is null then
    new.horas_escala := null; new.dias_escala := null; new.faixa_sla := null;
    return new;
  end if;
  select * into r from public.sla_pela_escala(new.pessoa_id, new.aberto_em, new.concluido_em);
  new.horas_escala := r.horas;
  new.dias_escala := r.dias;
  new.faixa_sla := public.sla_faixa(r.horas, r.dias, new.tempo_util);
  return new;
end $$;

drop trigger if exists calcula_sla on public.chamados_elo;
create trigger calcula_sla before insert or update of aberto_em, concluido_em, pessoa_id, tempo_util
  on public.chamados_elo for each row execute function public.calcula_sla_do_chamado();

-- Recálculo em lote: só regrava o que mudou. p_so_faixa = as faixas mudaram
-- (o relógio de cada chamado continua o mesmo).
create or replace function public.recalcular_sla(p_so_faixa boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if p_so_faixa then
    update public.chamados_elo c
       set faixa_sla = public.sla_faixa(c.horas_escala, c.dias_escala, c.tempo_util)
     where c.concluido_em is not null
       and c.faixa_sla is distinct from public.sla_faixa(c.horas_escala, c.dias_escala, c.tempo_util);
  else
    with novo as (
      select c.protocolo, e.horas, e.dias, public.sla_faixa(e.horas, e.dias, c.tempo_util) as faixa
        from public.chamados_elo c
       cross join lateral public.sla_pela_escala(c.pessoa_id, c.aberto_em, c.concluido_em) e
       where c.concluido_em is not null
    )
    update public.chamados_elo c
       set horas_escala = n.horas, dias_escala = n.dias, faixa_sla = n.faixa
      from novo n
     where c.protocolo = n.protocolo
       and (c.horas_escala, c.dias_escala, c.faixa_sla) is distinct from (n.horas, n.dias, n.faixa);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.sla_escala_mudou()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalcular_sla(false);
  return null;
end $$;

create or replace function public.sla_faixas_mudaram()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if starts_with(coalesce(new.chave, old.chave), 'chamados_sla_') then
    perform public.recalcular_sla(true);
  end if;
  return null;
end $$;

drop trigger if exists recalcula_sla on public.escalas;
create trigger recalcula_sla after insert or update or delete on public.escalas
  for each statement execute function public.sla_escala_mudou();
drop trigger if exists recalcula_sla on public.feriados;
create trigger recalcula_sla after insert or update or delete on public.feriados
  for each statement execute function public.sla_escala_mudou();
drop trigger if exists recalcula_sla on public.setores;
create trigger recalcula_sla after update of sla_pela_escala on public.setores
  for each statement execute function public.sla_escala_mudou();
drop trigger if exists recalcula_sla on public.regras;
create trigger recalcula_sla after insert or update or delete on public.regras
  for each row execute function public.sla_faixas_mudaram();

-- 8. Copiar as configurações de outro setor: os feriados e a opção ligada.
--    A escala é de cada pessoa: vem pela planilha do setor.
create or replace function public.copiar_configuracao_do_sla(p_origem smallint, p_destino smallint)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not (public.eh_admin() or (public.eh_gestor() and public.cuida_do_setor(p_destino))) then
    raise exception 'Só o gestor do setor copia as configurações.' using errcode = '42501';
  end if;
  insert into public.feriados (setor_id, data, nome, facultativo, confirmado, observacao)
  select p_destino, f.data, f.nome, f.facultativo, f.confirmado, f.observacao
    from public.feriados f where f.setor_id = p_origem
  on conflict (setor_id, data) do nothing;
  get diagnostics v_n = row_count;
  update public.setores set sla_pela_escala = true where id = p_destino and not sla_pela_escala;
  return v_n;
end $$;
grant execute on function public.copiar_configuracao_do_sla(smallint, smallint) to authenticated;

-- 9. As faixas do Expansão: o limite "12 h" vira "0,5 dia útil" (mesmas 12 h
--    no tempo do Elo; meio expediente na escala). Confere antes de mudar.
do $$
begin
  if (select count(*) from public.regras where ativo and starts_with(chave, 'chamados_sla_')) <> 5
     or not exists (select 1 from public.regras where chave = 'chamados_sla_ate_2d'   and faixa_min = 0  and faixa_max = 3)
     or not exists (select 1 from public.regras where chave = 'chamados_sla_f2'       and faixa_min = 3  and faixa_max = 12)
     or not exists (select 1 from public.regras where chave = 'chamados_sla_f3'       and faixa_min = 12 and faixa_max = 24)
     or not exists (select 1 from public.regras where chave = 'chamados_sla_f4'       and faixa_min = 24 and faixa_max = 36)
     or not exists (select 1 from public.regras where chave = 'chamados_sla_acima_2d' and faixa_min = 36 and faixa_max is null) then
    raise exception 'As faixas do SLA não estão como esperado; nada foi mudado.';
  end if;
end $$;

update public.regras set unidade_max = 'h' where chave = 'chamados_sla_ate_2d';
update public.regras set unidade_max = 'd', rotulo = 'SLA de 3 h a 0,5 dias úteis' where chave = 'chamados_sla_f2';
update public.regras set unidade_max = 'd', rotulo = 'SLA de 0,5 dias úteis a 1 dia útil' where chave = 'chamados_sla_f3';
update public.regras set unidade_max = 'd' where chave = 'chamados_sla_f4';

-- 10. Cálculo da cota: cada chamado conta na faixa em que caiu.
do $$
declare
  t text := pg_get_viewdef('public.vw_extrato_quantidades'::regclass);
  n text;
begin
  n := replace(t,
$a$(((c.tempo_util * (24)::numeric) >= COALESCE(s.faixa_min, (0)::numeric)) AND ((s.faixa_max IS NULL) OR ((c.tempo_util * (24)::numeric) < s.faixa_max)) AND ((s.faixa_max IS NOT NULL) OR (c.decisao = 'manter'::text)))$a$,
$b$((s.chave = c.faixa_sla) AND ((s.faixa_max IS NOT NULL) OR (c.decisao = 'manter'::text)))$b$);
  if n = t then raise exception 'vw_extrato_quantidades: trecho dos chamados não encontrado'; end if;
  execute 'create or replace view public.vw_extrato_quantidades with (security_invoker = true) as ' || n;
end $$;

-- 11. Fora do prazo = caiu na última faixa (Agenda, justificativa, conferência).
--     A Agenda ganha o aviso de ponto facultativo a confirmar (15 dias antes).
do $$
declare
  t text; n text;
begin
  t := pg_get_functiondef('public.agenda_pendencias_internas()'::regprocedure);
  n := replace(t, 'c.tempo_util >= sla_prazo_dias() and', $x$c.faixa_sla = 'chamados_sla_acima_2d' and$x$);
  if n = t then raise exception 'agenda_pendencias_internas: prazo não encontrado'; end if;
  t := n;
  n := replace(t, '  select count(*) into v_n from public.chamados_elo c',
$x$  select count(*), string_agg(to_char(f.data, 'DD/MM') || ' (' || f.nome || ')', ', ' order by f.data)
    into v_n, v_lista
    from public.feriados f
   where f.facultativo and f.confirmado is null and f.data between v_hoje and v_hoje + 15;
  if v_n > 0 then
    chave := 'facultativo'; grave := false; quantidade := v_n;
    texto := format('Ponto facultativo a confirmar: %s', v_lista);
    acao := 'Confirmar'; href := '/cota/escala';
    return next;
  end if;

  select count(*) into v_n from public.chamados_elo c$x$);
  if n = t then raise exception 'agenda_pendencias_internas: trecho dos chamados não encontrado'; end if;
  execute n;

  t := pg_get_functiondef('public.justificar_atraso_chamado(bigint,text)'::regprocedure);
  n := replace(t, 'v.tempo_util < sla_prazo_dias() then', $x$v.faixa_sla is distinct from 'chamados_sla_acima_2d' then$x$);
  if n = t then raise exception 'justificar_atraso_chamado: prazo não encontrado'; end if;
  execute n;

  t := pg_get_functiondef('public.conferir_chamados(jsonb)'::regprocedure);
  n := replace(t, $a$(v_linha->>'tempo_util')::numeric < sla_prazo_dias() then$a$,
$b$(select public.sla_faixa(e.horas, e.dias, (v_linha->>'tempo_util')::numeric)
            from public.sla_pela_escala(v_pessoa, v_aberto, (v_linha->>'concluido_em')::timestamptz) e)
          is distinct from 'chamados_sla_acima_2d' then$b$);
  if n = t then raise exception 'conferir_chamados: prazo não encontrado'; end if;
  execute n;
end $$;

-- 12. Escala e feriados do Conexão Expansão (planilha de 11/11/2026).
insert into public.escalas (pessoa_id, dia_semana, entrada, inicio_intervalo, fim_intervalo, saida)
select p.id, d.dia, x.entrada::time, x.ini::time, x.fim::time, x.saida::time
  from (values
    ('Matheus Camargo',  'seg a sex', '09:00', '12:30', '13:30', '17:12'),
    ('Suyara Martins',   'seg a sex', '09:00', '12:30', '13:30', '17:12'),
    ('Ibson Santos',     'seg a sex', '09:00', '12:30', '13:30', '17:12'),
    ('Pedro Lucas',      'seg a sex', '09:00', '12:30', '13:30', '17:12'),
    ('Allana Castro',    'seg a sex', '13:30', '17:30', '18:00', '20:00'),
    ('Allana Castro',    'sáb',       '09:00', '13:00', '13:30', '15:30'),
    ('Denise Castro',    'seg a sex', '13:30', '17:30', '18:00', '20:00'),
    ('Denise Castro',    'sáb',       '09:00', '13:00', '13:30', '15:30'),
    ('Rafael Costa',     'seg a sex', '13:30', '17:30', '18:00', '20:00'),
    ('Rafael Costa',     'sáb',       '09:00', '13:00', '13:30', '15:30'),
    ('João Vitor',       'seg a sex', '08:00', '11:00', '11:30', '14:30'),
    ('João Vitor',       'sáb',       '09:00', '13:00', '13:30', '15:30'),
    ('Rayssa Gabrielle', 'seg a sex', '08:00', '11:00', '11:30', '14:30'),
    ('Rayssa Gabrielle', 'sáb',       '09:00', '13:00', '13:30', '15:30')
  ) x(nome, dias, entrada, ini, fim, saida)
  join public.pessoas p on p.nome = x.nome   -- Pedro Lucas está desligado (25/10), mas veio na planilha
  cross join lateral unnest(case x.dias when 'seg a sex' then array[1, 2, 3, 4, 5] else array[6] end) d(dia);

do $$
begin
  if (select count(distinct pessoa_id) from public.escalas) <> 9 or (select count(*) from public.escalas) <> 50 then
    raise exception 'Escala: esperava 9 pessoas e 50 linhas, achou % e %',
      (select count(distinct pessoa_id) from public.escalas), (select count(*) from public.escalas);
  end if;
end $$;

insert into public.feriados (setor_id, data, nome, facultativo) values
  (1, '2026-11-02', 'Finados', false),
  (1, '2026-11-15', 'Proclamação da República', false),
  (1, '2026-11-20', 'Dia da Consciência Negra', false),
  (1, '2026-12-25', 'Natal', false),
  (1, '2027-01-01', 'Confraternização Universal', false),
  (1, '2027-02-08', 'Carnaval', true),
  (1, '2027-02-09', 'Carnaval', true),
  (1, '2027-03-26', 'Sexta-feira Santa', false),
  (1, '2027-04-21', 'Tiradentes', false),
  (1, '2027-05-01', 'Dia do Trabalho', false),
  (1, '2027-05-27', 'Corpus Christi', true),
  (1, '2027-09-07', 'Independência do Brasil', false),
  (1, '2027-10-12', 'Nossa Senhora Aparecida', false),
  (1, '2027-11-02', 'Finados', false),
  (1, '2027-11-15', 'Proclamação da República', false),
  (1, '2027-11-20', 'Dia da Consciência Negra', false),
  (1, '2027-12-25', 'Natal', false);

-- 13. Calcula todos os chamados (os gatilhos de lote já rodaram acima, mas
--     este é o que vale: faixa de todos, escala de novembro em diante).
select public.recalcular_sla(false);

commit;
