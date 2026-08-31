/**
 * Lê o "Dashboard Monitorias.xlsm" e produz dados/extracao.json,
 * já no formato das tabelas do banco. Uso:
 *   node scripts/extrair-planilha.js "caminho/para/Dashboard Monitorias.xlsm"
 */
const fs = require('node:fs');
const path = require('node:path');
const { abrirPlanilha, dataExcel } = require('./xlsx-lite.js');

const PADRAO = 'C:/Users/Mateus Keveny/OneDrive - IGREEN ENERGIA COMERCIO E SERVICO S.A/Cotas/2026/Dashboard Monitorias.xlsm';
const origem = process.argv[2] || PADRAO;

const abas = abrirPlanilha(origem);
const params = abas.get('Parâmetros');
const registro = abas.get('Registro de Monitorias');
const detalhada = abas.get('Base Detalhada');

const texto = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const simNao = (v) => {
  const t = texto(v);
  if (t === null) return null;
  return /^sim$/i.test(t) ? true : /^n[ãa]o$/i.test(t) ? false : null;
};

// ---------- Parâmetros: critérios com peso, canais, semanas, operadores ----------
const criterios = [];
for (let linha = 2; linha <= 200; linha++) {
  const nome = texto(params.get('D' + linha));
  const peso = params.get('E' + linha);
  if (!nome || typeof peso !== 'number') continue;
  criterios.push({ ordem: criterios.length + 1, nome, peso: Number(peso.toFixed(4)) });
}

const coletarColuna = (col) => {
  const out = [];
  for (let linha = 2; linha <= 200; linha++) {
    const v = texto(params.get(col + linha));
    if (v && !/^\d+$/.test(v)) out.push(v);
  }
  return out;
};
const canais = coletarColuna('C');
const semanas = coletarColuna('F');
const operadores = coletarColuna('G');

// ---------- Registro de Monitorias (aba 2): uma monitoria por linha ----------
const COLS = {
  protocolo: 'A', data: 'B', semana: 'C', numero: 'D', operador: 'E',
  canal: 'F', tempo: 'G', nota: 'H', zerado: 'I', parecer: 'J',
};
const monitorias = [];
for (let linha = 4; linha <= 5000; linha++) {
  const protocolo = registro.get(COLS.protocolo + linha);
  const operador = texto(registro.get(COLS.operador + linha));
  if (protocolo === undefined && !operador) continue;

  monitorias.push({
    protocolo: texto(protocolo),
    data_atendimento: dataExcel(registro.get(COLS.data + linha)),
    semana_mes: texto(registro.get(COLS.semana + linha)),
    numero_monitoria: texto(registro.get(COLS.numero + linha)),
    operador,
    canal: texto(registro.get(COLS.canal + linha)),
    tempo_atendimento: registro.get(COLS.tempo + linha) ?? null,
    nota_final: typeof registro.get(COLS.nota + linha) === 'number'
      ? Number(registro.get(COLS.nota + linha).toFixed(4)) : null,
    zerado: simNao(registro.get(COLS.zerado + linha)) ?? false,
    parecer: texto(registro.get(COLS.parecer + linha)),
    itens: null, // preenchido abaixo quando houver detalhe
    linha_origem: linha,
  });
}

// ---------- Base Detalhada (aba 3): transposta — cada COLUNA é uma monitoria ----------
// Linha 1=Operador, 2=Protocolo, 3=Data, 4=Semana, 5=Nº, 6=Nota, 7=Zerado, 8..26=critérios
const LINHA_CRITERIO_INICIAL = 8;
const letrasColuna = (i) => {
  let s = '', n = i;
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
};

const detalhes = [];
for (let i = 1; i < 200; i++) {          // começa em B (índice 1); A são os rótulos
  const col = letrasColuna(i);
  const operador = texto(detalhada.get(col + '1'));
  const protocolo = texto(detalhada.get(col + '2'));
  if (!operador && !protocolo) continue;

  const itens = criterios.map((c, idx) => ({
    criterio: c.nome,
    ordem: c.ordem,
    conforme: simNao(detalhada.get(col + (LINHA_CRITERIO_INICIAL + idx))),
  }));

  detalhes.push({
    operador,
    protocolo,
    data_atendimento: dataExcel(detalhada.get(col + '3')),
    semana_mes: texto(detalhada.get(col + '4')),
    numero_monitoria: texto(detalhada.get(col + '5')),
    nota_final: typeof detalhada.get(col + '6') === 'number'
      ? Number(detalhada.get(col + '6').toFixed(4)) : null,
    zerado: simNao(detalhada.get(col + '7')) ?? false,
    itens,
    coluna_origem: col,
  });
}

// ---------- Casa o detalhe com a monitoria pela chave semana+nº+operador+protocolo ----------
const chave = (m) => [m.protocolo, m.operador, m.semana_mes, m.numero_monitoria].join('|');
const porChave = new Map();
for (const m of monitorias) {
  if (!porChave.has(chave(m))) porChave.set(chave(m), m);
}
let casados = 0, orfaos = 0;
for (const d of detalhes) {
  const alvo = porChave.get(chave(d));
  if (alvo && !alvo.itens) { alvo.itens = d.itens; casados++; }
  else if (!alvo) orfaos++;
}

// ---------- Recalcula a nota pelos pesos e compara com o Excel ----------
const pesoPorNome = new Map(criterios.map((c) => [c.nome, c.peso]));
const divergencias = [];
for (const m of monitorias) {
  if (!m.itens) continue;
  const perdido = m.itens.reduce(
    (soma, it) => soma + (it.conforme === false ? (pesoPorNome.get(it.criterio) ?? 0) : 0), 0);
  const calculada = m.zerado ? 0 : Number((1 - perdido).toFixed(4));
  m.nota_recalculada = calculada;
  if (m.nota_final !== null && Math.abs(calculada - m.nota_final) > 0.0051) {
    divergencias.push({ protocolo: m.protocolo, operador: m.operador,
      nota_excel: m.nota_final, nota_recalculada: calculada });
  }
}

const somaPesos = Number(criterios.reduce((s, c) => s + c.peso, 0).toFixed(4));
const saida = {
  gerado_em: new Date().toISOString(),
  origem: path.basename(origem),
  parametros: { criterios, canais, semanas, operadores, soma_pesos: somaPesos },
  monitorias,
  resumo: {
    total_monitorias: monitorias.length,
    com_detalhe_de_criterios: monitorias.filter((m) => m.itens).length,
    detalhes_na_planilha: detalhes.length,
    detalhes_casados: casados,
    detalhes_sem_registro: orfaos,
    divergencias_de_nota: divergencias,
  },
};

fs.mkdirSync(path.join(__dirname, '..', 'dados'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dados', 'extracao.json'),
  JSON.stringify(saida, null, 2), 'utf8');

console.log('Extração concluída -> dados/extracao.json');
console.log('  critérios:', criterios.length, '| soma dos pesos:', somaPesos);
console.log('  canais:', canais.join(', '));
console.log('  operadores:', operadores.length);
console.log('  monitorias:', monitorias.length,
  '| com detalhe:', saida.resumo.com_detalhe_de_criterios);
console.log('  detalhes na aba 3:', detalhes.length,
  '| casados:', casados, '| órfãos:', orfaos);
console.log('  divergências de nota:', divergencias.length);
if (divergencias.length) console.table(divergencias.slice(0, 15));
