-- 114 · leituras_do_diario mais rápida (Performance 4.14.0)
--
-- Mesmo resultado, outra conta. A versão da 105 chamava pessoa_ve_diario para
-- cada par pessoa × registro, e ela chama cuida_da_pessoa (~10 ms), que só
-- depende do AUTOR do registro: 112 chamadas para o gestor, 1,2 s. A função
-- roda no Início do gestor, no Diário e na tela de pessoas.
--
-- Agora: o que depende só do registro (setor do autor, se quem vê alcança o
-- autor) é calculado uma vez por registro; o que depende só da pessoa (setor,
-- se é Pleno), uma vez por pessoa. Conferido no oficial em 19/11/2026: 56
-- linhas iguais para o gestor e 8 para um atendente; 1.230 ms → 89 ms.
--
-- O ramo "autor_ve and autor = pessoa" da pessoa_ve_diario não entra: a lista
-- já exclui o próprio autor (p.id <> r.pessoa_id).

create or replace function public.leituras_do_diario()
returns table(registro_id uuid, pessoa_id uuid, nome text, ciente_em timestamp with time zone)
language sql stable security definer
set search_path to 'public'
as $function$
  with hoje as materialized (
    select (now() at time zone 'America/Sao_Paulo')::date as d,
           public.aprova_diario() as aprova, public.pessoa_atual() as eu, public.eh_admin() as admin
  ),
  regs as materialized (
    select r.id, r.pessoa_id, r.tipo,
           public.setor_na_competencia(r.pessoa_id, r.data) as setor_autor,
           hoje.admin or public.cuida_da_pessoa(r.pessoa_id) as alcanca
      from public.diario_registros r cross join hoje
     where r.tipo in ('processo', 'treinamento')
       and r.situacao = 'concluido'
       and (r.valido_ate >= hoje.d or (r.valido_ate is null and r.data >= hoje.d - 30))
  ),
  pess as materialized (
    select p.id, p.nome, p.papel,
           public.setor_na_competencia(p.id, hoje.d) as setor,
           coalesce((select c.nome from public.cargos c
                      where c.id = public.cargo_na_competencia(p.id, hoje.d)) = 'Atendente Pleno', false) as pleno
      from public.pessoas p cross join hoje
     where p.ativo and p.desligado_em is null and p.auth_id is not null
       and p.papel not in ('gestor', 'administrador', 'diretoria') and not p.perfil_de_teste
       and (hoje.aprova or p.id = hoje.eu)
  )
  select r.id, p.id, p.nome, l.ciente_em
    from regs r
    -- 105: só quem está no setor do autor (autor sem setor: todos).
    join pess p on p.id <> r.pessoa_id and (r.setor_autor is null or r.setor_autor = p.setor)
    -- 67: só de quem vê o registro (a regra da pessoa_ve_diario).
    join public.diario_visibilidade v on v.tipo = r.tipo
    left join public.diario_leituras l on l.registro_id = r.id and l.pessoa_id = p.id
   where r.alcanca
     and (case v.quem
            when 'todos' then true
            when 'gestor' then p.papel in ('gestor', 'administrador')
            else p.papel in ('gestor', 'administrador') or p.pleno
          end);
$function$;
