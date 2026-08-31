-- ============================================================================
-- CORREÇÃO CRÍTICA — rode imediatamente.
--
-- Duas funções de uso interno estavam chamáveis por qualquer um, inclusive sem
-- sessão, pela chave pública que vai no navegador:
--
--   apagar_monitoria(uuid, text)   apaga a monitoria sem verificar permissão.
--                                  A verificação vive em excluir_monitoria e
--                                  aprovar_exclusao, que a chamam — chamá-la
--                                  direto pulava a verificação inteira.
--
--   registrar_alteracao(...)       insere no histórico de alterações. Aberta,
--                                  permitia forjar registros de auditoria.
--
-- Causa: `revoke all ... from public` não basta no Supabase. Ele concede
-- execução aos papéis `anon` e `authenticated` de forma explícita, e revogar
-- de `public` não mexe nessas concessões. É preciso nomeá-los.
-- ============================================================================

revoke all on function public.apagar_monitoria(uuid, text)
  from public, anon, authenticated;

revoke all on function public.registrar_alteracao(uuid, text, text, text)
  from public, anon, authenticated;

-- Confirmação de que o que deve continuar aberto continua aberto. São as três
-- funções que a aplicação chama de fato, e cada uma confere o papel por dentro.
grant execute on function public.excluir_monitoria(uuid, text) to authenticated;
grant execute on function public.aprovar_exclusao(uuid)        to authenticated;
grant execute on function public.recusar_exclusao(uuid, text)  to authenticated;
grant execute on function public.marcar_senha_definida()       to authenticated;
