-- ============================================================================
-- 81 · Bypass de outubro/2026: outro setor com as métricas da Expansão
--
-- PROVISÓRIO. Os atendimentos da equipe no iGreen Mob em outubro pontuam com
-- as regras da Expansão, num quadro à parte do extrato, até a árvore de
-- setores e canais (docs/PLANO-SETORES.md) chegar em novembro. Decisão do
-- gestor, 26/10/2026.
--
--   · Volume: os RESOLVIDOS de cada pessoa por semana, colados da tabela de
--     analistas do Hub (filtrada no setor) — guardados em volume_outro_setor.
--   · calcular_outro_setor(setor, mês) refaz os lançamentos do setor no mês:
--       finalizado      = resolvidos × peso do Finalizado Expansão
--       faixa de C-SAT  = resolvidos × peso da faixa, com o C-SAT da semana
--                         calculado SÓ com as avaliações do setor (4 e 5 sobre
--                         o total, como na Expansão)
--       notas de 1 a 5  = quantidade × peso da nota
--     As avaliações vêm da importação do relatório de C-SAT (migração 78).
--   · Métricas próprias do setor ("… · iGreen Mob"), com os pesos da
--     Expansão copiados cargo a cargo na primeira vez. Só as de finalizado
--     são "manuais"; as de C-SAT e notas não aparecem no lançamento manual.
--   · Não muda o cálculo da cota: tudo entra como lançamento
--     (gerado_por = 'outro_setor_calc:<setor>'), refeito a cada cálculo.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

