/**
 * Gerador de .xlsx sem nenhuma dependência externa.
 *
 * Um .xlsx é um ZIP com arquivos XML dentro. Aqui os arquivos entram no ZIP
 * *sem compressão* (método "stored"), o que dispensa zlib — assim o mesmo código
 * roda no Node, no Cloudflare Workers ou em qualquer runtime com TextEncoder.
 * Planilhas de relatório têm poucos milhares de linhas; o ganho de compressão
 * não compensaria amarrar o projeto a um runtime específico.
 */

// ---------------------------------------------------------------------- ZIP

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type Entrada = { nome: string; dados: Uint8Array };

/** Monta um ZIP com entradas não comprimidas. */
function montarZip(entradas: Entrada[]): Uint8Array {
  const codificador = new TextEncoder();
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;

  const escreverU32 = (v: DataView, p: number, n: number) => v.setUint32(p, n >>> 0, true);
  const escreverU16 = (v: DataView, p: number, n: number) => v.setUint16(p, n & 0xffff, true);

  for (const entrada of entradas) {
    const nome = codificador.encode(entrada.nome);
    const crc = crc32(entrada.dados);
    const tamanho = entrada.dados.length;

    const cabecalho = new Uint8Array(30 + nome.length);
    const vc = new DataView(cabecalho.buffer);
    escreverU32(vc, 0, 0x04034b50);   // assinatura do cabeçalho local
    escreverU16(vc, 4, 20);           // versão necessária
    escreverU16(vc, 6, 0x0800);       // nome do arquivo em UTF-8
    escreverU16(vc, 8, 0);            // método: 0 = stored
    escreverU16(vc, 10, 0);           // hora
    escreverU16(vc, 12, 0x2821);      // data fixa (2000-01-01) para saída determinística
    escreverU32(vc, 14, crc);
    escreverU32(vc, 18, tamanho);     // comprimido
    escreverU32(vc, 22, tamanho);     // original
    escreverU16(vc, 26, nome.length);
    escreverU16(vc, 28, 0);           // extra
    cabecalho.set(nome, 30);

    locais.push(cabecalho, entrada.dados);

    const central = new Uint8Array(46 + nome.length);
    const vd = new DataView(central.buffer);
    escreverU32(vd, 0, 0x02014b50);   // assinatura do diretório central
    escreverU16(vd, 4, 20);           // versão que criou
    escreverU16(vd, 6, 20);           // versão necessária
    escreverU16(vd, 8, 0x0800);
    escreverU16(vd, 10, 0);
    escreverU16(vd, 12, 0);
    escreverU16(vd, 14, 0x2821);
    escreverU32(vd, 16, crc);
    escreverU32(vd, 20, tamanho);
    escreverU32(vd, 24, tamanho);
    escreverU16(vd, 28, nome.length);
    escreverU32(vd, 42, deslocamento);
    central.set(nome, 46);
    centrais.push(central);

    deslocamento += cabecalho.length + tamanho;
  }

  const tamanhoCentral = centrais.reduce((s, c) => s + c.length, 0);
  const fim = new Uint8Array(22);
  const vf = new DataView(fim.buffer);
  escreverU32(vf, 0, 0x06054b50);
  escreverU16(vf, 8, entradas.length);
  escreverU16(vf, 10, entradas.length);
  escreverU32(vf, 12, tamanhoCentral);
  escreverU32(vf, 16, deslocamento);

  const partes = [...locais, ...centrais, fim];
  const total = partes.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let p = 0;
  for (const parte of partes) { saida.set(parte, p); p += parte.length; }
  return saida;
}

// --------------------------------------------------------------------- XLSX

const escaparXml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // Caracteres de controle são inválidos em XML e quebram o Excel na abertura.
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

export type Coluna = {
  cabecalho: string;
  chave: string;
  largura?: number;
  /** 'texto' (padrão) | 'numero' | 'percentual' | 'quebra' (texto com quebra de linha) */
  formato?: 'texto' | 'numero' | 'percentual' | 'quebra';
};

export type Aba = {
  nome: string;
  colunas: Coluna[];
  linhas: Record<string, unknown>[];
};

// Índices dos estilos definidos em styles.xml, na ordem em que aparecem lá.
const ESTILO = { padrao: 0, cabecalho: 1, percentual: 2, quebra: 3 } as const;

