/**
 * Chaves da Agenda da Gestão. Os passos, nesta ordem:
 *
 *   node scripts/chaves-da-agenda.js projeto <Project URL> <anon public key>
 *     Grava no .env.local o endereço e a chave pública do projeto Supabase da
 *     agenda (NEXT_PUBLIC_AGENDA_SUPABASE_URL e _ANON_KEY). Entram no build.
 *
 *   node scripts/chaves-da-agenda.js gerar
 *     Cria VAPID_PUBLICA, VAPID_PRIVADA, AGENDA_SEGREDO e PONTE_SEGREDO no
 *     .env.local, se ainda não existirem. Nunca troca chave existente: trocar
 *     a VAPID derruba a inscrição de todos os aparelhos.
 *
 *   node scripts/chaves-da-agenda.js worker
 *     Grava VAPID_PRIVADA, AGENDA_SEGREDO e PONTE_SEGREDO como segredos do
 *     Worker painel-agenda (wrangler secret put … --env agenda).
 *
 *   node scripts/chaves-da-agenda.js sql
 *     Escreve em dados/ (fora do git) os dois inserts de configuração:
 *       agenda-config.sql — para o SQL Editor do projeto da AGENDA;
 *       ponte-config.sql  — para o SQL Editor do projeto dos PAINÉIS.
 *
 * Os segredos não aparecem na tela.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const raiz = path.join(__dirname, '..');
const arquivo = path.join(raiz, '.env.local');
const ENDERECO = 'https://painel-agenda.expansao.workers.dev';
const SEGREDOS_DO_WORKER = ['VAPID_PRIVADA', 'AGENDA_SEGREDO', 'PONTE_SEGREDO'];

const ler = () => {
  const texto = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : '';
  const valores = {};
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(linha.trim());
    if (m) valores[m[1]] = m[2];
  }
  return { texto, valores };
};

/** Acrescenta ou troca linhas NOME=valor no .env.local. */
const gravar = (pares, titulo) => {
  let { texto } = ler();
  const novas = [];
  for (const [nome, valor] of Object.entries(pares)) {
    const re = new RegExp(`^${nome}=.*$`, 'm');
    if (re.test(texto)) texto = texto.replace(re, `${nome}=${valor}`);
    else novas.push(`${nome}=${valor}`);
  }
  if (novas.length) texto += `${texto && !texto.endsWith('\n') ? '\n' : ''}\n# ${titulo}\n${novas.join('\n')}\n`;
  fs.writeFileSync(arquivo, texto);
};

const faltando = (valores, nomes) => {
  const f = nomes.filter((n) => !valores[n]);
  if (f.length) { console.error(`Falta no .env.local: ${f.join(', ')} — rode o passo "gerar".`); process.exit(1); }
};

const passo = process.argv[2];

if (passo === 'projeto') {
  const [url, chave] = process.argv.slice(3);
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url ?? '') || !chave || chave.length < 30) {
    console.error('Uso: node scripts/chaves-da-agenda.js projeto https://<ref>.supabase.co <anon public key>');
    process.exit(1);
  }
  gravar({ NEXT_PUBLIC_AGENDA_SUPABASE_URL: url.replace(/\/$/, ''), NEXT_PUBLIC_AGENDA_SUPABASE_ANON_KEY: chave },
    'Agenda da Gestão — projeto Supabase próprio');
  console.log('Projeto da agenda gravado no .env.local.');
} else if (passo === 'gerar') {
  const { valores } = ler();
  const pares = {};
  if (!valores.VAPID_PUBLICA || !valores.VAPID_PRIVADA) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    pares.VAPID_PUBLICA = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
    pares.VAPID_PRIVADA = jwk.d;
  }
  for (const nome of ['AGENDA_SEGREDO', 'PONTE_SEGREDO']) {
    if (!valores[nome]) pares[nome] = crypto.randomBytes(32).toString('base64url');
  }
  if (!Object.keys(pares).length) console.log('As chaves já existem no .env.local. Nada foi trocado.');
  else {
    gravar(pares, 'Agenda da Gestão (scripts/chaves-da-agenda.js)');
    console.log(`Gravado no .env.local: ${Object.keys(pares).join(', ')}.`);
    if (pares.VAPID_PUBLICA) console.log('A VAPID_PUBLICA nova precisa ir também para wrangler.jsonc (env agenda → vars).');
  }
} else if (passo === 'worker') {
  const { valores } = ler();
  faltando(valores, SEGREDOS_DO_WORKER);
  for (const nome of SEGREDOS_DO_WORKER) {
    console.log(`Gravando ${nome} no Worker painel-agenda…`);
    const r = spawnSync('npx', ['wrangler', 'secret', 'put', nome, '--env', 'agenda'],
      { cwd: raiz, input: valores[nome], stdio: ['pipe', 'inherit', 'inherit'], shell: true });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
} else if (passo === 'sql') {
  const { valores } = ler();
  faltando(valores, ['AGENDA_SEGREDO', 'PONTE_SEGREDO']);
  fs.mkdirSync(path.join(raiz, 'dados'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'dados', 'agenda-config.sql'), `-- Projeto da AGENDA. Não versionar; apague depois de rodar.
insert into public.agenda_config (chave, valor) values
  ('endereco', '${ENDERECO}'),
  ('segredo',  '${valores.AGENDA_SEGREDO}')
on conflict (chave) do update set valor = excluded.valor;
`);
  fs.writeFileSync(path.join(raiz, 'dados', 'ponte-config.sql'), `-- Projeto dos PAINÉIS (Monitorias/Performance). Não versionar; apague depois de rodar.
insert into public.agenda_ponte (chave, valor) values ('segredo', '${valores.PONTE_SEGREDO}')
on conflict (chave) do update set valor = excluded.valor;
`);
  console.log('Escritos dados/agenda-config.sql (projeto da agenda) e dados/ponte-config.sql (projeto dos painéis).');
} else {
  console.log('Uso: node scripts/chaves-da-agenda.js projeto <url> <anon> | gerar | worker | sql');
}