create table if not exists public.volume_outro_setor (
  id              bigint generated always as identity primary key,
  setor           text not null,
  pessoa_id       uuid not null references public.pessoas (id) on delete cascade,
  mes_competencia date not null,
  semana          smallint not null check (semana between 1 and 4),
  resolvidos      integer not null check (resolvidos >= 0),
  salvo_por_nome  text,
  salvo_em        timestamptz not null default now(),
  unique (setor, pessoa_id, mes_competencia, semana)
);
alter table public.volume_outro_setor enable row level security;
drop policy if exists volume_outro_setor_gestor on public.volume_outro_setor;
create policy volume_outro_setor_gestor on public.volume_outro_setor
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- "iGreen Mob" → "outro_setor_igreen_mob" (o mesmo da migração 80).
create or replace function public.chave_de_outro_setor(p_setor text)
returns text language sql immutable as $$
  select 'outro_setor_' || trim(both '_' from regexp_replace(lower(
           translate(p_setor, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                              'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+', '_', 'g'));
$$;

-- Cria (se faltar) a cópia de uma regra para o setor, com os pesos por cargo.
create or replace function public.copiar_regra_para_setor(p_original text, p_chave text, p_rotulo text, p_manual boolean, p_setor text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.regras;
begin
  select * into v from public.regras where chave = p_original;
  insert into public.regras (chave, grupo, rotulo, peso, faixa_min, faixa_max, ordem, manual, valor_manual, ativo)
  -- Sem faixa na cópia: quem decide a faixa é o cálculo, pelas regras originais;
  -- com faixa, a cópia apareceria nas réguas de Configuração.
  values (p_chave, 'manual', p_rotulo, v.peso, null, null, v.ordem, p_manual, false, true)
  on conflict (chave) do update set ativo = true;
  insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo, motivo_alteracao)
  select p.cargo_id, p_chave, p.peso, p.ativo, format('Copiado de "%s" para %s (bypass de outubro)', v.rotulo, p_setor)
    from public.pesos_por_cargo p
   where p.regra = p_original
  on conflict (cargo_id, regra) do nothing;
end;
$$;
revoke all on function public.copiar_regra_para_setor(text, text, text, boolean, text) from public, anon, authenticated;

create or replace function public.calcular_outro_setor(p_setor text, p_mes date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.chave_de_outro_setor(p_setor);
  v_marca text := 'outro_setor_calc:' || p_setor;
  r record;
  v_faixa text;
  v_n integer := 0;
begin
  if public.eh_gestor() is not true then raise exception 'Só o gestor calcula.'; end if;
  if public.mes_fechado(p_mes) then
    raise exception 'O mês de % já foi fechado.', public.nome_do_mes(p_mes);
  end if;

  -- As métricas do setor, copiadas da Expansão na primeira vez.
  perform public.copiar_regra_para_setor('huggy_atendimento', v_base, 'Atendimento ' || p_setor, true, p_setor);
  for r in select chave, rotulo from public.regras where grupo in ('csat', 'nota') and ativo loop
    perform public.copiar_regra_para_setor(r.chave, v_base || '__' || r.chave, r.rotulo || ' · ' || p_setor, false, p_setor);
  end loop;

  -- Refaz do zero: o cálculo anterior do setor no mês sai, e os lançamentos
  -- da opção antiga (migração 80, que contava as linhas do relatório).
  delete from public.lancamentos
   where mes_competencia = p_mes
     and (gerado_por = v_marca or (gerado_por = 'outro_setor' and regra = v_base));

  -- Finalizados e a faixa de C-SAT, por pessoa e semana com volume.
  for r in
    select v.pessoa_id, v.semana, v.resolvidos,
           (select count(*) from public.atendimentos_outro_setor a
             where a.setor = p_setor and a.pessoa_id = v.pessoa_id and a.mes_competencia = p_mes
               and a.semana = v.semana and a.nota is not null and a.situacao <> 'descartado') as avaliacoes,
           (select count(*) from public.atendimentos_outro_setor a
             where a.setor = p_setor and a.pessoa_id = v.pessoa_id and a.mes_competencia = p_mes
               and a.semana = v.semana and a.nota >= 4 and a.situacao <> 'descartado') as positivas
      from public.volume_outro_setor v
     where v.setor = p_setor and v.mes_competencia = p_mes and v.resolvidos > 0
  loop
    insert into public.lancamentos (pessoa_id, mes_competencia, semana, regra, quantidade, observacao, gerado_por)
    values (r.pessoa_id, p_mes, r.semana, v_base, r.resolvidos,
            format('Hub: %s resolvidos em %s', r.resolvidos, p_setor), v_marca);
    v_n := v_n + 1;
    if r.avaliacoes > 0 then
      select chave into v_faixa from public.regras
       where grupo = 'csat' and ativo
         and (faixa_min is null or r.positivas::numeric / r.avaliacoes >= faixa_min)
         and (faixa_max is null or r.positivas::numeric / r.avaliacoes <  faixa_max)
       limit 1;
      if v_faixa is not null then
        insert into public.lancamentos (pessoa_id, mes_competencia, semana, regra, quantidade, observacao, gerado_por)
        values (r.pessoa_id, p_mes, r.semana, v_base || '__' || v_faixa, r.resolvidos,
                format('C-SAT %s%% (%s de %s) em %s', round(r.positivas * 100.0 / r.avaliacoes, 1), r.positivas, r.avaliacoes, p_setor),
                v_marca);
        v_n := v_n + 1;
      end if;
    end if;
  end loop;

  -- Notas de 1 a 5, por pessoa e semana (com ou sem volume, como na Expansão).
  for r in
    select a.pessoa_id, a.semana, n.chave, count(*) as qtd
      from public.atendimentos_outro_setor a
      join public.regras n on n.grupo = 'nota' and n.ativo and n.faixa_min = a.nota
     where a.setor = p_setor and a.mes_competencia = p_mes and a.nota is not null and a.situacao <> 'descartado'
     group by a.pessoa_id, a.semana, n.chave
  loop
    insert into public.lancamentos (pessoa_id, mes_competencia, semana, regra, quantidade, observacao, gerado_por)
    values (r.pessoa_id, p_mes, r.semana, v_base || '__' || r.chave, r.qtd, null, v_marca);
    v_n := v_n + 1;
  end loop;

  -- Os atendimentos do setor no mês saem da lista de pendentes: já contam aqui.
  update public.atendimentos_outro_setor
     set situacao = 'lancado', decidido_por_nome = (select nome from public.pessoas where id = public.pessoa_atual()),
         decidido_em = now()
   where setor = p_setor and mes_competencia = p_mes and situacao = 'pendente';

  return v_n;
end;
$$;
revoke all on function public.calcular_outro_setor(text, date) from public, anon;
grant execute on function public.calcular_outro_setor(text, date) to authenticated;

-- Os setores de fora que apareceram em cada mês (para a tela do bypass).
create or replace view public.vw_setores_do_mes_outro with (security_invoker = true) as
  select distinct setor, mes_competencia from public.atendimentos_outro_setor
  union
  select distinct setor, mes_competencia from public.volume_outro_setor;

-- Conferência
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('volume_outro_setor', 'vw_setores_do_mes_outro')) as tabela_e_view,
       (select count(*) from pg_proc where proname in ('calcular_outro_setor', 'copiar_regra_para_setor', 'chave_de_outro_setor')) as funcoes;
