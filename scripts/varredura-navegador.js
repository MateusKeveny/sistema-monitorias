/**
 * Varredura das telas — roda no console do navegador, numa aba já logada
 * (1.41.2). Criada na bateria de testes de 14/10/2026.
 *
 * Abre, uma por vez, todas as telas do sistema da aba (Performance ou
 * Monitorias), com parâmetros válidos e propositalmente inválidos, e aponta:
 *   - FALHA-BANCO: a tela foi para "Algo deu errado" porque o banco falhou.
 *     A tela de erro é desenhada no navegador — no HTML da resposta o sinal é
 *     o texto "O banco não respondeu" (lib/consultas.ts);
 *   - ERRO-SERVIDOR: outro erro no servidor (digest do Next);
 *   - HTTP4xx/5xx: resposta de erro (as APIs);
 *   - TEXTO-SUSPEITO: "Invalid Date", "NaN" ou "undefined" na tela;
 *   - LENTA: mais de 5 s.
 * Não grava nada: só abre telas e a exportação em CSV.
 *
 * Como usar: abrir o sistema logado como gestor (local ou publicado), F12 →
 * Console, colar este arquivo inteiro e Enter. No publicado, rodar fora do
 * horário de uso: são ~40 aberturas em sequência, com pausa entre elas, mas o
 * plano gratuito tem o limite do erro 1102.
 *
 * Para incluir telas novas, acrescente nas listas abaixo.
 */
(async () => {
  const PAUSA_MS = 600;
  const cota = location.host.startsWith('painel-performance.') || location.port === '3000';

  // Uma pessoa qualquer da lista e uma monitoria qualquer, tiradas das telas.
  const pegar = async (url, re) => (await (await fetch(url)).text()).match(re)?.[1];
  const pessoa = cota ? await pegar('/cota/extrato', /<option value="([0-9a-f-]{36})"/) : null;
  const monitoria = cota ? null : await pegar('/monitorias', /href="\/monitorias\/([0-9a-f-]{36})"/);
  const operador = cota ? null : await pegar('/relatorios/feedback', /<option value="([0-9a-f-]{36})"/);

  const telas = cota ? [
    '/cota', '/cota?mes=2026-09', '/cota?mes=abc', '/cota?mes=2026-13', '/cota?canal=diretores',
    '/cota/extrato', `/cota/extrato?pessoa=${pessoa}`, `/cota/extrato?mes=2026-09&pessoa=${pessoa}`,
    `/cota/extrato?pessoa=${pessoa}&aba=chamados`, '/cota/extrato?pessoa=lixo', '/cota/extrato?mes=9999-99',
    '/cota/comparativo', '/cota/comparativo?n=12', '/cota/historico', `/cota/historico?pessoa=${pessoa}`,
    '/cota/monitorias', '/cota/presencial', '/cota/presencial?mes=lixo', '/cota/lancamentos', '/cota/importar',
    '/cota/importar?aba=chamados', '/cota/fechamento', '/cota/fechamento?mes=lixo', '/cota/atendentes',
    '/cota/acessos', '/cota/acessos?sistema=monitorias', '/cota/configuracao', '/cota/diario',
    '/cota/diario?filtro=aguardando', '/reportes', '/api/cota/exportar?mes=lixo',
  ] : [
    '/', '/?mes=2026-09', '/?mes=lixo', '/monitorias', '/monitorias?pagina=2', '/monitorias?pagina=999',
    `/monitorias/${monitoria}`, `/monitorias/${monitoria}/editar`, '/monitorias/lixo', '/monitorias/nova',
    '/monitorias/excluidas', '/relatorios', '/relatorios?mes=2026-09', '/relatorios/ranking',
    '/relatorios/criterios', '/relatorios/criterios?mes=lixo', '/relatorios/feedback',
    `/relatorios/feedback?operador=${operador}&mes=2026-09-01`, '/diario',
    '/configuracoes', '/reportes', '/api/exportar?formato=csv', '/api/exportar?mes=2026-09&formato=csv',
    '/api/exportar?mes=lixo',
  ];

  const resultado = [];
  for (const url of telas) {
    const inicio = performance.now();
    let estado = 0; let texto = ''; let tipo = '';
    try {
      const r = await fetch(url, { cache: 'no-store' });
      estado = r.status; tipo = r.headers.get('content-type') ?? '';
      texto = /html|json|text|csv/.test(tipo) ? await r.text() : '';
    } catch (e) { texto = `FALHA DE REDE ${e}`; }
    const ms = Math.round(performance.now() - inicio);
    const sinais = [];
    if (texto.includes('O banco não respondeu')) sinais.push('FALHA-BANCO');
    else if (/"digest\\?":\\?"\d+/.test(texto)) sinais.push('ERRO-SERVIDOR');
    if (estado >= 400 && !url.includes('lixo')) sinais.push(`HTTP${estado}`);
    if (tipo.includes('html')) {
      const d = new DOMParser().parseFromString(texto, 'text/html');
      d.querySelectorAll('script,style,template').forEach((e) => e.remove());
      if (/Invalid Date|NaN|undefined/.test(d.body?.textContent ?? '')) sinais.push('TEXTO-SUSPEITO');
    }
    if (/Error 1102/.test(texto)) sinais.push('1102');
    if (ms > 5000) sinais.push('LENTA');
    resultado.push({ tela: url, estado, ms, sinais: sinais.join(' ') || 'ok' });
    await new Promise((r) => setTimeout(r, PAUSA_MS));
  }

  console.table(resultado);
  const problemas = resultado.filter((r) => r.sinais !== 'ok');
  console.log(problemas.length
    ? `⚠ ${problemas.length} de ${resultado.length} telas com sinal — veja a tabela.`
    : `✓ ${resultado.length} telas sem nenhum sinal de falha.`);
  return problemas;
})();
