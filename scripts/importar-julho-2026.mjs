/**
 * Importa o histórico de monitorias de julho/2026 para o sistema.
 *
 *   node --env-file=.env.local scripts/importar-julho-2026.mjs           (ensaio)
 *   node --env-file=.env.local scripts/importar-julho-2026.mjs --gravar  (grava)
 *
 * Sem `--gravar` nada toca o banco: o script só mostra o que faria.
 *
 * ----------------------------------------------------------------------------
 * De onde vem cada coisa
 *
 * A planilha tem duas abas com a mesma informação em formatos diferentes.
 * "Base Detalhada" é transposta — cada monitoria é uma COLUNA, e as linhas são
 * os campos, com os 19 critérios nas linhas 8 a 26. É a única que tem os
 * critérios, então é ela que manda a lista de monitorias. "Registro de
 * Monitorias" tem uma linha por monitoria e acrescenta canal, tempo e parecer.
 *
 * A junção é pelo protocolo — e o Registro tem protocolos REPETIDOS, com datas
 * diferentes entre as cópias. Por isso a data dele não é confiável sozinha.
 * ----------------------------------------------------------------------------
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import mod from './xlsx-lite.js';

const { abrirPlanilha, dataExcel } = mod;
const GRAVAR = process.argv.includes('--gravar');
const ARQUIVO = 'C:/Users/Mateus Keveny/OneDrive - IGREEN ENERGIA COMERCIO E SERVICO S.A/'
  + 'Cotas/2026/Julho/Monitorias - Julho 2026.xlsx';

/** Início e fim do ciclo de competência de julho/2026 (26 a 25). */
const CICLO = { de: '2026-06-26', ate: '2026-07-25' };

/**
 * Correções de data, cada uma com a evidência que a sustenta.
 *
 * Nenhuma é palpite: ou a data está escrita em outro lugar do arquivo, ou os
 * protocolos vizinhos — que são sequenciais no Huggy — cercam a data pelos dois
 * lados com o mesmo valor.
 */
const CORRIGE_DATA = {
  // Mês digitado errado: trocar junho por julho encaixa a monitoria exatamente
  // na semana que a própria planilha declara.
  '489390766': ['2026-07-03', 'mês corrigido de 06 para 07'],
  '490358617': ['2026-07-06', 'mês corrigido de 06 para 07'],
  '490748366': ['2026-07-07', 'mês corrigido de 06 para 07'],
  '489023048': ['2026-07-23', 'mês corrigido de 06 para 07'],
  // Vizinhos pelo número do protocolo, concordando dos dois lados.
  '491424327': ['2026-07-08', 'protocolos vizinhos 490842778 e 491436018, ambos 08/07'],
  '491564495': ['2026-07-09', 'protocolos vizinhos 491537586 e 491566540, ambos 09/07'],
  '492069372': ['2026-07-09', 'protocolos vizinhos 492036220 e 492104229, ambos 09/07'],
  '495992559': ['2026-07-20', 'protocolos vizinhos 495979297 e 496026206, ambos 20/07'],
  '496066952': ['2026-07-20', 'protocolos vizinhos 496059049 e 496276834, ambos 20/07'],
};

/** Nome do critério escrito errado na planilha. */
const APELIDOS = { 'atendimento objective': 'atendimento objetivo' };

/** Fora do cadastro; combinado com o gestor que fica de fora da importação. */
const IGNORAR = ['emanuelly vieira'];

// ---------------------------------------------------------------- utilidades

const norm = (s) => String(s ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

const letra = (n) => {
  let s = '', x = n;
  while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); }
  return s;
};

/** Data de célula: aceita número de série do Excel e texto dd/mm/aaaa. */
const dataDaCelula = (v) => {
  if (typeof v === 'number') return dataExcel(v);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const [, d, mes, ano] = m;
  if (+mes < 1 || +mes > 12 || +d < 1 || +d > 31) return null;
  return `${ano}-${String(+mes).padStart(2, '0')}-${String(+d).padStart(2, '0')}`;
};

/**
 * A data escrita dentro do protocolo, quando ele tem 12 dígitos.
 *
 * O Huggy numera esses no formato AAMMDD + sequencial: 260717593634 é
 * 17/07/2026. É a fonte mais confiável do arquivo — confere com as duas abas
 * em 15 dos 18 casos, e nos 3 restantes são as abas que estão erradas.
 */
