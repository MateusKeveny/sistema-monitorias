-- ============================================================================
-- 85 · Setores e filas em árvore — etapa 3, parte 3 (fila nova recebe dados)
--
-- Com o cálculo lendo a fila (84), falta deixar uma fila nova existir de
-- verdade:
--
--   1. Toda fila ganha um apelido — o texto que volume, lançamentos e
--      avaliações gravam. As duas de hoje continuam 'huggy' e 'diretores';
--      fila nova ganha 'fila_<id>' sozinha.
--   2. As travas que só aceitavam 'huggy' ou 'diretores' viram "tem de ser
--      uma fila da árvore" (chave estrangeira para o apelido).
--   3. `definir_regras_da_fila`: como a fila nova pontua —
--        copiando de outra fila: usa AS MESMAS regras da original, então
--          acompanha qualquer mudança de peso feita lá;
--        próprias: ganha regras novas (finalizado e, se pedir, as faixas de
--          TME), com peso zero, para o gestor preencher.
--      C-SAT e notas seguem as da equipe (as mesmas das outras filas).
--
-- Nenhum ponto muda: só fila nova é afetada, e hoje não há nenhuma.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

begin;

-- 1. O apelido.
alter table public.canais_do_setor drop constraint if exists canais_do_setor_apelido_check;
alter table public.canais_do_setor drop constraint if exists canais_do_setor_apelido_formato;
alter table public.canais_do_setor add constraint canais_do_setor_apelido_formato
  check (apelido ~ '^[a-z][a-z0-9_]{1,29}$');

-- De qual fila esta copiou as métricas (só para mostrar "acompanha a X").
alter table public.canais_do_setor add column if not exists copia_de smallint
  references public.canais_do_setor (id) on delete restrict;

create or replace function public.apelido_da_fila_nova()
returns trigger language plpgsql as $$
begin
  if new.apelido is null then new.apelido := 'fila_' || new.id; end if;
  return new;
end;
$$;
drop trigger if exists apelido_da_fila_nova on public.canais_do_setor;
create trigger apelido_da_fila_nova before insert or update on public.canais_do_setor
  for each row execute function public.apelido_da_fila_nova();

update public.canais_do_setor set apelido = 'fila_' || id where apelido is null;

-- 2. As travas: de "huggy ou diretores" para "uma fila da árvore".
alter table public.volume_semanal       drop constraint if exists volume_semanal_canal_valido;
alter table public.lancamentos          drop constraint if exists lancamentos_canal_valido;
alter table public.avaliacoes           drop constraint if exists avaliacoes_origem_check;
alter table public.avaliacoes_guardadas drop constraint if exists avaliacoes_guardadas_origem_check;
alter table public.metricas_desligadas  drop constraint if exists metricas_desligadas_canal_check;

alter table public.volume_semanal       drop constraint if exists volume_semanal_fila;
alter table public.lancamentos          drop constraint if exists lancamentos_fila;
alter table public.avaliacoes           drop constraint if exists avaliacoes_fila;
alter table public.avaliacoes_guardadas drop constraint if exists avaliacoes_guardadas_fila;
alter table public.metricas_desligadas  drop constraint if exists metricas_desligadas_fila;

alter table public.volume_semanal       add constraint volume_semanal_fila
  foreign key (canal)  references public.canais_do_setor (apelido) on delete restrict;
alter table public.lancamentos          add constraint lancamentos_fila
  foreign key (canal)  references public.canais_do_setor (apelido) on delete restrict;
alter table public.avaliacoes           add constraint avaliacoes_fila
  foreign key (origem) references public.canais_do_setor (apelido) on delete restrict;
alter table public.avaliacoes_guardadas add constraint avaliacoes_guardadas_fila
  foreign key (origem) references public.canais_do_setor (apelido) on delete restrict;
alter table public.metricas_desligadas  add constraint metricas_desligadas_fila
  foreign key (canal)  references public.canais_do_setor (apelido) on delete restrict;

