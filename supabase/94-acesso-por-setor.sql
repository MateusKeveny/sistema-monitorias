-- ============================================================================
-- 94 · Acesso por setor e papel administrador (Performance 3.1 / Monitorias 6.1)
--
-- Parte 3 da árvore (docs/PLANO-SETORES.md, "Acesso por setor"):
--
--   · Papel novo `administrador`: vê e mexe em todos os setores (cadastro da
--     árvore, cargos, correções). A conta "admin" passa a ele. Sem cargo, fora
--     de ranking e médias (já estava).
--   · Gestor e qualidade: só o setor em que estão cadastrados no mês
--     (setores_da_pessoa). O atendente segue vendo só o que é dele.
--   · Três camadas:
--       1. Leitura — as regras de acesso das tabelas com pessoa ou setor
--          passam a exigir "do meu setor" (pessoas_que_vejo / meus_setores).
--       2. Gravação — uma guarda única por tabela (guarda_do_setor) recusa a
--          gestor e qualidade qualquer gravação em pessoa ou definição de
--          outro setor. Vale também para as funções do banco que gravam por
--          conta própria (importar, mover, fechar…), sem reescrever cada uma.
--       3. Funções que devolvem listas filtram pelo setor.
--   · Só o administrador cria e apaga setor e dá o papel de administrador.
--
-- Hoje há um setor só: ninguém pode perder nem ganhar nada. A prova compara,
-- antes e depois, o que gestor, qualidade, atendente e o próprio admin
-- enxergam em 17 tabelas e visões, e a cota com a foto. Diferença desfaz tudo.
-- Não roda sem a conta de administrador nem com gestor/qualidade sem setor.
--
-- Pessoa que mudou de setor: o gestor vê a pessoa inteira (inclusive meses no
-- setor antigo) — o setor é da pessoa, com histórico; mudança é rara e feita
-- pelo administrador.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez.
-- ============================================================================

begin;

-- 0. Travas: sem administrador ou com gestor/qualidade sem setor, não roda.
do $$
begin
  if not exists (select 1 from public.pessoas p join auth.users u on u.id = p.auth_id
                  where lower(u.email) = 'admin@painel.interno' and p.ativo and p.desligado_em is null) then
    raise exception 'Falta a conta de administrador (login "admin"). Crie em Usuários e setores › Pessoas › + Novo usuário.';
  end if;
  if exists (select 1 from public.pessoas p
              where p.papel in ('gestor', 'qualidade') and p.ativo and p.desligado_em is null
                and not exists (select 1 from public.setores_da_pessoa s where s.pessoa_id = p.id)) then
    raise exception 'Há gestor ou qualidade sem setor: ele perderia o acesso. Nada foi gravado.';
  end if;
end $$;

select public.tirar_foto_da_cota('antes-da-94');

-- O que cada um enxerga, antes (gestor que não é o admin, qualidade,
-- atendente e o admin).
create temp table acesso_antes (papel text, objeto text, hash text) on commit drop;
create temp table acesso_depois (papel text, objeto text, hash text) on commit drop;
create temp table quem_testa (papel text, auth_id uuid) on commit drop;
grant all on acesso_antes, acesso_depois, quem_testa to authenticated;
insert into quem_testa
select 'admin', p.auth_id from public.pessoas p join auth.users u on u.id = p.auth_id where lower(u.email) = 'admin@painel.interno'
union all
select x.papel, (select p.auth_id from public.pessoas p left join auth.users u on u.id = p.auth_id
                  where p.papel = x.papel and p.ativo and p.auth_id is not null
                    and lower(coalesce(u.email, '')) <> 'admin@painel.interno' order by p.id limit 1)
  from (values ('gestor'), ('qualidade'), ('operador')) x(papel);