const dataDoProtocolo = (protocolo) => {
  if (!/^\d{12}$/.test(protocolo)) return null;
  const iso = `20${protocolo.slice(0, 2)}-${protocolo.slice(2, 4)}-${protocolo.slice(4, 6)}`;
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || iso.slice(0, 10) !== d.toISOString().slice(0, 10)) return null;
  return iso;
};

/** "1h 51min 13s" -> segundos. */
const tempoEmSegundos = (txt) => {
  const s = String(txt ?? '');
  const h = /(\d+)\s*h/.exec(s), m = /(\d+)\s*min/.exec(s), seg = /(\d+)\s*s(?!\w)/.exec(s);
  if (!h && !m && !seg) return null;
  return (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0) + (seg ? +seg[1] : 0);
};

const competencia = (d) => {
  let [a, m, dia] = d.split('-').map(Number);
  if (dia >= 26) { m++; if (m === 13) { m = 1; a++; } }
  return `${a}-${String(m).padStart(2, '0')}-01`;
};

const br = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');

// ------------------------------------------------------------------- leitura

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const [{ data: criterios }, { data: pessoas }, { data: canais }] = await Promise.all([
  db.from('criterios').select('id, nome, peso, ordem').order('ordem'),
  db.from('pessoas').select('id, nome'),
  db.from('canais').select('id, nome'),
]);

const criterioPorNome = new Map(criterios.map((c) => [norm(c.nome), c]));
const acharCriterio = (nome) => criterioPorNome.get(APELIDOS[norm(nome)] ?? norm(nome));
const acharPessoa = (nome) => pessoas.find((p) => norm(p.nome) === norm(nome));
const acharCanal = (nome) => canais.find((c) => norm(c.nome) === norm(nome));

const abas = abrirPlanilha(ARQUIVO);
const det = abas.get('Base Detalhada');
const reg = abas.get('Registro de Monitorias');

// Registro indexado por protocolo. Guarda a PRIMEIRA ocorrência: há protocolos
// repetidos, e as cópias divergem na data — mas canal, tempo e parecer são
// consistentes entre elas.
const registro = new Map();
for (let l = 4; l <= 400; l++) {
  const p = reg.get('A' + l);
  if (p === undefined) continue;
  const chave = String(p);
  if (registro.has(chave)) continue;
  registro.set(chave, {
    data: dataDaCelula(reg.get('B' + l)),
    canal: reg.get('F' + l),
    tempo: reg.get('G' + l),
    parecer: reg.get('J' + l),
  });
}

// Critérios da planilha, nas linhas 8 a 26.
const linhasCriterio = [];
for (let l = 8; l <= 26; l++) {
  const nome = det.get('A' + l);
  if (!nome) continue;
  const c = acharCriterio(nome);
  if (!c) throw new Error(`Critério da planilha sem correspondente no banco: "${nome}"`);
  linhasCriterio.push({ linha: l, criterio: c });
}

// ----------------------------------------------------------------- montagem

const monitorias = [];
const recusadas = [];

for (let c = 2; c <= 400; c++) {
  const col = letra(c);
  const bruto = det.get(col + '2');
  if (bruto === undefined) continue;

  const protocolo = String(bruto);
  const nomeOperador = String(det.get(col + '1') ?? '').trim();
  if (IGNORAR.includes(norm(nomeOperador))) continue;

  const pessoa = acharPessoa(nomeOperador);
  if (!pessoa) { recusadas.push(`${protocolo}: operador "${nomeOperador}" não está no cadastro`); continue; }

  const r = registro.get(protocolo);

  // Ordem de confiança da data.
  let data = null, origemData = '';
  const doProtocolo = dataDoProtocolo(protocolo);
  const corrigida = CORRIGE_DATA[protocolo];
  const daBase = dataDaCelula(det.get(col + '3'));
  const doRegistro = r?.data ?? null;
  const noCiclo = (d) => d && d >= CICLO.de && d <= CICLO.ate;

  if (doProtocolo) { data = doProtocolo; origemData = 'data escrita no protocolo'; }
  else if (corrigida) { [data, origemData] = corrigida; }
  else if (noCiclo(doRegistro)) { data = doRegistro; origemData = 'aba Registro'; }
  else if (noCiclo(daBase)) { data = daBase; origemData = 'aba Base Detalhada'; }
  else { data = doRegistro ?? daBase; origemData = 'aba Registro'; }

  if (!data) { recusadas.push(`${protocolo}: sem data legível em nenhuma fonte`); continue; }

  const zerado = norm(det.get(col + '7')) === 'sim';

  const itens = linhasCriterio.map(({ linha, criterio }) => ({
    criterio,
    // Qualquer coisa que não seja "não" conta como atendido. A grade tem um
    // "não" minúsculo, e comparar com sensibilidade a maiúsculas o leria como
    // "Sim" — invertendo a resposta e a nota.
    conforme: norm(det.get(col + linha)) !== 'nao',
  }));

  const perdido = itens.filter((i) => !i.conforme)
    .reduce((s, i) => s + Number(i.criterio.peso), 0);

  monitorias.push({
    protocolo,
    operador: nomeOperador,
    semanaDeclarada: Number(String(det.get(col + '4') ?? '').replace(/\D/g, '')) || null,
    pessoa_id: pessoa.id,
    data,
    origemData,
    ajustada: origemData !== 'aba Registro' && origemData !== 'data escrita no protocolo',
    competencia: competencia(data),
    zerado,
    canal_id: acharCanal(r?.canal ?? 'Huggy')?.id ?? null,
    tempo_seg: tempoEmSegundos(r?.tempo),
    parecer: r?.parecer ? String(r.parecer).trim() : null,
    notaPlanilha: Number(det.get(col + '6')),
    notaCalculada: zerado ? 0 : Math.max(0, Number((1 - perdido).toFixed(4))),
    itens,
  });
}

