-- ============================================================================
-- 71 · Cargo sem cota (Diretora) e realocação de lançamentos
--
-- 1. Cargo que não recebe cota. `cargos.recebe_cota`: desligado, quem está no
--    cargo não tem extrato nem resultado a partir do mês em que entrou nele —
--    sai do fechamento, da exportação, da pontuação no Comparativo e das
--    médias. Feito num lugar só: `cargo_na_competencia` passa a devolver nulo
--    para cargo sem cota, e todo o cálculo (vw_extrato_direto, a média do
--    cargo, o pagamento) já depende dela. O acesso não muda: é o papel.
--
-- 2. Luciana Freire (lufreire@…) vai para o cargo novo "Diretora", sem cota,
--    desde 06/2026 — e, por decisão do gestor (20/10/2026), "desde sempre":
--    os fechamentos dela saem também dos meses já fechados (junho a setembro).
--    Cada um fica registrado em fechamento_alteracoes antes de sair. Volume e
--    avaliações dela continuam guardados; só a cota sai. Por reescrever
--    competência já fechada, esta é a versão 2.0.0 do Performance.
--
-- 3. Lançamentos pendentes de realocação. Volume e lançamentos do mês aberto
--    de quem está sem cargo ou em cargo sem cota não pontuam para ninguém:
--    `vw_lancamentos_pendentes` lista, e o gestor passa para outra pessoa
--    (`mover_volume` / `mover_lancamento`, que servem também para corrigir
--    lançamento na pessoa errada), mantém sem cota (`manter_sem_cota`) ou
--    apaga. Toda movimentação fica em `realocacoes`.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo. No fim ele mostra o que saiu dos fechamentos e o que está pendente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cargo sem cota
-- ---------------------------------------------------------------------------
alter table public.cargos add column if not exists recebe_cota boolean not null default true;

-- O cargo da pessoa na competência, se ele recebe cota. Cargo sem cota conta
-- como "sem cargo" para o cálculo (não gera linha no extrato).
create or replace function public.cargo_na_competencia(p_pessoa uuid, p_mes date)
returns smallint language sql stable set search_path = public as $$
  select case when c.recebe_cota then cp.cargo_id end
    from public.cargos_da_pessoa cp
    join public.cargos c on c.id = cp.cargo_id
   where cp.pessoa_id = p_pessoa and cp.desde <= p_mes
   order by cp.desde desc
   limit 1;
$$;

-- "Sem cargo" (a pendência da tela inicial) é quem não tem cargo NENHUM no
-- mês — quem está num cargo sem cota não é pendência.
create or replace view public.vw_sem_cargo with (security_invoker = true) as
  select distinct d.pessoa_id, p.nome, d.mes_competencia
    from (
      select pessoa_id, mes_competencia from public.volume_semanal
      union select pessoa_id, mes_competencia from public.vw_avaliacoes_validas
      union select pessoa_id, mes_competencia from public.lancamentos
      union select operador_id, mes_referencia from public.monitorias
    ) d
    join public.pessoas p on p.id = d.pessoa_id
   where p.papel <> 'gestor'
     and not exists (select 1 from public.cargos_da_pessoa cp
                      where cp.pessoa_id = d.pessoa_id and cp.desde <= d.mes_competencia);

-- ---------------------------------------------------------------------------
-- 2. Luciana: cargo Diretora desde 06/2026 e fora dos fechamentos
-- ---------------------------------------------------------------------------
insert into public.cargos (nome, ordem, recebe_cota)
select 'Diretora', 90, false
 where not exists (select 1 from public.cargos where nome = 'Diretora');
update public.cargos set recebe_cota = false where nome = 'Diretora';

delete from public.cargos_da_pessoa
 where pessoa_id in (select id from public.pessoas where lower(trim(email)) = 'lufreire@igreenenergy.com.br');

insert into public.cargos_da_pessoa (pessoa_id, cargo_id, desde)
select p.id, c.id, date '2026-06-01'
  from public.pessoas p, public.cargos c
 where lower(trim(p.email)) = 'lufreire@igreenenergy.com.br' and c.nome = 'Diretora';

-- Ela continua vendo tudo, mas sai das listas e das médias.
update public.pessoas set exibir_no_painel = false, conta_nas_medias = false
 where lower(trim(email)) = 'lufreire@igreenenergy.com.br';

-- Registro de cada fechamento retirado, depois a retirada.
insert into public.fechamento_alteracoes
  (fechamento_id, pessoa_id, pessoa_nome, mes_competencia, campo, valor_anterior, valor_novo, motivo, autor_nome)
select f.id, f.pessoa_id, f.pessoa_nome, f.mes_competencia, 'retirada', f.resultado::text, null,
       'Cargo Diretora, sem cota, desde sempre (decisão do gestor, 20/10/2026 · migração 71).', 'sistema'
  from public.fechamentos_cota f
  join public.pessoas p on p.id = f.pessoa_id
 where lower(trim(p.email)) = 'lufreire@igreenenergy.com.br'
   and not exists (select 1 from public.fechamento_alteracoes a where a.fechamento_id = f.id and a.campo = 'retirada');

