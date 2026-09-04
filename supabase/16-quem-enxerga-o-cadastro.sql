-- ============================================================================
-- Restringe quem enxerga o cadastro de pessoas
-- Rode DEPOIS de 14-codigo-da-monitoria.sql. Pode ser executado mais de uma vez.
--
-- A política atual é `using (auth.uid() is not null)`: basta estar logado para
-- ler a tabela inteira. Qualquer pessoa da equipe — inclusive um operador, que
-- é o menor acesso do sistema — consegue listar todos os colegas com e-mail,
-- papel e `senha_definida`.
--
-- O problema não é a lista em si; é a combinação. `senha_definida` diz quais
-- contas ainda usam a senha padrão, e `papel` diz qual delas é gestora. Junto
-- com uma senha padrão conhecida e adivinhável, o sistema entrega o alvo
-- pronto: basta uma consulta para descobrir qual conta administrativa está
-- aberta.
--
-- Enquanto ninguém havia entrado, isso era teórico. Deixa de ser no momento em
-- que os acessos forem distribuídos à equipe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- O nome de uma pessoa, e só o nome
--
-- A tela de detalhe mostra quem monitorou o atendimento, e essa é a única
-- informação de outra pessoa que o operador precisa ver. Uma função que
-- devolve apenas o nome resolve isso sem abrir o resto do cadastro: quem
-- chamar recebe um texto, não uma linha com e-mail, papel e estado de senha.
-- ---------------------------------------------------------------------------
create or replace function public.nome_de_pessoa(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select nome from public.pessoas where id = p_id;
$$;

revoke all on function public.nome_de_pessoa(uuid) from public, anon;
grant execute on function public.nome_de_pessoa(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A view passa a pegar o nome do monitor pela função
--
-- As colunas ficam na mesma ordem e com os mesmos nomes de propósito: o
-- `create or replace view` do Postgres não aceita renomear nem reordenar, só
-- acrescentar ao final.
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
  public.nome_de_pessoa(m.monitor_id) as monitor, m.criado_em,
  m.codigo
from public.monitorias m
join public.pessoas o on o.id = m.operador_id
left join public.canais c on c.id = m.canal_id;

-- ---------------------------------------------------------------------------
-- A regra nova
--
-- Gestor e qualidade enxergam o time inteiro, que é o que o trabalho deles
-- exige. Todos os outros enxergam apenas a própria linha.
--
-- A junção da view acima continua funcionando: as monitorias que um operador
-- alcança são as dele, e o operador dessas monitorias é ele mesmo.
-- ---------------------------------------------------------------------------
drop policy if exists pessoas_leitura on public.pessoas;
create policy pessoas_leitura on public.pessoas
  for select using (
    public.ve_o_time() or id = public.pessoa_atual()
  );
