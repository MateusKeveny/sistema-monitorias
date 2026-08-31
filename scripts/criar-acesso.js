/**
 * Cria o acesso de uma pessoa, com a senha padrão, e obriga a troca no primeiro
 * login. Substitui a macro de Excel que fazia isso antes.
 *
 *   npm run acesso -- allana.silva@igreenenergy.com.br
 *   npm run acesso -- novo@igreenenergy.com.br "Nome Completo" qualidade
 *   npm run acesso -- --todos          (todas as pessoas cadastradas sem login)
 *
 * A senha padrão vem de SENHA_PADRAO em .env.local — não fica no repositório.
 *
 * Roda na sua máquina, e não no servidor, de propósito: criar conta exige a
 * chave service_role, que ignora toda a segurança do banco. Enquanto ela só
 * existir aqui, um vazamento do site não expõe o banco.
 */
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SENHA = process.env.SENHA_PADRAO;

if (!URL || !CHAVE) {
  console.error('Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em .env.local');
  process.exit(1);
}
if (!SENHA) {
  console.error('Falta SENHA_PADRAO em .env.local.');
  console.error('Acrescente a linha:  SENHA_PADRAO=a-senha-que-voces-usam');
  process.exit(1);
}

const db = createClient(URL, CHAVE, { auth: { persistSession: false } });
const PAPEIS = ['gestor', 'qualidade', 'operador'];

const args = process.argv.slice(2);
const todos = args.includes('--todos');
const [email, nome, papel] = args.filter((a) => a !== '--todos');

if (papel && !PAPEIS.includes(papel)) {
  console.error(`Papel inválido: "${papel}". Use um de: ${PAPEIS.join(', ')}`);
  process.exit(1);
}

/** Cria a conta, liga à pessoa e marca a senha como pendente de troca. */
async function criarAcesso(pessoa, contasPorEmail) {
  const alvo = (pessoa.email || '').toLowerCase();
  if (!alvo) return { estado: 'sem e-mail' };

  let contaId = contasPorEmail.get(alvo);

  if (!contaId) {
    const { data, error } = await db.auth.admin.createUser({
      email: pessoa.email,
      password: SENHA,
      email_confirm: true,               // sem isso a pessoa fica esperando e-mail
      user_metadata: { nome: pessoa.nome },
    });
    if (error) return { estado: 'erro', detalhe: error.message };
    contaId = data.user.id;
  }

  const campos = { auth_id: contaId, senha_definida: false };
  if (papel) campos.papel = papel;

  const { error } = await db.from('pessoas').update(campos).eq('id', pessoa.id);
  if (error) return { estado: 'erro', detalhe: error.message };

  return { estado: contasPorEmail.has(alvo) ? 'já tinha conta, vinculada' : 'conta criada' };
}

(async () => {
  const { data: contas } = await db.auth.admin.listUsers({ perPage: 1000 });
  const contasPorEmail = new Map(
    contas.users.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u.id]));

  let alvos = [];

  if (todos) {
    const { data } = await db.from('pessoas')
      .select('id, nome, email, auth_id').is('auth_id', null).not('email', 'is', null);
    alvos = data ?? [];
    if (!alvos.length) { console.log('Todas as pessoas com e-mail já têm acesso.'); return; }
  } else {
    if (!email) {
      console.error('Informe o e-mail, ou use --todos.');
      process.exit(1);
    }
    const { data } = await db.from('pessoas')
      .select('id, nome, email, auth_id').eq('email', email).maybeSingle();

    if (data) {
      alvos = [data];
    } else {
      if (!nome) {
        console.error(`Não existe pessoa com o e-mail ${email}.`);
        console.error('Para cadastrar junto, informe o nome:');
        console.error(`  npm run acesso -- ${email} "Nome Completo"`);
        process.exit(1);
      }
      const { data: nova, error } = await db.from('pessoas')
        .insert({ nome, email, avaliado: true, ativo: true })
        .select('id, nome, email').single();
      if (error) { console.error('Falhou ao cadastrar:', error.message); process.exit(1); }
      alvos = [nova];
      console.log(`Pessoa "${nome}" cadastrada.`);
    }
  }

  console.log(`Criando acesso para ${alvos.length} pessoa(s), com a senha padrão.\n`);

  for (const pessoa of alvos) {
    const r = await criarAcesso(pessoa, contasPorEmail);
    const marca = r.estado === 'erro' ? 'ERRO' : 'ok  ';
    console.log(`  ${marca} ${pessoa.nome.padEnd(22)} ${r.estado}${r.detalhe ? ' — ' + r.detalhe : ''}`);
  }

  console.log('\nTodas entram com a senha padrão e são obrigadas a trocá-la no primeiro acesso.');
})();
