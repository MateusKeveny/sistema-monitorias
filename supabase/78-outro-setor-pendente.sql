-- ============================================================================
-- 78 · Atendimentos de outros setores como demanda extra pendente
--
-- O relatório do Hub traz, às vezes, atendimentos de setores que não são
-- Expansão nem Diretores-Expansão. Antes o arquivo inteiro era recusado
-- ("Setores desconhecidos"). Agora a importação guarda esses atendimentos
-- aqui, um por linha (data + protocolo, como as avaliações), SEM pontos: o
-- gestor decide depois, em Lançamentos, com a regra de demanda extra que
-- criar — ou descarta. Decisão do gestor, 26/10/2026.
--
-- Lançar vira um lançamento normal (quantidade = atendimentos da pessoa no
-- setor e na semana), ligado às linhas daqui. Mês já fechado não recebe.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

create table if not exists public.atendimentos_outro_setor (
  id               bigint generated always as identity primary key,
  pessoa_id        uuid not null references public.pessoas (id) on delete cascade,
  data             date not null,
  protocolo        text not null,
  setor            text not null,
  nota             smallint check (nota between 1 and 5),
  mes_competencia  date not null,
  semana           smallint not null check (semana between 1 and 4),
  situacao         text not null default 'pendente' check (situacao in ('pendente', 'lancado', 'descartado')),
  lancamento_id    bigint references public.lancamentos (id) on delete set null,
  origem_arquivo   text,
  importado_por    text,
  importado_em     timestamptz not null default now(),
  decidido_por_nome text,
  decidido_em      timestamptz,
  unique (data, protocolo)
);
create index if not exists atendimentos_outro_setor_pendentes
  on public.atendimentos_outro_setor (mes_competencia) where situacao = 'pendente';

alter table public.atendimentos_outro_setor enable row level security;
drop policy if exists atendimentos_outro_setor_gestor on public.atendimentos_outro_setor;
create policy atendimentos_outro_setor_gestor on public.atendimentos_outro_setor
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- Decide um grupo de atendimentos pendentes: com regra, lança (um lançamento
-- por pessoa, mês, semana e setor); sem regra, descarta.
create or replace function public.decidir_outro_setor(p_ids bigint[], p_regra text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_eu text;
  v_g  record;
  v_id bigint;
  v_n  integer := 0;
begin
  if public.eh_gestor() is not true then raise exception 'Só o gestor decide as demandas extras.'; end if;
  select nome into v_eu from public.pessoas where id = public.pessoa_atual();

  if p_regra is null then
    update public.atendimentos_outro_setor
       set situacao = 'descartado', decidido_por_nome = v_eu, decidido_em = now()
     where id = any (p_ids) and situacao = 'pendente';
    get diagnostics v_n = row_count;
    return v_n;
  end if;

  if not exists (select 1 from public.regras where chave = p_regra and ativo and manual) then
    raise exception 'Regra de lançamento não encontrada.';
  end if;

  for v_g in
    select pessoa_id, mes_competencia, semana, setor, array_agg(id) as ids, count(*) as qtd
      from public.atendimentos_outro_setor
     where id = any (p_ids) and situacao = 'pendente'
     group by pessoa_id, mes_competencia, semana, setor
  loop
    if public.mes_fechado(v_g.mes_competencia) then
      raise exception 'O mês de % já foi fechado: lance antes de fechar ou descarte.',
        public.nome_do_mes(v_g.mes_competencia);
    end if;
    insert into public.lancamentos (pessoa_id, mes_competencia, semana, regra, quantidade, observacao, gerado_por)
    values (v_g.pessoa_id, v_g.mes_competencia, v_g.semana, p_regra, v_g.qtd,
            format('Hub: %s atendimento%s em %s', v_g.qtd, case when v_g.qtd = 1 then '' else 's' end, v_g.setor),
            'outro_setor')
    returning id into v_id;
    update public.atendimentos_outro_setor
       set situacao = 'lancado', lancamento_id = v_id, decidido_por_nome = v_eu, decidido_em = now()
     where id = any (v_g.ids);
    v_n := v_n + v_g.qtd;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.decidir_outro_setor(bigint[], text) from public, anon;
grant execute on function public.decidir_outro_setor(bigint[], text) to authenticated;

-- Conferência
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'atendimentos_outro_setor') as tabela,
       (select count(*) from pg_proc where proname = 'decidir_outro_setor') as funcao;
