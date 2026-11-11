-- 105: leitura obrigatória do diário por setor (Performance 4.4.0).
--
-- leituras_do_diario() cobrava a leitura de todo mundo ativo, sem olhar o
-- setor: quando o Conexão Telecom ganhou acessos (10/11/2026), as 7 pessoas
-- dele passaram a contar como "não lido" nos processos do Expansão — no aviso
-- de leitura delas e na pendência do Início do gestor.
--
-- Agora o registro só cobra leitura de quem está, hoje, no mesmo setor em que
-- o autor estava no dia do registro. Autor sem setor (admin): continua valendo
-- para todos, como antes.
--
-- E só cobra de quem é da operação: administrador e diretoria saem, como o
-- gestor já saía (o Admin aparecia como "não lido"; a diretoria nem recebe o
-- aviso de leitura no menu).
--
-- Troca só esses dois trechos da função, por substituição do texto exato, com
-- erro se algum não for encontrado.

do $$
declare
  t text := pg_get_functiondef('public.leituras_do_diario()'::regprocedure);
  n text;
  m text;
begin
  m := replace(t, $a$p.papel <> 'gestor'$a$, $a$p.papel not in ('gestor', 'administrador', 'diretoria')$a$);
  if m = t then raise exception 'leituras_do_diario: trecho do papel não encontrado'; end if;
  t := m;
  n := replace(t,
    'and public.pessoa_ve_diario(p.id, r.tipo, r.pessoa_id);',
    'and public.pessoa_ve_diario(p.id, r.tipo, r.pessoa_id)' || chr(13) || chr(10)
    || '     -- 105: só quem está no setor do autor (autor sem setor: todos).' || chr(13) || chr(10)
    || '     and coalesce(public.setor_na_competencia(r.pessoa_id, r.data) = public.setor_na_competencia(p.id, hoje.d), '
    || 'public.setor_na_competencia(r.pessoa_id, r.data) is null);');
  if n = t then raise exception 'leituras_do_diario: trecho final não encontrado'; end if;
  execute n;
end $$;
