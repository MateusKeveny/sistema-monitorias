-- 109 · Nome do setor no Hub (Performance 4.8.1)
--
-- O relatório do Hub (planilhas LAB/HELP) traz a equipe na coluna "Setor" e a
-- fila na coluna "Fila". No Expansão o Setor já é o nome de uma fila
-- ("Expansao", "Diretores-Expansao", "iGreen Mob"); no Telecom vem "Telecom".
-- A 4.7.1 reconhece o setor por uma palavra do nome dele ("Telecom" em
-- "Conexão Telecom"). Um setor novo cujo nome no Hub não tenha relação com o
-- nome do sistema teria as linhas descartadas como "de outra equipe".
--
-- Aqui o setor ganha o nome (ou os nomes) com que aparece no Hub, editável em
-- Usuários e setores › Setores e filas e pedido na criação do setor.
-- O Telecom já nasce com "Telecom". Nada mais muda.

alter table public.setores add column if not exists nomes_no_hub text[] not null default '{}';

comment on column public.setores.nomes_no_hub is
  'Como o setor aparece na coluna "Setor" do relatório do Hub (109). A importação reconhece o setor por estes nomes e usa a coluna Fila.';

update public.setores set nomes_no_hub = array['Telecom']
 where id = 10 and nomes_no_hub = '{}';

-- Criar setor copiando o Expansão (clonar_setor) copiava também as faixas de
-- chamados (chamados_sla_f2..f4) e os pesos de chamados dos cargos. Chamados
-- (Elo, SLA, escala) são só do Expansão: o setor novo nascia com uma régua de
-- chamados sem chamado nenhum. Agora a cópia deixa chamados_* de fora.
-- Troca de trecho com guarda, como na 104.
do $$
declare
  t text := pg_get_functiondef('public.clonar_setor(text,smallint,boolean)'::regprocedure);
  n text;
begin
  n := replace(t, 'and ativo and not public.regra_estrutural(chave) loop',
                  'and ativo and not public.regra_estrutural(chave) and chave not like ''chamados\_%'' loop');
  if n = t then raise exception 'clonar_setor: trecho das regras não encontrado'; end if;
  t := n;
  n := replace(t, 'and p.regra not like ''outro_setor_%''',
                  'and p.regra not like ''outro_setor_%'' and p.regra not like ''chamados\_%''');
  if n = t then raise exception 'clonar_setor: trecho dos pesos não encontrado'; end if;
  execute n;
end $$;