function letraColuna(indice: number): string {
  let s = '', n = indice;
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}

function montarAba(aba: Aba): string {
  const { colunas, linhas } = aba;
  const ultimaColuna = letraColuna(colunas.length - 1);

  const cols = colunas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura ?? 16}" customWidth="1"/>`)
    .join('');

  const celulasCabecalho = colunas
    .map((c, i) => `<c r="${letraColuna(i)}1" s="${ESTILO.cabecalho}" t="inlineStr">`
      + `<is><t>${escaparXml(c.cabecalho)}</t></is></c>`)
    .join('');

  const corpo = linhas.map((linha, indiceLinha) => {
    const numero = indiceLinha + 2;
    const celulas = colunas.map((coluna, i) => {
      const valor = linha[coluna.chave];
      const ref = `${letraColuna(i)}${numero}`;
      if (valor === null || valor === undefined || valor === '') return '';

      if (coluna.formato === 'percentual' || coluna.formato === 'numero') {
        const n = Number(valor);
        if (!Number.isFinite(n)) return '';
        const estilo = coluna.formato === 'percentual' ? ESTILO.percentual : ESTILO.padrao;
        return `<c r="${ref}" s="${estilo}"><v>${n}</v></c>`;
      }

      const estilo = coluna.formato === 'quebra' ? ESTILO.quebra : ESTILO.padrao;
      return `<c r="${ref}" s="${estilo}" t="inlineStr">`
        + `<is><t xml:space="preserve">${escaparXml(String(valor))}</t></is></c>`;
    }).join('');
    return `<row r="${numero}">${celulas}</row>`;
  }).join('');

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<dimension ref="A1:${ultimaColuna}${Math.max(1, linhas.length + 1)}"/>`
    // Congela a primeira linha para o cabeçalho ficar sempre visível.
    + '<sheetViews><sheetView workbookViewId="0">'
    + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    + '</sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<cols>${cols}</cols>`
    + `<sheetData><row r="1" ht="20" customHeight="1">${celulasCabecalho}</row>${corpo}</sheetData>`
    + `<autoFilter ref="A1:${ultimaColuna}1"/>`
    + '</worksheet>';
}

const ESTILOS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>'
  + '<fonts count="2">'
  + '<font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
  + '</fonts>'
  + '<fills count="3">'
  + '<fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid">'
  + '<fgColor rgb="FF047857"/><bgColor indexed="64"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="1"><border/></borders>'
  + '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
  + '<cellXfs count="4">'
  + '<xf xfId="0"/>'                                                        // 0 padrão
  + '<xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"'
  + ' applyAlignment="1"><alignment vertical="center"/></xf>'               // 1 cabeçalho
  + '<xf xfId="0" numFmtId="164" applyNumberFormat="1"/>'                   // 2 percentual
  + '<xf xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' // 3 quebra
  + '</cellXfs>'
  + '</styleSheet>';

/** Gera a pasta de trabalho .xlsx pronta para download. */
export function gerarXlsx(abas: Aba[]): Uint8Array {
  const codificador = new TextEncoder();
  const arquivo = (nome: string, texto: string): Entrada =>
    ({ nome, dados: codificador.encode(texto) });

  const tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml"`
      + ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '</Types>';

  const relacoesRaiz = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1"'
    + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
    + ' Target="xl/workbook.xml"/></Relationships>';

  const pasta = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets>'
    + abas.map((a, i) =>
      `<sheet name="${escaparXml(a.nome.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + '</sheets></workbook>';

  const relacoesPasta = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + abas.map((_, i) => `<Relationship Id="rId${i + 1}"`
      + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
      + ` Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${abas.length + 1}"`
    + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"'
    + ' Target="styles.xml"/>'
    + '</Relationships>';

  return montarZip([
    arquivo('[Content_Types].xml', tipos),
    arquivo('_rels/.rels', relacoesRaiz),
    arquivo('xl/workbook.xml', pasta),
    arquivo('xl/_rels/workbook.xml.rels', relacoesPasta),
    arquivo('xl/styles.xml', ESTILOS_XML),
    ...abas.map((aba, i) => arquivo(`xl/worksheets/sheet${i + 1}.xml`, montarAba(aba))),
  ]);
}
