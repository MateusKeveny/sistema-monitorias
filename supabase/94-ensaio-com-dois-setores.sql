-- Ensaio da 94 com um segundo setor de mentira (só no banco local; desfaz no fim).
begin;
create temp table r (n serial, quem text, teste text, esperado text, obtido text);
grant all on r to authenticated; grant usage on sequence r_n_seq to authenticated;
create temp table ids (chave text primary key, v text);
grant all on ids to authenticated;

-- Quem é quem.
insert into ids select 'adminA', p.auth_id::text from pessoas p where p.papel = 'administrador';
insert into ids select 'gestorA', p.auth_id::text from pessoas p where p.papel = 'gestor' and p.auth_id is not null order by p.id limit 1;
insert into ids select 'qualidadeA', p.auth_id::text from pessoas p where p.papel = 'qualidade' and p.auth_id is not null limit 1;
insert into ids select 'opA', p.id::text from pessoas p where p.papel = 'operador' and p.ativo and exists (select 1 from volume_semanal v where v.pessoa_id = p.id) order by p.id limit 1;

-- O setor B, criado pelo administrador (com as definições copiadas do A).
create or replace function pg_temp.como(p_quem text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',(select v from ids where chave = p_quem))::text, true);
  set local role authenticated;
end $$;
select pg_temp.como('adminA');
select clonar_setor('Setor Teste B', 1::smallint, true) as setor_b \gset
reset role;
select set_config('request.jwt.claims', '{}', true);
insert into ids values ('setorB', :'setor_b');

-- Pessoas do B (com login de mentira).
do $$
declare v_setor smallint := (select v from ids where chave = 'setorB')::smallint; papel text; v_auth uuid; v_id uuid;
begin
  foreach papel in array array['gestor', 'qualidade', 'operador'] loop
    v_auth := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_auth, 'authenticated', 'authenticated', papel || 'b@teste.local', now(), '{}', '{}', now(), now(), '', '', '', '');
    insert into pessoas (nome, papel, ativo, auth_id, email, senha_definida) values ('Teste B ' || papel, papel, true, v_auth, papel || 'b@teste.local', true) returning id into v_id;
    update setores_da_pessoa set setor_id = v_setor where pessoa_id = v_id;
    insert into ids values (papel || 'B', v_auth::text), (papel || 'B_id', v_id::text);
  end loop;
  -- Um volume do atendente B.
  insert into volume_semanal (pessoa_id, mes_competencia, semana, finalizados, canal, canal_id)
  values ((select v from ids where chave = 'operadorB_id')::uuid, '2026-11-01', 1, 10, 'huggy',
          (select id from canais_do_setor where setor_id = v_setor order by id limit 1));
end $$;

-- O teste: roda o comando como a pessoa e guarda o resultado.
create or replace function pg_temp.t(p_quem text, p_teste text, p_sql text, p_esperado text) returns void language plpgsql as $$
declare n bigint; obtido text;
begin
  begin
    perform pg_temp.como(p_quem);
    if p_sql ~* '^\s*select' then execute p_sql into n; obtido := 'linhas=' || n;
    else execute p_sql; get diagnostics n = row_count; obtido := 'gravou=' || n; end if;
  exception when others then obtido := 'erro'; insert into r (quem, teste, esperado, obtido) values (p_quem, '  (motivo)', '', left(sqlerrm, 90));
  end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  insert into r (quem, teste, esperado, obtido) values (p_quem, p_teste, p_esperado, obtido);
end $$;

-- Leitura cruzada.
select pg_temp.t('gestorA', 'vê pessoas do B', $q$select count(*) from pessoas where nome like 'Teste B%'$q$, 'linhas=0');
select pg_temp.t('gestorA', 'vê volume do B', $q$select count(*) from volume_semanal where pessoa_id = (select v from ids where chave='operadorB_id')::uuid$q$, 'linhas=0');
select pg_temp.t('gestorA', 'vê regras do B', $q$select count(*) from regras where setor_id = (select v from ids where chave='setorB')::smallint$q$, 'linhas=0');
select pg_temp.t('gestorA', 'vê cargos do B', $q$select count(*) from cargos where setor_id = (select v from ids where chave='setorB')::smallint$q$, 'linhas=0');
select pg_temp.t('qualidadeA', 'vê pessoas do B', $q$select count(*) from pessoas where nome like 'Teste B%'$q$, 'linhas=0');
select pg_temp.t('gestorB', 'vê pessoas do A', $q$select count(*) from pessoas p where not (p.nome like 'Teste B%')$q$, 'linhas=0');
select pg_temp.t('gestorB', 'vê volume do A', $q$select count(*) from volume_semanal where pessoa_id = (select v from ids where chave='opA')::uuid$q$, 'linhas=0');
select pg_temp.t('gestorB', 'vê cota (extrato) do A', $q$select count(*) from vw_cota_mensal where pessoa_id = (select v from ids where chave='opA')::uuid$q$, 'linhas=0');
select pg_temp.t('gestorB', 'vê monitorias do A', $q$select count(*) from monitorias$q$, 'linhas=0');
select pg_temp.t('gestorB', 'vê as pessoas do B', $q$select count(*) from pessoas$q$, 'linhas=3');
select pg_temp.t('qualidadeB', 'vê pessoas do A', $q$select count(*) from pessoas p where not (p.nome like 'Teste B%')$q$, 'linhas=0');
select pg_temp.t('operadorB', 'vê volume de outros', $q$select count(*) from volume_semanal where pessoa_id <> (select v from ids where chave='operadorB_id')::uuid$q$, 'linhas=0');
select pg_temp.t('adminA', 'vê pessoas dos dois', $q$select count(*) from pessoas where nome like 'Teste B%'$q$, 'linhas=3');
select pg_temp.t('gestorA', 'continua vendo o A', $q$select count(*) from volume_semanal where pessoa_id = (select v from ids where chave='opA')::uuid$q$, 'linhas>0');