delete from public.fechamentos_cota f
 using public.pessoas p
 where p.id = f.pessoa_id and lower(trim(p.email)) = 'lufreire@igreenenergy.com.br';

-- ---------------------------------------------------------------------------
-- 3. Realocação de lançamentos
-- ---------------------------------------------------------------------------
-- "Manter sem cota": fica como volume da equipe, sem pontuar, e sai da lista.
alter table public.volume_semanal add column if not exists sem_cota_ok boolean not null default false;
alter table public.lancamentos    add column if not exists sem_cota_ok boolean not null default false;

create table if not exists public.realocacoes (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('volume', 'lancamento')),
  acao        text not null check (acao in ('mover', 'manter', 'apagar')),
  registro    jsonb not null,           -- a linha como estava
  de_pessoa   uuid references public.pessoas (id) on delete set null,
  para_pessoa uuid references public.pessoas (id) on delete set null,
  feito_por   uuid references public.pessoas (id) on delete set null,
  feito_em    timestamptz not null default now()
);
alter table public.realocacoes enable row level security;
drop policy if exists realocacoes_leitura on public.realocacoes;
create policy realocacoes_leitura on public.realocacoes for select using (public.eh_gestor());

create or replace function public.mes_fechado(p_mes date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fechamentos_cota where mes_competencia = p_mes);
$$;

-- O que está no mês aberto sem pontuar para ninguém.
create or replace view public.vw_lancamentos_pendentes with (security_invoker = true) as
  select 'volume'::text as tipo, v.id, v.pessoa_id, p.nome as pessoa, v.mes_competencia, v.semana, v.canal,
         null::text as regra, null::text as rotulo, v.finalizados::numeric as quantidade, v.tme_seg,
         case when exists (select 1 from public.cargos_da_pessoa cp where cp.pessoa_id = v.pessoa_id and cp.desde <= v.mes_competencia)
              then 'cargo sem cota' else 'sem cargo no mês' end as motivo
    from public.volume_semanal v
    join public.pessoas p on p.id = v.pessoa_id
   where not v.sem_cota_ok
     and not public.mes_fechado(v.mes_competencia)
     and public.cargo_na_competencia(v.pessoa_id, v.mes_competencia) is null
  union all
  select 'lancamento', l.id, l.pessoa_id, p.nome, l.mes_competencia, l.semana, l.canal,
         l.regra, r.rotulo, l.quantidade, null,
         case when exists (select 1 from public.cargos_da_pessoa cp where cp.pessoa_id = l.pessoa_id and cp.desde <= l.mes_competencia)
              then 'cargo sem cota' else 'sem cargo no mês' end
    from public.lancamentos l
    join public.pessoas p on p.id = l.pessoa_id
    left join public.regras r on r.chave = l.regra
   where not l.sem_cota_ok
     and not public.mes_fechado(l.mes_competencia)
     and public.cargo_na_competencia(l.pessoa_id, l.mes_competencia) is null;

