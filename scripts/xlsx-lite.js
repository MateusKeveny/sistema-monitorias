// Leitor mínimo de .xlsx/.xlsm sem dependências externas.
// Usa unzip nativo via zlib (raw deflate) lendo o container ZIP na mão.
const fs = require('node:fs');
const zlib = require('node:zlib');

function lerZip(caminho) {
  const buf = fs.readFileSync(caminho);
  const arquivos = new Map();
  // Localiza o End of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP inválido: EOCD não encontrado');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP inválido: central directory');
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamCom = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + tamNome);

    // Cabeçalho local para descobrir onde os dados começam de fato
    const nomeLocal = buf.readUInt16LE(offsetLocal + 26);
    const extraLocal = buf.readUInt16LE(offsetLocal + 28);
    const inicio = offsetLocal + 30 + nomeLocal + extraLocal;
    const bruto = buf.subarray(inicio, inicio + tamComp);

    arquivos.set(nome, metodo === 0 ? bruto : zlib.inflateRawSync(bruto));
    p += 46 + tamNome + tamExtra + tamCom;
  }
  return arquivos;
}

const decodificar = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

function colunaParaIndice(letras) {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Abre a planilha e devolve { abas: Map<nome, celulas> } onde celulas é Map<"A1", valor>. */
function abrirPlanilha(caminho) {
  const zip = lerZip(caminho);
  const txt = (n) => zip.has(n) ? zip.get(n).toString('utf8') : null;

  // Strings compartilhadas
  const compartilhadas = [];
  const ssXml = txt('xl/sharedStrings.xml');
  if (ssXml) {
    for (const si of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let t = '';
      for (const m of si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += m[1];
      compartilhadas.push(decodificar(t));
    }
  }

  // Nome da aba -> arquivo da planilha
  const rels = new Map();
  for (const m of txt('xl/_rels/workbook.xml.rels').matchAll(/<Relationship([^>]*)\/>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1]), alvo = /Target="([^"]+)"/.exec(m[1]);
    if (id && alvo) rels.set(id[1], alvo[1].replace(/^\/?xl\//, ''));
  }

  const abas = new Map();
  for (const m of txt('xl/workbook.xml').matchAll(/<sheet ([^>]*)\/>/g)) {
    const nome = decodificar(/name="([^"]+)"/.exec(m[1])[1]);
    const rid = /r:id="([^"]+)"/.exec(m[1])[1];
    const xml = txt('xl/' + rels.get(rid));
    if (!xml) continue;

    const celulas = new Map();
    for (const c of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1], attrs = c[2], inner = c[3] || '';
      const tipo = /t="([^"]+)"/.exec(attrs)?.[1];
      if (tipo === 'inlineStr') {
        let t = '';
        for (const m2 of inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += m2[1];
        if (t) celulas.set(ref, decodificar(t));
        continue;
      }
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (!v) continue;
      let valor;
      if (tipo === 's') valor = compartilhadas[+v[1]];
      else if (tipo === 'str' || tipo === 'e') valor = decodificar(v[1]);
      else if (tipo === 'b') valor = v[1] === '1';
      else valor = Number(v[1]);
      if (valor !== undefined && valor !== '') celulas.set(ref, valor);
    }
    abas.set(nome, celulas);
  }
  return abas;
}

/** Converte serial de data do Excel para 'YYYY-MM-DD' (sistema 1900, com o bug de 1900 embutido). */
function dataExcel(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

module.exports = { abrirPlanilha, dataExcel, colunaParaIndice };
