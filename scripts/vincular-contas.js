/**
 * Liga contas do Supabase às pessoas, pelo e-mail.
 *
 *   npm run vincular
 *
 * O gatilho no banco já faz isso quando a conta é criada. Este script cobre o
 * que ficou para trás: contas criadas antes do gatilho existir, ou casos em que
 * a pessoa foi cadastrada depois da conta.
 *
 * Não cria conta nem define senha — isso é feito no painel do Supabase.
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
const nomeApartirDoEmail = (email) => (email || '').split('@')[0]
  .split(/[._-]+/).filter(Boolean)
  .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  .join(' ');

(async () => {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) { console.error('Erro ao listar contas:', error.message); process.exit(1); }

  const { data: pessoas } = await db.from('pessoas').select('id, nome, email, auth_id');
  const porEmail = new Map((pessoas ?? [])
    .filter((p) => p.email)
    .map((p) => [p.email.toLowerCase(), p]));
  const jaVinculadas = new Set((pessoas ?? []).map((p) => p.auth_id).filter(Boolean));

  let vinculadas = 0, criadas = 0;

  for (const conta of data.users) {
    if (!conta.email || jaVinculadas.has(conta.id)) continue;

    const pessoa = porEmail.get(conta.email.toLowerCase());

    if (pessoa) {
      const { error: e } = await db.from('pessoas').update({ auth_id: conta.id }).eq('id', pessoa.id);
      if (e) { console.error(`  ${conta.email}: ${e.message}`); continue; }
      console.log(`  vinculada  ${conta.email.padEnd(40)} -> ${pessoa.nome}`);
      vinculadas++;
    } else {
      // Conta sem pessoa correspondente: entra como não avaliada e sem papel de
      // acesso — o estado seguro, que não enxerga nada até alguém liberar.
      const nome = conta.user_metadata?.nome || nomeApartirDoEmail(conta.email);
      const { error: e } = await db.from('pessoas').insert({
        auth_id: conta.id, nome, email: conta.email, papel: 'operador', avaliado: false,
      });
      if (e) { console.error(`  ${conta.email}: ${e.message}`); continue; }
      console.log(`  criada     ${conta.email.padEnd(40)} -> ${nome}`);
      criadas++;
    }
  }

  console.log();
  console.log(vinculadas || criadas
    ? `${vinculadas} conta(s) vinculada(s), ${criadas} pessoa(s) criada(s).`
    : 'Nada a fazer: todas as contas já estão ligadas a uma pessoa.');
})();
