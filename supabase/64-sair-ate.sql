-- ===========================================================================
-- 64 · Férias: sair até 30 dias antes do fim do período
--
-- Pela CLT (art. 134 e 137) as férias têm de ser GOZADAS dentro do período
-- concessivo — os 12 meses depois do aquisitivo. Os dias que passarem do fim
-- dele saem em dobro. Então o prazo que importa é o de SAIR: o último dia do
-- concessivo menos os dias a tirar. Com 30 dias a tirar, 30 dias antes.
--
-- Até a 63, `limite` era o último dia do concessivo. Agora é o último dia
-- para sair. A ponte da agenda e a tela do Performance leem o mesmo campo.
--
-- Férias tiradas antes do sistema: o cálculo só conhecia as cadastradas, e
-- quem tinha tirado as do 1º período antes aparecia com período vencido.
-- `ferias_dias_fora` guarda esses dias (o botão "Período tirado fora do
-- sistema" na tela Férias soma 30); eles abatem primeiro, como os outros.
--
-- Rode no SQL Editor do projeto dos painéis, inteiro. Pode rodar de novo.
-- ===========================================================================

alter table public.pessoas add column if not exists ferias_dias_fora int not null default 0
  check (ferias_dias_fora >= 0 and ferias_dias_fora <= 600);
comment on column public.pessoas.ferias_dias_fora is
  'Dias de férias tirados antes do sistema, sem datas cadastradas. Abatem os períodos mais antigos.';

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
    select pe.id, pe.nome, coalesce(pe.admitido_na_empresa, pe.admitido_em) as admitido_em,
           pe.ferias_dias_fora from public.pessoas pe
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
        -- Último dia para SAIR: as férias têm de terminar dentro do período
        -- concessivo, então a saída é o fim dele menos os dias a tirar
        -- (30 dias antes, para quem não tirou nada).
        limite := (p.admitido_em + make_interval(years => v_n + 2))::date - greatest(saldo, 1);
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
-- Conferência: o prazo de saída de cada um (só quem tem data).
-- ---------------------------------------------------------------------------
select nome, admitido_em, aquisitivo_fim, limite as sair_ate, saldo, dias_ate_limite
  from public.ferias_prazos_internos()
 where admitido_em is not null
 order by dias_ate_limite;