-- Gravação cruzada (direto e por função do banco).
select pg_temp.t('gestorA', 'lança para atendente do B', $q$insert into lancamentos (pessoa_id, mes_competencia, regra, quantidade, canal) values ((select v from ids where chave='operadorB_id')::uuid, '2026-11-01', 'presencial', 1, 'huggy')$q$, 'erro');
select pg_temp.t('gestorA', 'altera volume do B', $q$update volume_semanal set finalizados = 99 where pessoa_id = (select v from ids where chave='operadorB_id')::uuid$q$, 'gravou=0');
select pg_temp.t('gestorA', 'move volume do A para o B (função)', $q$select count(*) from (select mover_volume((select id from volume_semanal where pessoa_id = (select v from ids where chave='opA')::uuid order by id desc limit 1), (select v from ids where chave='operadorB_id')::uuid)) x$q$, 'erro');
select pg_temp.t('gestorA', 'pede fechamento do B', $q$select count(*) from (select pedir_fechamento('2026-11-01', (select v from ids where chave='setorB')::smallint)) x where exists (select 1 from fila_de_calculo where setor_id = (select v from ids where chave='setorB')::smallint and tipo='fechar')$q$, 'linhas=0');
select pg_temp.t('gestorA', 'fecha o B direto (função)', $q$select count(*) from (select fechar_ciclo('2026-11-01', (select v from ids where chave='setorB')::smallint)) x$q$, 'erro');
select pg_temp.t('gestorA', 'muda monitorias do B', $q$select count(*) from (select definir_monitorias_do_setor((select v from ids where chave='setorB')::smallint, 2::smallint, 0.8)) x$q$, 'erro');
select pg_temp.t('gestorA', 'muda regra do B', $q$update regras set rotulo = rotulo || '!' where setor_id = (select v from ids where chave='setorB')::smallint$q$, 'gravou=0');
select pg_temp.t('gestorA', 'cria setor', $q$select count(*) from (select clonar_setor('Outro', 1::smallint, false)) x$q$, 'erro');
select pg_temp.t('gestorA', 'vira administrador', $q$update pessoas set papel = 'administrador' where auth_id = (select v from ids where chave='gestorA')::uuid$q$, 'erro');
select pg_temp.t('gestorA', 'mexe na conta admin', $q$update pessoas set ativo = false where papel = 'administrador'$q$, 'erro');
select pg_temp.t('gestorA', 'dá acesso de administrador', $q$select count(*) from (select criar_acesso((select v from ids where chave='opA')::uuid, 'x@teste.local', 'administrador')) x$q$, 'erro');
select pg_temp.t('gestorA', 'tira atendente do B', $q$delete from setores_da_pessoa where pessoa_id = (select v from ids where chave='operadorB_id')::uuid$q$, 'gravou=0');
select pg_temp.t('gestorA', 'traz atendente do B para o A', $q$insert into setores_da_pessoa (pessoa_id, desde, setor_id) values ((select v from ids where chave='operadorB_id')::uuid, '2026-12-01', 1)$q$, 'erro');
select pg_temp.t('qualidadeA', 'monitora atendente do B', $q$insert into monitorias (operador_id, data_atendimento, setor_id) values ((select v from ids where chave='operadorB_id')::uuid, '2026-11-03', 1)$q$, 'erro');
select pg_temp.t('gestorB', 'lança para atendente do A', $q$insert into lancamentos (pessoa_id, mes_competencia, regra, quantidade, canal) values ((select v from ids where chave='opA')::uuid, '2026-11-01', 'presencial', 1, 'huggy')$q$, 'erro');
select pg_temp.t('gestorB', 'cria pessoa no B', $q$insert into pessoas (nome, papel, ativo) values ('Teste B nova', 'operador', true)$q$, 'gravou=1');
select pg_temp.t('gestorB', 'pessoa nova nasce no B', $q$select count(*) from setores_da_pessoa s join pessoas p on p.id = s.pessoa_id where p.nome = 'Teste B nova' and s.setor_id = (select v from ids where chave='setorB')::smallint$q$, 'linhas=1');
select pg_temp.t('gestorB', 'lança para o próprio atendente', $q$insert into lancamentos (pessoa_id, mes_competencia, regra, quantidade, canal) values ((select v from ids where chave='operadorB_id')::uuid, '2026-11-01', 'presencial', 1, 'huggy')$q$, 'gravou=1');
select pg_temp.t('adminA', 'lança no A e no B', $q$insert into lancamentos (pessoa_id, mes_competencia, regra, quantidade, canal) values ((select v from ids where chave='operadorB_id')::uuid, '2026-11-01', 'presencial', 1, 'huggy'), ((select v from ids where chave='opA')::uuid, '2026-11-01', 'presencial', 1, 'huggy')$q$, 'gravou=2');

