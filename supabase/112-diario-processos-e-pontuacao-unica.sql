-- 112 (Performance 4.12.0): diário de bordo e pontuação única nos atendimentos.
--
-- 1. "Processo novo" e "Treinamento" passam a ser registrados só por Pleno,
--    analistas e gestão (pedido do gestor em 17/11/2026). Ficam de fora o
--    Atendente Júnior e o Assistente de Logística. Os demais tipos
--    (autorização, exceção) seguem abertos a todos; problema operacional
--    segue só com quem aprova (migração 51).
--
--    Quem registra: papel gestor, administrador ou qualidade, ou o cargo de
--    hoje "Atendente Pleno", "Gestor", "Diretora" ou começando por "Analista"
--    (Analista, Analista de Qualidade, Analista de Dados…).
--
-- 2. "Mudar tipo": o gestor (só do próprio setor, pela guarda_do_setor) troca
--    o tipo de um registro já feito, por exemplo um processo registrado por um
--    júnior que vira exceção. O tipo anterior, quem mudou e quando ficam no
--    próprio registro. Autorização e exceção pedem protocolo e quem autorizou,
--    como no registro normal (as restrições da tabela continuam valendo).
--
-- 3. setores.pontuacao_unica_atendimento: a chave da tela Pesos por cargo.
--    Ligada, as métricas de atendimento (finalizado, TME, TMA, C-SAT e notas)
--    têm um valor só, que a tela grava igual em todos os cargos do setor. O
--    cálculo não muda: ele continua lendo pesos_por_cargo de cada cargo.
--
-- Nada é apagado; nenhum registro existente muda de tipo por esta migração.

begin;

-- 1. Quem registra processo novo e treinamento.
create or replace function public.registra_processo_diario()
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_gestor() is true
      or coalesce(public.papel_atual() in ('administrador', 'diretoria', 'qualidade'), false)
      or coalesce(public.cargo_atual_nome() in ('Atendente Pleno', 'Gestor', 'Diretora')
                  or public.cargo_atual_nome() like 'Analista%', false);
$$;
revoke all on function public.registra_processo_diario() from public, anon;
grant execute on function public.registra_processo_diario() to authenticated;

alter policy "diario_registro" on public.diario_registros
  with check ((((select public.pessoa_atual()) is not null)
               and (pessoa_id = (select public.pessoa_atual()))
               and ((tipo <> 'problema'::text) or public.aprova_diario())
               and ((tipo <> all (array['processo'::text, 'treinamento'::text])) or public.registra_processo_diario())));

alter policy "diario_correcao" on public.diario_registros
  with check (((pessoa_id = (select public.pessoa_atual()))
               and ((tipo <> 'problema'::text) or public.aprova_diario())
               and ((tipo <> all (array['processo'::text, 'treinamento'::text])) or public.registra_processo_diario())));

-- 2. Mudar o tipo de um registro já feito.
alter table public.diario_registros
  add column if not exists tipo_anterior text,
  add column if not exists tipo_mudado_por uuid references public.pessoas(id) on delete set null,
  add column if not exists tipo_mudado_em timestamptz;
comment on column public.diario_registros.tipo_anterior is
  '112: o tipo antes do "Mudar tipo" do gestor (null = nunca mudou).';

create or replace function public.mudar_tipo_registro_diario(
  p_registro uuid, p_tipo text, p_protocolo text default null,
  p_quem text default null, p_quem_nome text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_atual text;
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor muda o tipo de um registro do diário.';
  end if;
  if p_tipo not in ('processo', 'treinamento', 'autorizacao', 'excecao') then
    raise exception 'Tipo inválido: escolha processo novo, treinamento, autorização ou exceção.';
  end if;

  select tipo into v_atual from public.diario_registros where id = p_registro;
  if v_atual is null then raise exception 'Registro não encontrado.'; end if;
  if v_atual = 'problema' then
    raise exception 'Problema operacional não muda de tipo.';
  end if;
  if v_atual = p_tipo then return; end if;

  if p_tipo in ('autorizacao', 'excecao') then
    if length(trim(coalesce(p_protocolo, ''))) = 0 then
      raise exception 'Autorização e exceção pedem o protocolo do atendimento.';
    end if;
    if p_quem not in ('gestao', 'diretoria', 'outro') or length(trim(coalesce(p_quem_nome, ''))) = 0 then
      raise exception 'Autorização e exceção pedem quem autorizou.';
    end if;
  end if;

  update public.diario_registros
     set tipo = p_tipo,
         protocolo = case when p_tipo in ('autorizacao', 'excecao') then trim(p_protocolo) else protocolo end,
         autorizado_por = case when p_tipo in ('autorizacao', 'excecao') then p_quem else autorizado_por end,
         autorizado_por_nome = case when p_tipo in ('autorizacao', 'excecao') then trim(p_quem_nome) else autorizado_por_nome end,
         tipo_anterior = coalesce(tipo_anterior, v_atual),
         tipo_mudado_por = public.pessoa_atual(),
         tipo_mudado_em = now()
   where id = p_registro;
end;
$$;
revoke all on function public.mudar_tipo_registro_diario(uuid, text, text, text, text) from public, anon;
grant execute on function public.mudar_tipo_registro_diario(uuid, text, text, text, text) to authenticated;

-- 3. A chave da pontuação única nos atendimentos, por setor.
alter table public.setores
  add column if not exists pontuacao_unica_atendimento boolean not null default false;
comment on column public.setores.pontuacao_unica_atendimento is
  '112: ligada, Pesos por cargo mostra um valor só para finalizado, TME, TMA, C-SAT e notas, gravado igual em todos os cargos.';

commit;

-- Conferência: quem registra processo novo e treinamento a partir de agora.
select p.nome, p.papel, c.nome as cargo_hoje,
       coalesce(p.papel in ('gestor', 'administrador', 'diretoria', 'qualidade')
        or c.nome in ('Atendente Pleno', 'Gestor', 'Diretora') or c.nome like 'Analista%', false) as registra_processo
  from public.pessoas p
  left join public.cargos c
    on c.id = public.cargo_na_competencia(p.id, (now() at time zone 'America/Sao_Paulo')::date)
 where p.ativo and p.desligado_em is null
 order by registra_processo desc, p.nome;