create or replace function pg_temp.medir(p_papel text, p_tabela text) returns void language plpgsql as $$
declare o text; h text; v_auth uuid;
begin
  select auth_id into v_auth from quem_testa where papel = p_papel;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_auth)::text, true);
  set local role authenticated;
  foreach o in array array['pessoas', 'avaliacoes', 'volume_semanal', 'lancamentos', 'monitorias', 'monitoria_itens',
                           'cargos_da_pessoa', 'setores_da_pessoa', 'regras', 'pesos_por_cargo', 'criterios',
                           'fechamentos_cota', 'canais_do_setor', 'setores', 'vw_monitorias', 'vw_ranking_mensal',
                           'vw_criterios_reprovados'] loop
    -- Sem a coluna papel: a conta admin muda de papel de propósito.
    execute format('select md5(coalesce(string_agg((to_jsonb(t) - ''papel'')::text, '''' order by (to_jsonb(t) - ''papel'')::text), '''')) from public.%I t', o) into h;
    execute format('insert into %I values ($1, $2, $3)', p_tabela) using p_papel, o, h;
  end loop;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;
select pg_temp.medir(papel, 'acesso_antes') from quem_testa;

-- ---------------------------------------------------------------- 1. O papel
alter table public.pessoas drop constraint if exists pessoas_papel_check;
alter table public.pessoas add constraint pessoas_papel_check
  check (papel in ('administrador', 'gestor', 'qualidade', 'operador'));
update public.pessoas set papel = 'administrador'
 where auth_id = (select id from auth.users where lower(email) = 'admin@painel.interno');

-- ------------------------------------------------- 2. Quem é quem, e o setor
create or replace function public.eh_admin() returns boolean language sql stable as $$
  select coalesce(public.papel_atual() = 'administrador', false);
$$;
-- O administrador passa em tudo que é do gestor e de quem vê o time.
create or replace function public.eh_gestor() returns boolean language sql stable as $$
  select coalesce(public.papel_atual() in ('gestor', 'administrador'), false);
$$;
create or replace function public.ve_o_time() returns boolean language sql stable as $$
  select coalesce(public.papel_atual() in ('gestor', 'qualidade', 'administrador'), false);
$$;
create or replace function public.pode_monitorar() returns boolean language sql stable as $$
  select coalesce(public.papel_atual() in ('gestor', 'qualidade', 'administrador'), false);
$$;

-- Os setores de quem está logado: o administrador, todos; os demais, o setor
-- em que estão no mês corrente.
create or replace function public.meus_setores() returns smallint[]
language sql stable security definer set search_path = public as $$
  select case when public.eh_admin() then (select coalesce(array_agg(id order by id), '{}') from public.setores)
              else coalesce(array_remove(array[public.setor_na_competencia(public.pessoa_atual(),
                     public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date))], null), '{}')
         end;
$$;

-- As pessoas que já estiveram num setor meu (o administrador vê todas).
create or replace function public.pessoas_que_vejo() returns uuid[]
language sql stable security definer set search_path = public as $$
  select case when public.eh_admin() then (select coalesce(array_agg(id), '{}') from public.pessoas)
              else (select coalesce(array_agg(distinct s.pessoa_id), '{}') from public.setores_da_pessoa s
                     where s.setor_id = any (public.meus_setores()))
         end;
$$;