-- Passa o volume de uma semana para outra pessoa. Se ela já tiver volume na
-- mesma semana e canal, soma finalizados, transferidos e fila; os tempos ficam
-- pela média ponderada pelos finalizados.
create or replace function public.mover_volume(p_id bigint, p_pessoa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.volume_semanal;
  d public.volume_semanal;
  total integer;
begin
  if public.eh_gestor() is not true then raise exception 'Só o gestor move lançamentos.'; end if;
  select * into v from public.volume_semanal where id = p_id;
  if v.id is null then raise exception 'Volume não encontrado (talvez já movido).'; end if;
  if public.mes_fechado(v.mes_competencia) then raise exception 'Mês fechado: o volume não muda mais.'; end if;
  if v.pessoa_id = p_pessoa then raise exception 'Escolha outra pessoa.'; end if;
  if not exists (select 1 from public.pessoas where id = p_pessoa) then raise exception 'Pessoa não encontrada.'; end if;

  insert into public.realocacoes (tipo, acao, registro, de_pessoa, para_pessoa, feito_por)
  values ('volume', 'mover', to_jsonb(v), v.pessoa_id, p_pessoa, public.pessoa_atual());

  select * into d from public.volume_semanal
   where pessoa_id = p_pessoa and mes_competencia = v.mes_competencia and semana = v.semana and canal = v.canal;
  if d.id is null then
    update public.volume_semanal set pessoa_id = p_pessoa, sem_cota_ok = false, atualizado_em = now() where id = v.id;
    return jsonb_build_object('somou', false);
  end if;

  total := coalesce(d.finalizados, 0) + coalesce(v.finalizados, 0);
  update public.volume_semanal set
    finalizados   = total,
    transferidos  = case when d.transferidos is null and v.transferidos is null then null
                         else coalesce(d.transferidos, 0) + coalesce(v.transferidos, 0) end,
    enviados_fila = case when d.enviados_fila is null and v.enviados_fila is null then null
                         else coalesce(d.enviados_fila, 0) + coalesce(v.enviados_fila, 0) end,
    tma_seg = case when d.tma_seg is null then v.tma_seg when v.tma_seg is null or total = 0 then d.tma_seg
                   else round((d.tma_seg * d.finalizados + v.tma_seg * v.finalizados)::numeric / total) end,
    tme_seg = case when d.tme_seg is null then v.tme_seg when v.tme_seg is null or total = 0 then d.tme_seg
                   else round((d.tme_seg * d.finalizados + v.tme_seg * v.finalizados)::numeric / total) end,
    atualizado_em = now()
   where id = d.id;
  delete from public.volume_semanal where id = v.id;
  return jsonb_build_object('somou', true);
end;
$$;

create or replace function public.mover_lancamento(p_id bigint, p_pessoa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.lancamentos;
begin
  if public.eh_gestor() is not true then raise exception 'Só o gestor move lançamentos.'; end if;
  select * into l from public.lancamentos where id = p_id;
  if l.id is null then raise exception 'Lançamento não encontrado (talvez já movido).'; end if;
  if public.mes_fechado(l.mes_competencia) then raise exception 'Mês fechado: o lançamento não muda mais.'; end if;
  if l.pessoa_id = p_pessoa then raise exception 'Escolha outra pessoa.'; end if;
  if not exists (select 1 from public.pessoas where id = p_pessoa) then raise exception 'Pessoa não encontrada.'; end if;
  insert into public.realocacoes (tipo, acao, registro, de_pessoa, para_pessoa, feito_por)
  values ('lancamento', 'mover', to_jsonb(l), l.pessoa_id, p_pessoa, public.pessoa_atual());
  update public.lancamentos set pessoa_id = p_pessoa, sem_cota_ok = false where id = l.id;
end;
$$;

-- p_acao: 'manter' (fica, sem pontuar, e sai da lista) ou 'apagar'.
create or replace function public.resolver_pendente(p_tipo text, p_id bigint, p_acao text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_pessoa uuid; v_mes date;
begin
  if public.eh_gestor() is not true then raise exception 'Só o gestor decide pendências.'; end if;
  if p_acao not in ('manter', 'apagar') then raise exception 'Ação inválida.'; end if;
  if p_tipo = 'volume' then
    select to_jsonb(v), v.pessoa_id, v.mes_competencia into r, v_pessoa, v_mes from public.volume_semanal v where v.id = p_id;
  elsif p_tipo = 'lancamento' then
    select to_jsonb(l), l.pessoa_id, l.mes_competencia into r, v_pessoa, v_mes from public.lancamentos l where l.id = p_id;
  else
    raise exception 'Tipo inválido.';
  end if;
  if r is null then raise exception 'Registro não encontrado (talvez já resolvido).'; end if;
  if public.mes_fechado(v_mes) then raise exception 'Mês fechado: nada muda mais.'; end if;

  insert into public.realocacoes (tipo, acao, registro, de_pessoa, feito_por)
  values (p_tipo, p_acao, r, v_pessoa, public.pessoa_atual());

  if p_tipo = 'volume' then
    if p_acao = 'manter' then update public.volume_semanal set sem_cota_ok = true where id = p_id;
    else delete from public.volume_semanal where id = p_id; end if;
  else
    if p_acao = 'manter' then update public.lancamentos set sem_cota_ok = true where id = p_id;
    else delete from public.lancamentos where id = p_id; end if;
  end if;
end;
$$;

revoke all on function public.mover_volume(bigint, uuid) from public, anon;
revoke all on function public.mover_lancamento(bigint, uuid) from public, anon;
revoke all on function public.resolver_pendente(text, bigint, text) from public, anon;
grant execute on function public.mover_volume(bigint, uuid) to authenticated;
grant execute on function public.mover_lancamento(bigint, uuid) to authenticated;
grant execute on function public.resolver_pendente(text, bigint, text) to authenticated;

-- O resumo do mês aberto refeito com o cargo sem cota.
select public.atualizar_resumo(true);

-- ---------------------------------------------------------------------------
-- Conferência: o que saiu dos fechamentos, o cargo dela e o que está pendente
-- ---------------------------------------------------------------------------
select 'fechamento retirado' as o_que, to_char(mes_competencia, 'MM/YYYY') as mes, valor_anterior as pontos
  from public.fechamento_alteracoes where campo = 'retirada'
union all
select 'cargo da Luciana', to_char(cp.desde, 'MM/YYYY'), c.nome || case when c.recebe_cota then '' else ' (sem cota)' end
  from public.cargos_da_pessoa cp join public.cargos c on c.id = cp.cargo_id
  join public.pessoas p on p.id = cp.pessoa_id
 where lower(trim(p.email)) = 'lufreire@igreenenergy.com.br'
union all
select 'pendentes no mês aberto', null, count(*)::text from public.vw_lancamentos_pendentes;
