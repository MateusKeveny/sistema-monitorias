/**
 * Importa dados/extracao.json para o Supabase.
 *
 *   npm run extrair     # gera dados/extracao.json a partir do .xlsm
 *   npm run importar    # sobe para o banco
 *
 * Precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local
 * (a service_role ignora a RLS — use apenas em máquina sua, nunca no navegador).
 *
 * É idempotente: rodar duas vezes não duplica nada.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !CHAVE) {
  console.error('Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY em .env.local.');
  console.error('Veja o README, seção "Configurar o Supabase".');
  process.exit(1);
}

const db = createClient(URL, CHAVE, { auth: { persistSession: false } });

const arquivo = path.join(__dirname, '..', 'dados', 'extracao.json');
if (!fs.existsSync(arquivo)) {
  console.error('dados/extracao.json não existe. Rode antes: npm run extrair');
  process.exit(1);
}
const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));

/** "1ª Semana" -> 1 ; "3ª Monitoria" -> 3 */
const numeroOrdinal = (texto) => {
  const m = /(\d+)/.exec(texto || '');
  return m ? Number(m[1]) : null;
};

/** Protocolos vieram da planilha com sinal negativo por erro de digitação. */
const normalizarProtocolo = (p) => (p == null ? null : String(p).replace(/^-/, '').trim());

/**
 * O tempo no Excel é fração de um dia (0,5 = 12h). Qualquer valor >= 1 dia é
 * digitação errada — na planilha original havia uma data lançada nesta coluna.
 * Descarta em vez de gravar um absurdo.
 */
function tempoEmSegundos(valor, aviso) {
  if (typeof valor !== 'number' || valor <= 0) return null;
  if (valor >= 1) { aviso.push(valor); return null; }
  return Math.round(valor * 86400);
}

const conferir = ({ error }, oque) => {
  if (error) { console.error(`Falhou em ${oque}:`, error.message); process.exit(1); }
};

async function main() {
  console.log('Importando para', URL);

  // ------------------------------------------------------------- critérios
  const criterios = dados.parametros.criterios.map((c) => ({
    ordem: c.ordem,
    nome: c.nome === 'Atendimento objective' ? 'Atendimento objetivo' : c.nome,
    peso: c.peso,
    ativo: true,
  }));
  conferir(await db.from('criterios').upsert(criterios, { onConflict: 'nome' }), 'critérios');
  console.log(`  critérios: ${criterios.length} (soma dos pesos ${dados.parametros.soma_pesos})`);

  // ---------------------------------------------------------------- canais
  const canais = dados.parametros.canais.map((nome) => ({ nome, ativo: true }));
  conferir(await db.from('canais').upsert(canais, { onConflict: 'nome' }), 'canais');
  console.log(`  canais: ${canais.length}`);

  // ------------------------------------------------------------ operadores
  // Une quem está em Parâmetros com quem realmente aparece nas monitorias.
  const nomesOperadores = new Set(dados.parametros.operadores);
  for (const m of dados.monitorias) if (m.operador) nomesOperadores.add(m.operador);
  const operadores = [...nomesOperadores].map((nome) => ({ nome, ativo: true }));
  conferir(await db.from('operadores').upsert(operadores, { onConflict: 'nome' }), 'operadores');
  console.log(`  operadores: ${operadores.length}`);

  // Recarrega os IDs gerados pelo banco.
  const mapa = async (tabela) => {
    const { data, error } = await db.from(tabela).select('id, nome');
    if (error) { console.error(tabela, error.message); process.exit(1); }
    return new Map(data.map((r) => [r.nome, r.id]));
  };
  const idOperador = await mapa('operadores');
  const idCanal = await mapa('canais');
  const idCriterio = await mapa('criterios');

  // ------------------------------------------------------------ monitorias
  let inseridas = 0, puladas = 0, semDetalhe = 0;
  const problemas = [];
  const temposDescartados = [];

  for (const m of dados.monitorias) {
    const operador_id = idOperador.get(m.operador);
    const semana = numeroOrdinal(m.semana_mes);
    const numero = numeroOrdinal(m.numero_monitoria);

    if (!operador_id || !m.data_atendimento || !semana || !numero) {
      problemas.push({ linha: m.linha_origem, motivo: 'campos obrigatórios ausentes' });
      continue;
    }

    const registro = {
      protocolo: normalizarProtocolo(m.protocolo) ?? 'SEM-PROTOCOLO',
      data_atendimento: m.data_atendimento,
      semana_mes: semana,
      numero_monitoria: numero,
      operador_id,
      canal_id: idCanal.get(m.canal) ?? null,
      tempo_atendimento_seg: tempoEmSegundos(m.tempo_atendimento, temposDescartados),
      zerado: !!m.zerado,
      parecer: m.parecer,
      nota_final: m.nota_final ?? 1,
    };

    // Chave natural: operador + mês + semana + nº da monitoria — exatamente as
    // colunas do índice único do banco, para a importação ser idempotente.
    const mesReferencia = m.data_atendimento.slice(0, 8) + '01';
    const { data: existente } = await db
      .from('monitorias')
      .select('id')
      .eq('operador_id', operador_id)
      .eq('semana_mes', semana)
      .eq('numero_monitoria', numero)
      .eq('mes_referencia', mesReferencia)
      .maybeSingle();

    let monitoriaId;
    if (existente) {
      puladas++;
      monitoriaId = existente.id;
      conferir(await db.from('monitorias').update(registro).eq('id', monitoriaId),
        `atualizar monitoria ${registro.protocolo}`);
    } else {
      const { data, error } = await db.from('monitorias').insert(registro).select('id').single();
      if (error) { problemas.push({ linha: m.linha_origem, motivo: error.message }); continue; }
      monitoriaId = data.id;
      inseridas++;
    }

    // ------------------------------------------------------------- itens
    if (!m.itens) { semDetalhe++; continue; }
    const itens = m.itens
      .filter((i) => i.conforme !== null)
      .map((i) => ({
        monitoria_id: monitoriaId,
        criterio_id: idCriterio.get(
          i.criterio === 'Atendimento objective' ? 'Atendimento objetivo' : i.criterio),
        conforme: i.conforme,
      }))
      .filter((i) => i.criterio_id);

    if (itens.length) {
      conferir(
        await db.from('monitoria_itens').upsert(itens, { onConflict: 'monitoria_id,criterio_id' }),
        `itens da monitoria ${registro.protocolo}`);
    }
  }

  console.log(`  monitorias: ${inseridas} inseridas, ${puladas} atualizadas`);
  if (temposDescartados.length) {
    console.log(`  ${temposDescartados.length} tempo(s) de atendimento inválido(s) ignorado(s)`
      + ` (valores: ${temposDescartados.join(', ')})`);
  }
  if (semDetalhe) console.log(`  ${semDetalhe} sem detalhe de critérios (nota preservada da planilha)`);
  if (problemas.length) {
    console.log(`  ${problemas.length} com problema:`);
    console.table(problemas.slice(0, 20));
  }

  const { count } = await db.from('monitorias').select('*', { count: 'exact', head: true });
  console.log(`\nTotal no banco agora: ${count} monitorias.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