create or replace function public.cuida_da_pessoa(p_pessoa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_pessoa = any (public.pessoas_que_vejo());
$$;
create or replace function public.cuida_do_setor(p_setor smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select p_setor = any (public.meus_setores());
$$;
create or replace function public.cuida_do_cargo(p_cargo smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cuida_do_setor((select setor_id from public.cargos where id = p_cargo));
$$;
create or replace function public.cuida_do_canal(p_canal smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cuida_do_setor((select setor_id from public.canais_do_setor where id = p_canal));
$$;
-- A pessoa já tem setor? (por dentro: o setor de outra equipe fica oculto
-- para quem lê, e a pessoa pareceria "sem setor").
create or replace function public.tem_setor(p_pessoa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.setores_da_pessoa where pessoa_id = p_pessoa);
$$;
grant execute on function public.eh_admin(), public.meus_setores(), public.pessoas_que_vejo(),
  public.cuida_da_pessoa(uuid), public.cuida_do_setor(smallint), public.cuida_do_cargo(smallint),
  public.cuida_do_canal(smallint), public.tem_setor(uuid) to authenticated;

-- ------------------------------------------------------ 3. Leitura (políticas)
-- Atalhos de leitura: V = vê o time; G = gestor; P(x) = pessoa do meu setor;
-- EU(x) = eu mesmo; S(x) = setor meu.
alter policy "acessos_leitura" on public.acessos
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "acessos_criados_leitura" on public.acessos_criados
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
-- Históricos de antes da árvore (só da Conexão Expansão).
alter policy "atendimentos_historico" on public.atendimentos
  using ((select public.ve_o_time()) and 1::smallint = any ((select public.meus_setores())::smallint[]));
alter policy "cotas_historico" on public.cotas
  using ((select public.ve_o_time()) and 1::smallint = any ((select public.meus_setores())::smallint[]));
alter policy "atendimentos_outro_setor_gestor" on public.atendimentos_outro_setor
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
  with check ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "presenciais_leitura" on public.atendimentos_presenciais
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
alter policy "presenciais_registro" on public.atendimentos_presenciais
  with check (pessoa_id = (select public.pessoa_atual())
              or ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[])));
alter policy "presenciais_exclusao" on public.atendimentos_presenciais
  using (((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or ((pessoa_id = (select public.pessoa_atual())) and (data >= '2026-09-26'::date)
             and not exists (select 1 from fechamentos_cota f
                              where f.pessoa_id = atendimentos_presenciais.pessoa_id
                                and f.mes_competencia = mes_de_competencia(atendimentos_presenciais.data))));
alter policy "avaliacoes_gestor" on public.avaliacoes
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
  with check ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "avaliacoes_leitura" on public.avaliacoes
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
-- Notas guardadas (sem pessoa ainda): pela fila.
alter policy "guardadas_gestor" on public.avaliacoes_guardadas
  using ((select public.eh_gestor()) and (pessoa_id = any ((select public.pessoas_que_vejo())::uuid[])
         or (pessoa_id is null and (canal_id is null or public.cuida_do_canal(canal_id)))))
  with check ((select public.eh_gestor()) and (pessoa_id = any ((select public.pessoas_que_vejo())::uuid[])
         or (pessoa_id is null and (canal_id is null or public.cuida_do_canal(canal_id)))));
alter policy "canais_do_setor_leitura" on public.canais_do_setor
  using (setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "canais_do_setor_gestor" on public.canais_do_setor
  using ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]))
  with check ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "cargos_leitura" on public.cargos
  using (setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "cargos_gestor" on public.cargos
  using ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]))
  with check ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "cargos_pessoa_leitura" on public.cargos_da_pessoa
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
-- Pessoa recém-criada (ainda sem setor) também pode receber o cargo.
alter policy "cargos_pessoa_gestor" on public.cargos_da_pessoa
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
  with check ((select public.eh_gestor()) and public.cuida_do_cargo(cargo_id));
alter policy "cargos_referencia_leitura" on public.cargos_referencia
  using (public.cuida_do_cargo(cargo_id));
alter policy "cargos_referencia_gestor" on public.cargos_referencia
  using ((select public.eh_gestor()) and public.cuida_do_cargo(cargo_id))
  with check ((select public.eh_gestor()) and public.cuida_do_cargo(cargo_id));
alter policy "chamados_elo_leitura" on public.chamados_elo
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
alter policy "criterios_leitura" on public.criterios
  using (setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "criterios_gestor" on public.criterios
  using ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]))
  with check ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "citacoes_leitura" on public.diario_citacoes
  using ((select public.ve_o_time()) and (monitoria_id is null or exists (
           select 1 from monitorias m where m.id = diario_citacoes.monitoria_id
              and m.operador_id = any ((select public.pessoas_que_vejo())::uuid[]))));
alter policy "leituras_leitura" on public.diario_leituras
  using (pessoa_id = (select public.pessoa_atual())
         or (aprova_diario() and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[])));
alter policy "privados_leitura" on public.diario_privados
  using (pessoa_id = (select public.pessoa_atual())
         or (aprova_diario() and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[])));
