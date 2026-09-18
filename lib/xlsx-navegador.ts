/**
 * Leitor mínimo de .xlsx no navegador.
 *
 * A planilha é lida no computador de quem importa, e não no servidor: o
 * Worker gratuito tem 10 ms de processamento por requisição, e descompactar
 * um relatório de centenas de KB estouraria isso. No navegador não há limite.
 *
 * Sem biblioteca: um .xlsx é um zip de XMLs, e o navegador já sabe
 * descompactar (`DecompressionStream`). Lê só valores — sem fórmulas,
 * estilos nem datas formatadas (datas chegam como número serial do Excel).
 */

export type Linha = Record<string, string | number | boolean>;

async function inflar(dados: Uint8Array): Promise<Uint8Array> {
  const fluxo = new Blob([dados as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

async function lerZip(buffer: ArrayBuffer): Promise<Map<string, string>> {
  const v = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Fim do diretório central: assinatura 0x06054b50 nos últimos bytes.
  let fim = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('O arquivo não é um .xlsx válido.');

  const total = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const arquivos = new Map<string, string>();
  const texto = new TextDecoder();

  for (let n = 0; n < total; n++) {
    const metodo = v.getUint16(p + 10, true);
    const tamanho = v.getUint32(p + 20, true);
    const lenNome = v.getUint16(p + 28, true);
    const lenExtra = v.getUint16(p + 30, true);
    const lenComent = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nome = texto.decode(bytes.subarray(p + 46, p + 46 + lenNome));
    p += 46 + lenNome + lenExtra + lenComent;

    if (!nome.endsWith('.xml') && !nome.endsWith('.rels')) continue;
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const bruto = bytes.subarray(inicio, inicio + tamanho);
    const conteudo = metodo === 8 ? await inflar(bruto) : bruto;
    arquivos.set(nome, texto.decode(conteudo));
  }
  return arquivos;
}

const decodificar = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

/** Abas da planilha, cada uma como lista de linhas indexadas pela letra da coluna. */
export async function lerPlanilha(arquivo: File): Promise<Map<string, Linha[]>> {
  const zip = await lerZip(await arquivo.arrayBuffer());

  const compartilhadas: string[] = [];
  for (const si of (zip.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let t = '';
    for (const m of si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += m[1];
    compartilhadas.push(decodificar(t));
  }

  const rels = new Map<string, string>();
  for (const m of (zip.get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship([^>]*)\/>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1]); const alvo = /Target="([^"]+)"/.exec(m[1]);
    if (id && alvo) rels.set(id[1], alvo[1].replace(/^\/?xl\//, ''));
  }

  const abas = new Map<string, Linha[]>();
  for (const m of (zip.get('xl/workbook.xml') ?? '').matchAll(/<sheet ([^>]*)\/>/g)) {
    const nome = decodificar(/name="([^"]+)"/.exec(m[1])![1]);
    const xml = zip.get('xl/' + rels.get(/r:id="([^"]+)"/.exec(m[1])![1]));
    if (!xml) continue;

    const linhas = new Map<number, Linha>();
    for (const c of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, lin, attrs, inner = ''] = c;
      const tipo = /t="([^"]+)"/.exec(attrs)?.[1];
      let valor: string | number | boolean | undefined;
      if (tipo === 'inlineStr') {
        valor = decodificar([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      } else {
        const bruto = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (bruto == null) continue;
        if (tipo === 's') valor = compartilhadas[Number(bruto)];
        else if (tipo === 'str' || tipo === 'e') valor = decodificar(bruto);
        else if (tipo === 'b') valor = bruto === '1';
        else valor = Number(bruto);
      }
      if (valor === undefined || valor === '') continue;
      const n = Number(lin);
      if (!linhas.has(n)) linhas.set(n, {});
      linhas.get(n)![col] = valor;
    }
    abas.set(nome, [...linhas.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l));
  }
  return abas;
}

/** Número serial de data do Excel (sistema 1900) para 'AAAA-MM-DD'. */
export function dataDoExcel(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}