-- 3. As regras de uma fila nova.
create or replace function public.definir_regras_da_fila(p_fila smallint, p_copiar_de smallint, p_tme boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_fila public.canais_do_setor;
  v_orig public.canais_do_setor;
  v_final text;
  v_grupo text;
  r public.regras;
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor define as regras de uma fila.';
  end if;
  select * into v_fila from public.canais_do_setor where id = p_fila;
  if v_fila.id is null then raise exception 'Fila não encontrada.'; end if;
  if v_fila.regra_finalizado is not null then
    raise exception 'A fila "%" já tem regras.', v_fila.nome;
  end if;

  if p_copiar_de is not null then
    -- Copiar = apontar para as regras da original: acompanha as mudanças dela.
    select * into v_orig from public.canais_do_setor where id = p_copiar_de;
    if v_orig.regra_finalizado is null then
      raise exception 'A fila de origem não tem regras para copiar.';
    end if;
    update public.canais_do_setor
       set regra_finalizado = v_orig.regra_finalizado,
           grupo_tme  = case when p_tme then v_orig.grupo_tme end,
           grupo_csat = v_orig.grupo_csat,
           grupo_nota = v_orig.grupo_nota,
           copia_de   = v_orig.id
     where id = p_fila;
    return;
  end if;

  -- Próprias: regras novas com peso zero, para os mesmos cargos que pontuam
  -- finalizado na equipe hoje.
  v_final := v_fila.apelido || '_finalizado';
  insert into public.regras (chave, grupo, rotulo, peso, faixa_min, faixa_max, ordem, manual, valor_manual, ativo)
  values (v_final, 'atendimento', 'Finalizado ' || v_fila.nome, 0, null, null, 10 + v_fila.id, false, false, true)
  on conflict (chave) do nothing;
  insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo, motivo_alteracao)
  select distinct p.cargo_id, v_final, 0, true, format('Fila nova "%s"', v_fila.nome)
    from public.pesos_por_cargo p
    join public.regras x on x.chave = p.regra and x.grupo = 'atendimento'
   where p.ativo
  on conflict (cargo_id, regra) do nothing;

  if p_tme then
    -- As faixas de TME da Expansão (até 15 min, até 30, acima), com peso zero.
    v_grupo := 'tme_' || v_fila.apelido;
    for r in select * from public.regras where grupo = 'tme' and ativo order by ordem loop
      insert into public.regras (chave, grupo, rotulo, peso, faixa_min, faixa_max, ordem, manual, valor_manual, ativo)
      values (v_fila.apelido || '_' || r.chave, v_grupo,
              replace(r.rotulo, 'TME Médio Equipe', 'TME ' || v_fila.nome), 0,
              r.faixa_min, r.faixa_max, r.ordem, false, false, true)
      on conflict (chave) do nothing;
      insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo, motivo_alteracao)
      select distinct p.cargo_id, v_fila.apelido || '_' || r.chave, 0, true, format('Fila nova "%s"', v_fila.nome)
        from public.pesos_por_cargo p
        join public.regras x on x.chave = p.regra and x.grupo = 'atendimento'
       where p.ativo
      on conflict (cargo_id, regra) do nothing;
    end loop;
  end if;

  update public.canais_do_setor
     set regra_finalizado = v_final,
         grupo_tme = case when p_tme then v_grupo end,
         copia_de  = null
   where id = p_fila;
end;
$$;
revoke all on function public.definir_regras_da_fila(smallint, smallint, boolean) from public, anon;
grant execute on function public.definir_regras_da_fila(smallint, smallint, boolean) to authenticated;

commit;

-- Conferência: as filas (as duas de hoje sem mudança) e as travas novas.
select id, nome, apelido, regra_finalizado, grupo_tme, grupo_csat, grupo_nota, copia_de
  from public.canais_do_setor order by ordem;
select conrelid::regclass as tabela, conname as trava
  from pg_constraint
 where conname in ('volume_semanal_fila', 'lancamentos_fila', 'avaliacoes_fila',
                   'avaliacoes_guardadas_fila', 'metricas_desligadas_fila')
 order by 1;