alter policy "privados_exclusao" on public.diario_privados
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "diario_exclusao" on public.diario_registros
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "fechamento_alteracoes_leitura" on public.fechamento_alteracoes
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
alter policy "fechamento_linhas_leitura" on public.fechamento_linhas
  using (exists (select 1 from fechamentos_cota f
                  where f.id = fechamento_linhas.fechamento_id
                    and (((select public.ve_o_time()) and f.pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
                         or f.pessoa_id = (select public.pessoa_atual()))));
alter policy "fechamentos_leitura" on public.fechamentos_cota
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
-- Férias: quem já via (gestão, qualidade, Pleno e Analista), só do setor.
alter policy "ferias_le" on public.ferias
  using (ve_ferias() and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "ferias_gestor_grava" on public.ferias
  with check ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "ferias_gestor_altera" on public.ferias
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
  with check ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "ferias_gestor_exclui" on public.ferias
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "fila_leitura" on public.fila_de_calculo
  using (((select public.ve_o_time()) and setor_id = any ((select public.meus_setores())::smallint[]))
         or pedido_por = (select public.pessoa_atual()));
alter policy "lancamentos_gestor" on public.lancamentos
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
  with check ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "lancamentos_leitura" on public.lancamentos
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
alter policy "lancamentos_substituidos_leitura" on public.lancamentos_substituidos
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
-- Métrica desligada: pela fila (as antigas, sem fila, são da Conexão Expansão).
alter policy "metricas_desligadas_leitura" on public.metricas_desligadas
  using ((select public.eh_gestor()) and ((canal_id is null and 1::smallint = any ((select public.meus_setores())::smallint[]))
                                         or public.cuida_do_canal(canal_id)));
alter policy "alteracoes_leitura" on public.monitoria_alteracoes
  using (exists (select 1 from monitorias m where m.id = monitoria_alteracoes.monitoria_id
                    and (((select public.ve_o_time()) and m.operador_id = any ((select public.pessoas_que_vejo())::uuid[]))
                         or m.operador_id = (select public.operador_atual()))));
alter policy "itens_leitura" on public.monitoria_itens
  using (exists (select 1 from monitorias m where m.id = monitoria_itens.monitoria_id
                    and (((select public.ve_o_time()) and m.operador_id = any ((select public.pessoas_que_vejo())::uuid[]))
                         or m.operador_id = (select public.operador_atual()))));
alter policy "itens_escrita" on public.monitoria_itens
  using ((select public.pode_monitorar()) and exists (select 1 from monitorias m where m.id = monitoria_itens.monitoria_id
                    and m.operador_id = any ((select public.pessoas_que_vejo())::uuid[])))
  with check ((select public.pode_monitorar()) and exists (select 1 from monitorias m where m.id = monitoria_itens.monitoria_id
                    and m.operador_id = any ((select public.pessoas_que_vejo())::uuid[])));
alter policy "monitorias_leitura" on public.monitorias
  using (((select public.ve_o_time()) and operador_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or operador_id = (select public.operador_atual()));
alter policy "monitorias_escrita" on public.monitorias
  using ((select public.pode_monitorar()) and operador_id = any ((select public.pessoas_que_vejo())::uuid[]))
  with check ((select public.pode_monitorar()) and operador_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "excluidas_leitura" on public.monitorias_excluidas
  using ((select public.ve_o_time()) and operador_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "pesos_historico_leitura" on public.pesos_historico
  using ((select public.eh_gestor()) and public.cuida_do_cargo(cargo_id));
alter policy "pesos_leitura" on public.pesos_por_cargo
  using (public.cuida_do_cargo(cargo_id));
alter policy "pesos_gestor" on public.pesos_por_cargo
  using ((select public.eh_gestor()) and public.cuida_do_cargo(cargo_id))
  with check ((select public.eh_gestor()) and public.cuida_do_cargo(cargo_id));
-- Pessoa recém-criada ainda não tem setor: o gatilho setor_inicial dá o de
-- quem cria logo em seguida; até lá, quem vê o time a enxerga.
alter policy "pessoas_leitura" on public.pessoas
  using (((select public.ve_o_time()) and (id = any ((select public.pessoas_que_vejo())::uuid[])
            or not public.tem_setor(pessoas.id)))
         or id = (select public.pessoa_atual()));
alter policy "pessoas_gestor" on public.pessoas
  using ((select public.eh_gestor()) and (id = any ((select public.pessoas_que_vejo())::uuid[])
            or not public.tem_setor(pessoas.id)))
  with check ((select public.eh_gestor()));
alter policy "realocacoes_leitura" on public.realocacoes
  using ((select public.eh_gestor()) and (de_pessoa = any ((select public.pessoas_que_vejo())::uuid[])
                                          or para_pessoa = any ((select public.pessoas_que_vejo())::uuid[])));
alter policy "redefinicoes_leitura" on public.redefinicoes_de_senha
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "regras_leitura" on public.regras
  using (setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "regras_gestor" on public.regras
  using ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]))
  with check ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "resumo_cota_mensal_leitura" on public.resumo_cota_mensal
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
alter policy "resumo_extrato_leitura" on public.resumo_extrato
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
alter policy "resumo_sem_cargo_leitura" on public.resumo_sem_cargo
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
alter policy "saidas_leitura" on public.saidas
  using ((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "saidas_gestor" on public.saidas
  with check ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
-- A lista de setores: cada um vê o seu (é o que o seletor do menu mostra);
-- o administrador vê todos.
alter policy "setores_leitura" on public.setores
  using (id = any ((select public.meus_setores())::smallint[]));
-- Setor: criar e apagar é do administrador; o gestor ajusta o dele.
alter policy "setores_gestor" on public.setores
  using ((select public.eh_admin()) or ((select public.eh_gestor()) and id = any ((select public.meus_setores())::smallint[])))
  with check ((select public.eh_admin()) or ((select public.eh_gestor()) and id = any ((select public.meus_setores())::smallint[])));
alter policy "setores_pessoa_leitura" on public.setores_da_pessoa
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
alter policy "setores_pessoa_gestor" on public.setores_da_pessoa
  using ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]))
  with check ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "solicitacoes_leitura" on public.solicitacoes_exclusao
  using ((select public.ve_o_time()) and (
           exists (select 1 from monitorias m where m.id = solicitacoes_exclusao.monitoria_id
                      and m.operador_id = any ((select public.pessoas_que_vejo())::uuid[]))
        or exists (select 1 from monitorias_excluidas e where e.monitoria_id = solicitacoes_exclusao.monitoria_id
                      and e.operador_id = any ((select public.pessoas_que_vejo())::uuid[]))));
alter policy "valores_alteracoes_leitura" on public.valores_alteracoes
  using ((select public.ve_o_time()) and setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "valores_leitura" on public.valores_da_cota
  using (setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "valores_gestor" on public.valores_da_cota
  using ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]))
  with check ((select public.eh_gestor()) and setor_id = any ((select public.meus_setores())::smallint[]));
alter policy "valores_rh_leitura" on public.valores_rh
  using (((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));
alter policy "valores_rh_alteracoes_leitura" on public.valores_rh_alteracoes
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "volume_outro_setor_gestor" on public.volume_outro_setor
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
  with check ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "volume_gestor" on public.volume_semanal
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
  with check ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
alter policy "volume_leitura" on public.volume_semanal
  using (((select public.ve_o_time()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));

-- Diário: quem vê cada registro continua pela configuração de visibilidade,
-- e agora só dentro do setor de quem escreveu (o administrador vê todos).
create or replace function public.pessoa_ve_diario(p_pessoa uuid, p_tipo text, p_autor uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select (public.eh_admin() or p_autor = p_pessoa or public.cuida_da_pessoa(p_autor)) and coalesce((
    select case v.quem
             when 'todos' then true
             when 'gestor' then p.papel in ('gestor', 'administrador')
             else p.papel in ('gestor', 'administrador')
                  or coalesce((select c.nome from public.cargos c
                                where c.id = public.cargo_na_competencia(
                                  p.id, (now() at time zone 'America/Sao_Paulo')::date)) = 'Atendente Pleno', false)
           end
           or (v.autor_ve and p_autor = p_pessoa)
      from public.diario_visibilidade v
      join public.pessoas p on p.id = p_pessoa
     where v.tipo = p_tipo), false);
$function$;

-- --------------------------------------------- 4. Gravação: a guarda do setor
-- Antes de cada gravação de gestor ou qualidade: a pessoa / o setor / o cargo
-- / a fila da linha precisa ser do setor dele. Vale para as regras de acesso
-- e para as funções do banco que gravam por conta própria. Sistema (sem
-- login), administrador e atendente (já limitado ao que é dele) passam.
create or replace function public.guarda_do_setor() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_linhas jsonb[] := '{}';
  j jsonb;
  v text;
  r text;
  v_tipo text;
  v_coluna text;
begin
  if auth.uid() is null or public.eh_admin() or coalesce(public.papel_atual(), 'operador') = 'operador' then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' then v_linhas := v_linhas || to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_linhas := v_linhas || to_jsonb(new); end if;
  foreach r in array tg_argv loop
    v_tipo := split_part(r, ':', 1);
    v_coluna := split_part(r, ':', 2);
    foreach j in array v_linhas loop
      v := j ->> v_coluna;
      continue when v is null;
      if (v_tipo = 'pessoa' and not public.cuida_da_pessoa(v::uuid))
         -- Pessoa recém-criada (sem setor ainda) pode receber setor e cargo.
         or (v_tipo = 'pessoa_ou_nova' and not public.cuida_da_pessoa(v::uuid)
             and exists (select 1 from public.setores_da_pessoa s where s.pessoa_id = v::uuid))
         or (v_tipo = 'setor' and not public.cuida_do_setor(v::smallint))
         or (v_tipo = 'cargo' and not public.cuida_do_cargo(v::smallint))
         or (v_tipo = 'canal' and not public.cuida_do_canal(v::smallint)) then
        raise exception 'Fora do seu setor: só o administrador mexe em outro setor.' using errcode = '42501';
      end if;
    end loop;
  end loop;
  return coalesce(new, old);
end;
$$;

do $$
declare
  g record;
begin
  for g in select * from (values
      ('volume_semanal', 'pessoa:pessoa_id'), ('lancamentos', 'pessoa:pessoa_id'),
      ('avaliacoes', 'pessoa:pessoa_id'), ('avaliacoes_guardadas', 'pessoa:pessoa_id,canal:canal_id'),
      ('cargos_da_pessoa', 'pessoa_ou_nova:pessoa_id,cargo:cargo_id'),
      ('setores_da_pessoa', 'pessoa_ou_nova:pessoa_id,setor:setor_id'),
      ('chamados_elo', 'pessoa:pessoa_id'), ('atendimentos_presenciais', 'pessoa:pessoa_id'),
      ('monitorias', 'pessoa:operador_id,setor:setor_id'), ('fechamentos_cota', 'pessoa:pessoa_id,setor:setor_id'),
      ('fechamento_alteracoes', 'pessoa:pessoa_id'), ('valores_rh', 'pessoa:pessoa_id'),
      ('ferias', 'pessoa:pessoa_id'), ('saidas', 'pessoa:pessoa_id'),
      ('volume_outro_setor', 'pessoa:pessoa_id'), ('atendimentos_outro_setor', 'pessoa:pessoa_id'),
      ('lancamentos_substituidos', 'pessoa:pessoa_id'), ('diario_registros', 'pessoa:pessoa_id'),
      ('regras', 'setor:setor_id'), ('cargos', 'setor:setor_id'), ('criterios', 'setor:setor_id'),
      ('canais_do_setor', 'setor:setor_id'), ('valores_da_cota', 'setor:setor_id'),
      ('pesos_por_cargo', 'cargo:cargo_id'),
      ('cargos_referencia', 'cargo:cargo_id'), ('metricas_desligadas', 'canal:canal_id')
    ) x(tabela, regras) loop
    execute format('drop trigger if exists guarda_do_setor on public.%I', g.tabela);
    execute format('create trigger guarda_do_setor before insert or update or delete on public.%I
                    for each row execute function public.guarda_do_setor(%s)', g.tabela,
                   (select string_agg(quote_literal(p), ', ') from unnest(string_to_array(g.regras, ',')) p));
  end loop;
end $$;

-- Pessoas: editar e apagar só do setor; criar, qualquer gestor (o setor vem
-- logo em seguida). O papel de administrador só o administrador dá ou tira.
create or replace function public.guarda_da_pessoa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.eh_admin() then return coalesce(new, old); end if;
  if (tg_op <> 'DELETE' and new.papel = 'administrador') or (tg_op <> 'INSERT' and old.papel = 'administrador') then
    raise exception 'Só o administrador mexe na conta de administrador.' using errcode = '42501';
  end if;
  if tg_op <> 'INSERT' and coalesce(public.papel_atual(), 'operador') <> 'operador'
     and not public.cuida_da_pessoa(old.id)
     and exists (select 1 from public.setores_da_pessoa s where s.pessoa_id = old.id) then
    raise exception 'Fora do seu setor: só o administrador mexe em outro setor.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists guarda_da_pessoa on public.pessoas;
create trigger guarda_da_pessoa before insert or update or delete on public.pessoas
  for each row execute function public.guarda_da_pessoa();

-- Setor: só o administrador cria e apaga.
create or replace function public.guarda_dos_setores() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.eh_admin() and tg_op in ('INSERT', 'DELETE') then
    raise exception 'Só o administrador cria ou apaga setor.' using errcode = '42501';
  end if;
  if auth.uid() is not null and not public.eh_admin() and tg_op = 'UPDATE' and not public.cuida_do_setor(old.id) then
    raise exception 'Fora do seu setor: só o administrador mexe em outro setor.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists guarda_dos_setores on public.setores;
create trigger guarda_dos_setores before insert or update or delete on public.setores
  for each row execute function public.guarda_dos_setores();

-- Pessoa nova nasce no setor de quem a cria (antes: sempre a Conexão Expansão).
create or replace function public.setor_inicial_da_pessoa() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.setores_da_pessoa (pessoa_id, desde, setor_id)
  values (new.id, date_trunc('month', coalesce(new.criado_em, now()))::date,
          coalesce(case when auth.uid() is not null and not public.eh_admin() then (public.meus_setores())[1] end, 1))
  on conflict do nothing;
  return new;
end;
$function$;

-- Criar acesso: o papel de administrador só pelo administrador.
do $$
declare v text := pg_get_functiondef('public.criar_acesso(uuid,text,text)'::regprocedure);
begin
  if position($q$if p_papel not in ('gestor', 'qualidade', 'operador') then$q$ in v) = 0 then
    raise exception 'criar_acesso mudou desde o ensaio: revisar a 94.';
  end if;
  v := replace(v, $q$if p_papel not in ('gestor', 'qualidade', 'operador') then$q$,
               $q$if p_papel not in ('gestor', 'qualidade', 'operador')
     and not (p_papel = 'administrador' and public.eh_admin()) then$q$);
  execute v;
end $$;

-- Fechar e pedir fechamento: só setor meu (sem setor = os meus).
do $$
declare v text := pg_get_functiondef('public.pedir_fechamento(date,smallint)'::regprocedure);
begin
  v := replace(v, $q$where ativo and (p_setor is null or id = p_setor)$q$,
               $q$where ativo and (p_setor is null or id = p_setor) and id = any (public.meus_setores())$q$);
  if position('meus_setores' in v) = 0 then raise exception 'pedir_fechamento mudou desde o ensaio: revisar a 94.'; end if;
  execute v;
end $$;

-- Fechar o ciclo: setor alheio é recusado; sem setor, fecha só os meus.
do $$
declare v text := pg_get_functiondef('public.fechar_ciclo(date,smallint)'::regprocedure);
begin
  if position($q$    raise exception 'Apenas gestores fecham o ciclo.';
  end if;$q$ in v) = 0
     or position($q$and (p_setor is null or public.setor_na_competencia(m.pessoa_id, p_mes) = p_setor)$q$ in v) = 0 then
    raise exception 'fechar_ciclo mudou desde o ensaio: revisar a 94.';
  end if;
  v := replace(v, $q$    raise exception 'Apenas gestores fecham o ciclo.';
  end if;$q$, $q$    raise exception 'Apenas gestores fecham o ciclo.';
  end if;
  if p_setor is not null and not public.cuida_do_setor(p_setor) then
    raise exception 'Fora do seu setor: só o administrador mexe em outro setor.' using errcode = '42501';
  end if;$q$);
  v := replace(v, $q$and (p_setor is null or public.setor_na_competencia(m.pessoa_id, p_mes) = p_setor)$q$,
               $q$and (p_setor is null or public.setor_na_competencia(m.pessoa_id, p_mes) = p_setor)
       and public.setor_na_competencia(m.pessoa_id, p_mes) = any (public.meus_setores())$q$);
  execute v;
end $$;

-- ------------------------------------------- 5. Listas devolvidas por função
create or replace function public.ultimo_login_das_pessoas()
 returns table(pessoa_id uuid, ultimo_login timestamp with time zone)
 language sql stable security definer set search_path to 'public' as $function$
  select p.id, u.last_sign_in_at
    from public.pessoas p
    join auth.users u on u.id = p.auth_id
   where public.eh_gestor() and p.id = any (public.pessoas_que_vejo());
$function$;

create or replace function public.ferias_prazos()
 returns table(pessoa_id uuid, nome text, admitido_em date, aquisitivo_inicio date, aquisitivo_fim date, limite date,
               saldo integer, dias_ate_limite integer, completo boolean, concluidos integer, concluido_inicio date,
               concluido_fim date)
 language sql stable security definer set search_path to 'public' as $function$
  select f.* from public.ferias_prazos_internos() f
   where public.eh_gestor() and f.pessoa_id = any (public.pessoas_que_vejo());
$function$;

create or replace function public.situacao_da_fila()
returns table (id bigint, setor_id smallint, mes_competencia date, tipo text, situacao text,
               pedido_em timestamptz, concluido_em timestamptz, resultado integer, erro text)
language sql stable security definer set search_path = public as $$
  select f.id, f.setor_id, f.mes_competencia, f.tipo, f.situacao, f.pedido_em, f.concluido_em, f.resultado,
         case when (select public.ve_o_time()) then f.erro end
    from public.fila_de_calculo f
   where (f.situacao in ('na_fila', 'calculando') or f.concluido_em > now() - interval '15 minutes')
     and (f.setor_id = any (public.meus_setores()) or f.pedido_por = public.pessoa_atual())
   order by f.pedido_em desc;
$$;

-- --------------------------------------------------------------- 6. As provas
select pg_temp.medir(papel, 'acesso_depois') from quem_testa;

do $$
declare
  v_cota integer;
  v_acesso integer;
  v_perfis integer;
  v_lista text;
begin
  select count(*) into v_cota from public.comparar_com_a_foto('antes-da-94');
  select count(*), string_agg(coalesce(a.papel, d.papel) || '/' || coalesce(a.objeto, d.objeto), ', ')
    into v_acesso, v_lista
    from acesso_antes a full join acesso_depois d on d.papel = a.papel and d.objeto = a.objeto
   where a.hash is distinct from d.hash;
  select count(distinct papel) into v_perfis from acesso_antes;
  if v_perfis < 4 or exists (select 1 from quem_testa where auth_id is null) then
    raise exception 'A prova de acesso precisa dos quatro perfis com login. Nada foi gravado.';
  end if;
  if v_cota + v_acesso > 0 then
    raise exception 'A 94 mudou algo (cota: % linha(s); acesso: %). Nada foi gravado.', v_cota, v_lista;
  end if;
end $$;

commit;

-- Conferência
select p.nome, p.papel from public.pessoas p where p.papel in ('administrador', 'gestor', 'qualidade') order by p.papel, p.nome;
select count(*) as diferencas_da_cota from public.comparar_com_a_foto('antes-da-94');
select event_object_table as tabela, count(*) as guardas from information_schema.triggers
 where trigger_name in ('guarda_do_setor', 'guarda_da_pessoa', 'guarda_dos_setores') and event_manipulation = 'INSERT'
 group by 1 order by 1;
