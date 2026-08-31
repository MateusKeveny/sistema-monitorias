/**
 * Define o papel de um usuário, sem precisar abrir o SQL Editor.
 *
 *   npm run papel -- teste@igreenenergy.com.br qualidade
 *   npm run papel -- teste@igreenenergy.com.br operador "Bruno Aguiar"
 *   npm run papel                                    (lista todo mundo)
 *
 * Papéis: gestor | qualidade | operador
 * O terceiro argumento só vale para operador: é o nome do cadastro a vincular.
 */
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !CHAVE) {
  console.error('Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em .env.local');
  process.exit(1);
}

const db = createClient(URL, CHAVE, { auth: { persistSession: false } });
const PAPEIS = ['gestor', 'qualidade', 'operador'];

const [email, papel, operador] = process.argv.slice(2);

async function listar() {
  const { data: pessoas } = await db.from('pessoas')
    .select('nome, email, papel, avaliado, ativo, auth_id').order('papel').order('nome');
  console.table((pessoas ?? []).map((p) => ({
    nome: p.nome,
    email: p.email ?? '—',
    papel: p.auth_id ? p.papel : '(sem login)',
    avaliada: p.avaliado ? 'sim' : '—',
    ativa: p.ativo ? 'sim' : 'NÃO',
  })));
}

(async () => {
  if (!email) { await listar(); return; }

  if (!PAPEIS.includes(papel)) {
    console.error(`Papel inválido: "${papel}". Use um de: ${PAPEIS.join(', ')}`);
    process.exit(1);
  }

  const { data: pessoa } = await db.from('pessoas')
    .select('id, nome, auth_id').eq('email', email).maybeSingle();
  if (!pessoa) {
    console.error(`Não existe pessoa com o e-mail ${email}.`);
    console.error('Cadastre em Configurações > Pessoas, ou crie a conta no Supabase.');
    process.exit(1);
  }

  if (!pessoa.auth_id) {
    console.error(`${pessoa.nome} não tem login: o papel não teria efeito.`);
    console.error('Crie a conta no Supabase com este e-mail — o vínculo é automático.');
    process.exit(1);
  }

  const campos = { papel };

  const { error } = await db.from('pessoas').update(campos).eq('id', pessoa.id);
  if (error) { console.error('Falhou:', error.message); process.exit(1); }

  console.log(`${email} agora é ${papel}.
`);
  await listar();
})();
