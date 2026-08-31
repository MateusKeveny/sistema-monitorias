/**
 * Confere se o .env.local está correto e se o banco foi criado direito,
 * antes de tentar importar. Uso:
 *
 *   npm run conferir
 */
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const ok = (t) => console.log('  \x1b[32mOK\x1b[0m   ' + t);
const falha = (t) => console.log('  \x1b[31mFALHA\x1b[0m ' + t);

let erros = 0;

console.log('\nConferindo a configuração...\n');

// -------------------------------------------------------------- variáveis
for (const [nome, valor] of [
  ['NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON],
  ['SUPABASE_URL', process.env.SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', CHAVE],
]) {
  if (!valor || valor.includes('SEU-PROJETO') || valor.startsWith('sua-chave')) {
    falha(`${nome} não preenchida em .env.local`);
    erros++;
  } else {
    ok(`${nome} preenchida`);
  }
}

if (erros) {
  console.log('\nPreencha o .env.local e rode de novo.\n');
  process.exit(1);
}

if (ANON === CHAVE) {
  falha('A anon key e a service_role estão iguais — confira, são chaves diferentes.');
  process.exit(1);
}

// ------------------------------------------------------------------ banco
const db = createClient(URL, CHAVE, { auth: { persistSession: false } });

const TABELAS = ['pessoas', 'canais', 'criterios', 'monitorias', 'monitoria_itens',
  'monitoria_alteracoes', 'solicitacoes_exclusao', 'monitorias_excluidas'];
const VIEWS = ['vw_monitorias', 'vw_ranking_mensal', 'vw_criterios_reprovados',
  'vw_feedback_individual'];

(async () => {
  console.log('\nConferindo o banco...\n');

  for (const nome of [...TABELAS, ...VIEWS]) {
    const { error, count } = await db.from(nome).select('*', { count: 'exact', head: true });
    if (error) {
      falha(`${nome} — ${error.message}`);
      erros++;
    } else if (typeof count !== 'number') {
      // Sem contagem numérica a resposta não veio da tabela de verdade —
      // costuma ser URL errada ou cache de schema desatualizado.
      falha(`${nome} — respondeu sem contagem; a consulta não chegou à tabela`);
      erros++;
    } else {
      ok(`${nome} (${count} registro${count === 1 ? '' : 's'})`);
    }
  }

  if (erros) {
    console.log('\nAlgo não foi criado. Rode supabase/00-instalar-tudo.sql'
      + ' no SQL Editor do Supabase e tente de novo.\n');
    process.exit(1);
  }

  console.log('\nTudo certo. Pode rodar:  npm run importar\n');
})();