/**
 * Renumera dentro de cada operador, competência e semana.
 *
 * A planilha repete o mesmo número para atendimentos diferentes — o Bruno tem
 * sete monitorias numa semana só. Como o banco exige a combinação única de
 * operador, competência, semana e número, a numeração é refeita pela ordem em
 * que os atendimentos aconteceram. Nenhum registro se perde.
 */
const semanaDoCiclo = (d) => {
  const dia = +d.slice(8, 10);
  if (dia >= 26 || dia <= 2) return 1;
  if (dia <= 10) return 2;
  if (dia <= 18) return 3;
  return 4;
};

const grupos = new Map();
for (const m of monitorias) {
  m.semana = semanaDoCiclo(m.data);
  const k = `${m.pessoa_id}|${m.competencia}|${m.semana}`;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push(m);
}
for (const g of grupos.values()) {
  g.sort((a, b) => a.data.localeCompare(b.data) || a.protocolo.localeCompare(b.protocolo));
  g.forEach((m, i) => { m.numero = i + 1; });
}

// ------------------------------------------------------------------ relatório

console.log('=== IMPORTAÇÃO DE MONITORIAS — JULHO/2026 ===\n');
console.log(GRAVAR ? 'MODO: GRAVANDO NO BANCO\n' : 'MODO: ENSAIO (nada é gravado)\n');

console.log('monitorias a importar:', monitorias.length);
console.log('recusadas:', recusadas.length);
for (const r of recusadas) console.log('   ' + r);

const divergentes = monitorias.filter((m) => Math.abs(m.notaCalculada - m.notaPlanilha) > 0.0001);
console.log('\nnota calculada confere com a da planilha:',
  monitorias.length - divergentes.length, 'de', monitorias.length);
for (const d of divergentes) {
  console.log(`   ${d.protocolo} ${d.operador}: planilha ${(d.notaPlanilha * 100).toFixed(0)}%`
    + ` calculada ${(d.notaCalculada * 100).toFixed(0)}%`);
}

const porComp = {};
for (const m of monitorias) porComp[m.competencia] = (porComp[m.competencia] ?? 0) + 1;
console.log('\ncompetência:');
for (const [k, v] of Object.entries(porComp).sort()) console.log('   ' + k.slice(0, 7) + ': ' + v);

const ajustadas = monitorias.filter((m) => m.ajustada);
console.log('\ndatas ajustadas:', ajustadas.length);
for (const a of ajustadas) {
  console.log(`   ${a.protocolo} ${a.operador.padEnd(18)} -> ${br(a.data)}  (${a.origemData})`);
}

/*
 * A semana passa a sair da data, e não do rótulo da planilha.
 *
 * Isso muda a leitura histórica em parte dos registros — o arquivo tem cerca de
 * 38% de linhas cuja data contradiz a semana escrita ao lado dela. Não é efeito
 * da importação: é a inconsistência que já existia, ficando visível.
 */