select pg_temp.t('gestorA', 'lista de setores', $q$select count(*) from setores$q$, 'linhas=1');
select pg_temp.t('gestorB', 'lista de setores', $q$select count(*) from setores where nome = 'Setor Teste B'$q$, 'linhas=1');
select pg_temp.t('adminA', 'lista de setores', $q$select count(*) from setores$q$, 'linhas=2');
-- O trabalho de cada um continua funcionando no próprio setor.
select pg_temp.t('gestorA', 'muda regra do A', $q$update regras set rotulo = rotulo where setor_id = 1$q$, 'gravou>0');
select pg_temp.t('gestorA', 'muda peso do A', $q$update pesos_por_cargo set peso = peso where cargo_id in (select id from cargos where setor_id = 1)$q$, 'gravou>0');
select pg_temp.t('gestorA', 'muda o próprio setor', $q$update setores set nome = nome where id = 1$q$, 'gravou=1');
select pg_temp.t('gestorA', 'lança para atendente do A', $q$insert into lancamentos (pessoa_id, mes_competencia, regra, quantidade, canal) values ((select v from ids where chave='opA')::uuid, '2026-11-01', 'presencial', 1, 'huggy')$q$, 'gravou=1');
select pg_temp.t('gestorA', 'altera volume do A', $q$update volume_semanal set finalizados = finalizados where pessoa_id = (select v from ids where chave='opA')::uuid$q$, 'gravou>0');
select pg_temp.t('gestorA', 'cria pessoa no A', $q$insert into pessoas (nome, papel, ativo) values ('Teste A nova', 'operador', true)$q$, 'gravou=1');
select pg_temp.t('gestorA', 'pessoa nova nasce no A', $q$select count(*) from setores_da_pessoa s join pessoas p on p.id = s.pessoa_id where p.nome = 'Teste A nova' and s.setor_id = 1$q$, 'linhas=1');
select pg_temp.t('gestorA', 'dá cargo à pessoa nova', $q$insert into cargos_da_pessoa (pessoa_id, desde, cargo_id) values ((select id from pessoas where nome = 'Teste A nova'), '2026-11-01', (select id from cargos where setor_id = 1 order by id limit 1))$q$, 'gravou=1');
select pg_temp.t('gestorA', 'pede fechamento do A', $q$select count(*) from (select pedir_fechamento('2026-11-01', 1::smallint) r) x where r = 'na_fila'$q$, 'linhas=1');
select pg_temp.t('gestorA', 'vê a fila do A', $q$select count(*) from situacao_da_fila() where setor_id = 1$q$, 'linhas>0');
select pg_temp.t('qualidadeA', 'edita monitoria do A', $q$update monitorias set protocolo = protocolo where setor_id = 1 and mes_referencia = '2026-10-01'$q$, 'gravou>0');
select pg_temp.t('adminA', 'muda regra do B', $q$update regras set rotulo = rotulo where setor_id = (select v from ids where chave='setorB')::smallint$q$, 'gravou>0');
select pg_temp.t('adminA', 'fecha o B (pedido)', $q$select count(*) from (select pedir_fechamento('2026-11-01', (select v from ids where chave='setorB')::smallint) r) x where r = 'na_fila'$q$, 'linhas=1');
select pg_temp.t('gestorA', 'últimos logins só do A', $q$select count(*) from ultimo_login_das_pessoas() u where u.pessoa_id in (select v::uuid from ids where chave like '%B_id')$q$, 'linhas=0');
select pg_temp.t('adminA', 'últimos logins do B', $q$select count(*) from ultimo_login_das_pessoas() u where u.pessoa_id in (select v::uuid from ids where chave like '%B_id')$q$, 'linhas=3');

select n, quem, teste, esperado, obtido,
       case when obtido = esperado or (esperado = 'linhas>0' and obtido ~ '^linhas=[1-9]')
                 or (esperado = 'gravou>0' and obtido ~ '^gravou=[1-9]') then 'ok' else '<<< FALHOU' end as situacao
  from r order by n;
-- O trabalhador do resumo (sem login) continua rodando, com os dois setores.
select public.atualizar_resumo(true) as itens_do_resumo;
select setor_id, count(*) from fila_de_calculo where situacao = 'erro' group by 1;
rollback;
