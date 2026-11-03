-- ============================================================================
-- Virada da 3.0 · aviso "Conheça as novidades da 3.0" no sino
--
-- Não é migração: só um aviso para cada pessoa ativa com login, rodado logo
-- depois de publicar Performance 3.0.0 / Monitorias 6.0.0. A chave impede
-- repetir (rodar duas vezes não manda dois). Texto diferente para a gestão.
-- ============================================================================

insert into public.avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
select p.id,
       'novidades/3.0/' || p.id,
       'Conheça as novidades da 3.0',
       case when p.papel = 'operador'
         then 'Seu TME agora é seu, o quadro "Para bater a meta" no Início e um visual novo. Veja em "Novidades da 3.0", no rodapé do menu.'
         else 'Setores e filas, Usuários e setores, fechamento em segundo plano, TME por pessoa e monitorias por setor. Veja em "Novidades da 3.0", no rodapé do menu.'
       end,
       '/cota'
  from public.pessoas p
 where p.ativo and p.desligado_em is null and p.auth_id is not null
on conflict (chave) do nothing;

-- Conferência
select count(*) as avisos_da_3 from public.avisos_da_pessoa where chave like 'novidades/3.0/%';
