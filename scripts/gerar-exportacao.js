/**
 * Gera o arquivo de exportação direto do banco, sem passar pelo navegador.
 * Serve para conferir o resultado e para extrações pontuais.
 *
 *   npm run exportar                  -> tudo
 *   npm run exportar -- 2026-08-01    -> só o mês indicado
 */
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !CHAVE) {
  console.error('Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em .env.local');
  process.exit(1);
}

const db = createClient(URL, CHAVE, { auth: { persistSession: false } });
const mes = process.argv[2] || null;

(async () => {
  const { gerarXlsx } = await import('../lib/xlsx-escrever.ts');

  async function ler(view, ordem) {
    let q = db.from(view).select('*');
    if (mes) q = q.eq('mes_referencia', mes);
    for (const [coluna, asc] of ordem) q = q.order(coluna, { ascending: asc });
    const { data, error } = await q;
    if (error) { console.error(view, error.message); process.exit(1); }
    return data ?? [];
  }

  const [monitorias, detalhes] = await Promise.all([
    ler('vw_monitorias', [['data_atendimento', false]]),
    ler('vw_feedback_individual', [['data_atendimento', true], ['criterio_ordem', true]]),
  ]);

  const simNao = (linhas, campo) =>
    linhas.map((l) => ({ ...l, [campo]: l[campo] ? 'Sim' : 'Não' }));

  const bytes = gerarXlsx([
    {
      nome: 'Monitorias',
      colunas: [
        { cabecalho: 'Protocolo', chave: 'protocolo', largura: 16 },
        { cabecalho: 'Data', chave: 'data_atendimento', largura: 12 },
        { cabecalho: 'Operador', chave: 'operador', largura: 22 },
        { cabecalho: 'Canal', chave: 'canal', largura: 20 },
        { cabecalho: 'Semana', chave: 'semana_mes', largura: 9, formato: 'numero' },
        { cabecalho: 'Nº', chave: 'numero_monitoria', largura: 6, formato: 'numero' },
        { cabecalho: 'Nota final', chave: 'nota_final', largura: 11, formato: 'percentual' },
        { cabecalho: 'Zerada', chave: 'zerado', largura: 9 },
        { cabecalho: 'Motivo do zeramento', chave: 'motivo_zeramento', largura: 34, formato: 'quebra' },
        { cabecalho: 'Monitor', chave: 'monitor', largura: 20 },
        { cabecalho: 'Parecer', chave: 'parecer', largura: 80, formato: 'quebra' },
      ],
      linhas: simNao(monitorias, 'zerado'),
    },
    {
      nome: 'Critérios avaliados',
      colunas: [
        { cabecalho: 'Protocolo', chave: 'protocolo', largura: 16 },
        { cabecalho: 'Data', chave: 'data_atendimento', largura: 12 },
        { cabecalho: 'Operador', chave: 'operador', largura: 22 },
        { cabecalho: 'Ordem', chave: 'criterio_ordem', largura: 8, formato: 'numero' },
        { cabecalho: 'Critério', chave: 'criterio', largura: 46 },
        { cabecalho: 'Peso', chave: 'peso', largura: 8, formato: 'percentual' },
        { cabecalho: 'Atendeu?', chave: 'conforme', largura: 11 },
        { cabecalho: 'Observação', chave: 'observacao', largura: 60, formato: 'quebra' },
      ],
      linhas: simNao(detalhes, 'conforme'),
    },
  ]);

  const destino = path.join(__dirname, '..', 'dados',
    `monitorias${mes ? '-' + mes.slice(0, 7) : ''}.xlsx`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, bytes);

  console.log('Gerado:', destino);
  console.log(`  aba Monitorias: ${monitorias.length} linhas`);
  console.log(`  aba Critérios avaliados: ${detalhes.length} linhas`);
  console.log(`  tamanho: ${(bytes.length / 1024).toFixed(1)} KB`);
})();
