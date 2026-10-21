-- ============================================================================
-- 74 · Avisos no painel (o sino)
--
-- O atendente recebe, no sino do Performance, um aviso quando:
--   · a semana dele é lançada — o primeiro volume da pessoa naquela semana do
--     mês aberto (digitado ou colado do Hub);
--   · o valor do mês sai — o valor encaminhado pelo RH (migração 73).
-- Sem Teams e sem permissão do navegador: é uma lista no próprio site
-- (decisão do gestor, 21/10/2026).
--
-- Cada aviso sai uma vez (chave única): corrigir o volume da semana depois
-- não repete; mudar o valor do RH atualiza o texto do aviso que já existe.
-- Volume importado de planilha (meses antes do sistema) não avisa.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

create table if not exists public.avisos_da_pessoa (
  id         bigint generated always as identity primary key,
  pessoa_id  uuid not null references public.pessoas (id) on delete cascade,
  chave      text not null unique,          -- 'semana/2026-10/3/<pessoa>', 'valor/2026-09/<pessoa>'
  titulo     text not null,
  texto      text,
  link       text,
  criado_em  timestamptz not null default now(),
  lido_em    timestamptz
);
create index if not exists avisos_da_pessoa_idx on public.avisos_da_pessoa (pessoa_id, criado_em desc);

alter table public.avisos_da_pessoa enable row level security;
drop policy if exists avisos_da_pessoa_leitura on public.avisos_da_pessoa;
create policy avisos_da_pessoa_leitura on public.avisos_da_pessoa
  for select using (pessoa_id = public.pessoa_atual());

-- Marca como lidos os avisos de quem está logado.
create or replace function public.marcar_avisos_lidos()
returns void language sql security definer set search_path = public as $$
  update public.avisos_da_pessoa set lido_em = now()
   where pessoa_id = public.pessoa_atual() and lido_em is null;
$$;
revoke all on function public.marcar_avisos_lidos() from public, anon;
grant execute on function public.marcar_avisos_lidos() to authenticated;

-- Semana lançada: o primeiro volume da pessoa na semana.
create or replace function public.aviso_semana_lancada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.importacao_id is not null or public.mes_fechado(new.mes_competencia) then
    return null;
  end if;
  insert into public.avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
  values (new.pessoa_id,
          format('semana/%s/%s/%s', to_char(new.mes_competencia, 'YYYY-MM'), new.semana, new.pessoa_id),
          format('%sª semana de %s lançada', new.semana, public.nome_do_mes(new.mes_competencia)),
          'Seus pontos da semana já estão no extrato.',
          '/cota/extrato?mes=' || to_char(new.mes_competencia, 'YYYY-MM'))
  on conflict (chave) do nothing;
  return null;
end;
$$;
drop trigger if exists aviso_semana_lancada on public.volume_semanal;
create trigger aviso_semana_lancada after insert on public.volume_semanal
  for each row execute function public.aviso_semana_lancada();

-- Valor do mês: o valor encaminhado pelo RH.
create or replace function public.aviso_valor_do_mes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_texto text := 'R$ ' || replace(replace(replace(to_char(new.valor, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.')
                  || ' — valor encaminhado pelo RH.';
begin
  insert into public.avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
  values (new.pessoa_id,
          format('valor/%s/%s', to_char(new.mes_competencia, 'YYYY-MM'), new.pessoa_id),
          format('Valor de %s disponível', public.nome_do_mes(new.mes_competencia)),
          v_texto,
          '/cota/historico')
  on conflict (chave) do update set texto = excluded.texto;
  return null;
end;
$$;
drop trigger if exists aviso_valor_do_mes on public.valores_rh;
create trigger aviso_valor_do_mes after insert or update of valor on public.valores_rh
  for each row execute function public.aviso_valor_do_mes();

-- Os valores do RH já informados (setembro) também avisam: dispara o gatilho
-- uma vez para cada um, sem mudar o valor.
update public.valores_rh set valor = valor
 where not exists (select 1 from public.avisos_da_pessoa a
                    where a.chave = format('valor/%s/%s', to_char(valores_rh.mes_competencia, 'YYYY-MM'), valores_rh.pessoa_id));

-- Conferência
select (select count(*) from pg_trigger where tgname in ('aviso_semana_lancada', 'aviso_valor_do_mes')) as gatilhos,
       (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'avisos_da_pessoa') as tabela;
