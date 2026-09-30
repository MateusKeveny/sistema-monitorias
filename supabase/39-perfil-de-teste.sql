-- ============================================================================
-- 39 · Perfil de teste fora da leitura obrigatória
--
-- O perfil "Teste de acesso" serve para conferir telas com outro papel. Ativo,
-- ele entrava na conta de quem precisa ler o diário ("Lido por 1 de 9") e na
-- pendência do Início. Marcado como perfil de teste, fica de fora: não é
-- bloqueado e não conta como leitor.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

alter table public.pessoas
  add column if not exists perfil_de_teste boolean not null default false;

update public.pessoas set perfil_de_teste = true where nome = 'Teste de acesso';

-- Quem precisa ler o quê (a da 38, sem os perfis de teste).
create or replace function public.leituras_do_diario()
returns table (registro_id uuid, pessoa_id uuid, nome text, ciente_em timestamptz)
language sql stable security definer set search_path = public as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select r.id, p.id, p.nome, l.ciente_em
    from public.diario_registros r
    cross join hoje
    join public.pessoas p
      on p.ativo and p.desligado_em is null and p.auth_id is not null
     and p.papel <> 'gestor' and p.id <> r.pessoa_id and not p.perfil_de_teste
    left join public.diario_leituras l on l.registro_id = r.id and l.pessoa_id = p.id
   where r.tipo in ('processo', 'treinamento')
     and r.situacao = 'concluido'
     and (r.valido_ate >= hoje.d or (r.valido_ate is null and r.data >= hoje.d - 30))
     and (public.aprova_diario() or p.id = public.pessoa_atual());
$$;

-- ---------------------------------------------------------------------------
-- Conferência: o perfil marcado e quantas pessoas precisam ler hoje
-- ---------------------------------------------------------------------------
select
  (select string_agg(nome, ', ') from public.pessoas where perfil_de_teste) as perfis_de_teste,
  (select count(*) from public.pessoas p
    where p.ativo and p.desligado_em is null and p.auth_id is not null
      and p.papel <> 'gestor' and not p.perfil_de_teste) as pessoas_que_leem;
