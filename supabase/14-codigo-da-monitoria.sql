-- ============================================================================
-- Código de identificação da monitoria
-- Rode DEPOIS de 11-tabela-unica-de-pessoas.sql. Pode ser executado mais de
-- uma vez.
--
-- Cada monitoria ganha um número curto e único, para ser citada numa conversa,
-- num e-mail ou numa busca. O `id` é um UUID — serve para o banco, não para
-- gente falar. E o protocolo é do atendimento, não da monitoria: dois
-- monitores podem avaliar o mesmo atendimento, e aí o protocolo se repete.
--
-- Com o código, chegar a um registro deixa de depender de achar a linha certa
-- numa lista e clicar nela.
-- ============================================================================

alter table public.monitorias
  add column if not exists codigo integer;

-- ---------------------------------------------------------------------------
-- Numera o que já existe pela ordem em que aconteceu.
--
-- Sem o `order by`, o Postgres numeraria na ordem física das linhas, que não
-- tem relação com o tempo — a monitoria mais antiga poderia receber o número
-- 40 e a mais nova o número 3. Como o código vai ser lido por pessoas, ele
-- precisa crescer junto com a data.
-- ---------------------------------------------------------------------------
with ordenadas as (
  select id, row_number() over (order by data_atendimento, criado_em, id) as n
    from public.monitorias
)
update public.monitorias m
   set codigo = o.n
  from ordenadas o
 where m.id = o.id
   and m.codigo is null;

-- ---------------------------------------------------------------------------
-- Daqui em diante o número sai de uma sequência.
--
-- `setval` com o terceiro argumento `false` faz o próximo valor ser exatamente
-- o que foi passado — e não o seguinte. Passando `max + 1`, a próxima
-- monitoria continua de onde a numeração parou, sem repetir nem pular.
-- ---------------------------------------------------------------------------
create sequence if not exists public.monitoria_codigo_seq as integer;

select setval('public.monitoria_codigo_seq',
              coalesce((select max(codigo) from public.monitorias), 0) + 1,
              false);

alter table public.monitorias
  alter column codigo set default nextval('public.monitoria_codigo_seq');

alter table public.monitorias
  alter column codigo set not null;

-- Amarra a sequência à coluna: se a coluna for removida um dia, a sequência
-- some junto em vez de ficar órfã no banco.
alter sequence public.monitoria_codigo_seq owned by public.monitorias.codigo;

create unique index if not exists monitorias_codigo_idx
  on public.monitorias (codigo);

-- ---------------------------------------------------------------------------
-- O código sobrevive à exclusão
--
-- Se alguém perguntar "o que houve com a monitoria 37?", a resposta precisa
-- existir mesmo depois de ela ser apagada. Sem esta coluna, o registro de
-- exclusão guardaria tudo menos justamente o número pelo qual a monitoria era
-- conhecida.
-- ---------------------------------------------------------------------------
alter table public.monitorias_excluidas
  add column if not exists codigo integer;

create or replace function public.apagar_monitoria(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m public.monitorias%rowtype;
  v_operador text;
  v_autor text;
begin
  select * into v_m from public.monitorias where id = p_id;
  if not found then raise exception 'Monitoria não encontrada.'; end if;

  select nome into v_operador from public.pessoas where id = v_m.operador_id;
  select nome into v_autor    from public.pessoas where auth_id = auth.uid();

  insert into public.monitorias_excluidas (
    monitoria_id, codigo, protocolo, data_atendimento, mes_referencia, semana_mes,
    numero_monitoria, operador_id, operador_nome, nota_final, zerado, parecer,
    motivo, excluida_por, excluida_por_nome, itens)
  values (
    v_m.id, v_m.codigo, v_m.protocolo, v_m.data_atendimento, v_m.mes_referencia,
    v_m.semana_mes, v_m.numero_monitoria, v_m.operador_id, v_operador,
    v_m.nota_final, v_m.zerado, v_m.parecer, p_motivo,
    public.pessoa_atual(), coalesce(v_autor, 'sistema'),
    (select jsonb_agg(jsonb_build_object(
              'criterio', c.nome, 'conforme', i.conforme, 'observacao', i.observacao))
       from public.monitoria_itens i
       join public.criterios c on c.id = i.criterio_id
      where i.monitoria_id = p_id));

  delete from public.monitorias where id = p_id;
end;
$$;

revoke all on function public.apagar_monitoria(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A view passa a expor o código
--
-- `codigo` entra no FIM da lista, e não junto do `id` onde ficaria melhor de
-- ler: o `create or replace view` do Postgres só aceita colunas acrescentadas
-- ao final. Inseri-la no meio renomearia as colunas seguintes e o comando
-- falharia. A ordem não afeta nada — a aplicação lê por nome.
-- ---------------------------------------------------------------------------
create or replace view public.vw_monitorias with (security_invoker = true) as
select
  m.id, m.protocolo, m.data_atendimento, m.mes_referencia,
  extract(year  from m.data_atendimento)::int as ano,
  extract(month from m.data_atendimento)::int as mes,
  m.semana_mes, m.numero_monitoria,
  o.id as operador_id, o.nome as operador,
  c.nome as canal,
  m.tempo_atendimento_seg, m.nota_final, m.zerado, m.motivo_zeramento, m.parecer,
  p.nome as monitor, m.criado_em,
  m.codigo
from public.monitorias m
join public.pessoas o on o.id = m.operador_id
left join public.canais  c on c.id = m.canal_id
left join public.pessoas p on p.id = m.monitor_id;
