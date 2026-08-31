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
  const [{ data: perfis }, { data: ops }] = await Promise.all([
    db.from('perfis').select('nome, email, papel, operador_id, ativo').order('papel').order('email'),
    db.from('operadores').select('id, nome'),
  ]);
  const nomeDe = new Map((ops ?? []).map((o) => [o.id, o.nome]));
  console.table((perfis ?? []).map((p) => ({
    email: p.email,
    papel: p.papel,
    operador: p.operador_id ? nomeDe.get(p.operador_id) : '—',
    ativo: p.ativo ? 'sim' : 'NÃO',
  })));
}

(async () => {
  if (!email) { await listar(); return; }

  if (!PAPEIS.includes(papel)) {
    console.error(`Papel inválido: "${papel}". Use um de: ${PAPEIS.join(', ')}`);
    process.exit(1);
  }

  const { data: perfil } = await db.from('perfis').select('id, nome').eq('email', email).maybeSingle();
  if (!perfil) {
    console.error(`Não existe perfil para ${email}.`);
    console.error('Crie o usuário no Supabase (Authentication → Users → Add user,');
    console.error('marcando "Auto Confirm User") e rode: npm run perfis');
    process.exit(1);
  }

  const campos = { papel, operador_id: null };

  if (papel === 'operador') {
    if (!operador) {
      console.error('Para operador, informe o nome do cadastro a vincular.');
      console.error('Sem vínculo a pessoa entra e não vê monitoria nenhuma.');
      process.exit(1);
    }
    const { data: o } = await db.from('operadores').select('id').eq('nome', operador).maybeSingle();
    if (!o) { console.error(`Não existe operador chamado "${operador}".`); process.exit(1); }
    campos.operador_id = o.id;
  }

  const { error } = await db.from('perfis').update(campos).eq('id', perfil.id);
  if (error) { console.error('Falhou:', error.message); process.exit(1); }

  console.log(`${email} agora é ${papel}${operador ? ` vinculado a ${operador}` : ''}.\n`);
  await listar();
})();