const mudouSemana = monitorias.filter((m) => m.semanaDeclarada && m.semana !== m.semanaDeclarada);
console.log('\nsemana diferente da declarada na planilha:', mudouSemana.length, 'de', monitorias.length);
const porMudanca = {};
for (const m of mudouSemana) {
  const k = `${m.semanaDeclarada}ª -> ${m.semana}ª`;
  porMudanca[k] = (porMudanca[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(porMudanca).sort()) console.log('   ' + k + ': ' + v);

const renumeradas = [...grupos.values()].filter((g) => g.length > 4).length;
console.log('\ngrupos operador/semana com mais de 4 monitorias:', renumeradas);
for (const g of [...grupos.values()].filter((x) => x.length > 4)) {
  console.log(`   ${g[0].operador}, ${g[0].competencia.slice(0, 7)}, ${g[0].semana}ª semana: ${g.length}`);
}

/**
 * O plano é congelado em arquivo no ensaio e conferido na gravação.
 *
 * Entre aprovar e gravar pode passar um dia, e nesse intervalo a equipe segue
 * lançando monitorias. Isso muda a numeração dentro da semana e, portanto, o
 * que seria gravado. Sem esta trava, o que entra no banco não seria
 * exatamente o que foi revisado e aprovado.
 */
const PLANO = 'dados/plano-julho-2026.json';
const resumo = monitorias.map((m) => ({
  protocolo: m.protocolo, operador: m.operador, data: m.data, semana: m.semana,
  numero: m.numero, nota: m.notaPlanilha, zerado: m.zerado, origemData: m.origemData,
})).sort((a, b) => a.protocolo.localeCompare(b.protocolo));

if (!GRAVAR) {
  fs.mkdirSync('dados', { recursive: true });
  fs.writeFileSync(PLANO, JSON.stringify({ gerado_em: new Date().toISOString(), linhas: resumo }, null, 1));
  console.log('\nplano congelado em', PLANO);
  console.log('Nada foi gravado. Para gravar, rode de novo com --gravar');
  process.exit(0);
}

if (fs.existsSync(PLANO)) {
  const salvo = JSON.parse(fs.readFileSync(PLANO, 'utf8'));
  const antes = JSON.stringify(salvo.linhas);
  const agora = JSON.stringify(resumo);
  if (antes !== agora) {
    console.error('\n*** O plano mudou desde o ensaio aprovado. ***');
    console.error('Gerado em', salvo.gerado_em, '— linhas antes:', salvo.linhas.length, 'agora:', resumo.length);
    console.error('Provavelmente entraram monitorias novas de julho, o que desloca a numeração.');
    console.error('Rode o ensaio de novo, confira as diferenças, e só então grave.');
    process.exit(1);
  }
  console.log('\nplano confere com o ensaio aprovado em', salvo.gerado_em);
}

// -------------------------------------------------------------------- gravação

console.log('\n--- gravando ---');
let ok = 0;
for (const m of monitorias) {
  const { data: criada, error } = await db.from('monitorias').insert({
    protocolo: m.protocolo,
    data_atendimento: m.data,
    semana_mes: m.semana,
    numero_monitoria: m.numero,
    operador_id: m.pessoa_id,
    canal_id: m.canal_id,
    tempo_atendimento_seg: m.tempo_seg,
    zerado: m.zerado,
    parecer: m.parecer,
    nota_final: m.notaCalculada,
  }).select('id, codigo').single();

  if (error) { console.log(`   ERRO ${m.protocolo} (${m.operador}): ${error.message}`); continue; }

  const { error: erroItens } = await db.from('monitoria_itens').insert(
    m.itens.map((i) => ({ monitoria_id: criada.id, criterio_id: i.criterio.id, conforme: i.conforme })),
  );
  if (erroItens) { console.log(`   ERRO nos critérios de ${m.protocolo}: ${erroItens.message}`); continue; }

  ok++;
}
console.log(`\ngravadas: ${ok} de ${monitorias.length}`);

// Confere o que o banco calculou contra o que a planilha dizia.
const { data: conferencia } = await db.from('monitorias')
  .select('protocolo, nota_final')
  .in('protocolo', monitorias.map((m) => m.protocolo));
const notaBanco = new Map((conferencia ?? []).map((c) => [c.protocolo, Number(c.nota_final)]));
const erradas = monitorias.filter((m) => {
  const n = notaBanco.get(m.protocolo);
  return n !== undefined && Math.abs(n - m.notaPlanilha) > 0.0001;
});
console.log('nota no banco confere com a da planilha:',
  monitorias.length - erradas.length, 'de', monitorias.length);
for (const e of erradas) {
  console.log(`   ${e.protocolo}: banco ${(notaBanco.get(e.protocolo) * 100).toFixed(0)}%`
    + ` planilha ${(e.notaPlanilha * 100).toFixed(0)}%`);
}
