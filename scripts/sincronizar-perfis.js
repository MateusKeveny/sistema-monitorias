/**
 * Cria o perfil de quem já existia em Authentication antes do sistema.
 *
 *   npm run perfis
 *
 * O trigger do banco só cria perfil para cadastros novos; este script cobre os
 * antigos. Todos nascem como 'operador' SEM vínculo — ou seja, entram e não
 * veem monitoria nenhuma até alguém definir o papel na tela Configurações.
 * Quem já tem perfil não é alterado: o script nunca rebaixa ninguém.
 */
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !CHAVE) {
  console.error('Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em .env.local');
  process.exit(1);
}

const db = createClient(URL, CHAVE, { auth: { persistSession: false } });

/** "joaovitor.honorato@empresa.com.br" -> "Joaovitor Honorato" */
function nomeApartirDoEmail(email) {
  return (email || '').split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

(async () => {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) { console.error('Erro ao listar usuários:', error.message); process.exit(1); }

  const { data: existentes } = await db.from('perfis').select('id');
  const jaTem = new Set((existentes ?? []).map((p) => p.id));

  const novos = data.users
    .filter((u) => u.email && !jaTem.has(u.id))
    .map((u) => ({
      id: u.id,
      nome: u.user_metadata?.nome || nomeApartirDoEmail(u.email),
      email: u.email,
      papel: 'operador',
      ativo: true,
    }));

  if (!novos.length) {
    console.log(`Nada a fazer: os ${jaTem.size} usuários já têm perfil.`);
    return;
  }

  const { error: erroInsercao } = await db.from('perfis').insert(novos);
  if (erroInsercao) { console.error('Erro ao criar perfis:', erroInsercao.message); process.exit(1); }

  console.log(`${novos.length} perfil(is) criado(s), todos como 'operador' sem vínculo:`);
  for (const p of novos) console.log('  ', p.email.padEnd(40), '->', p.nome);
  console.log('\nDefina os papéis e os vínculos na tela Configurações do sistema.');
})();
