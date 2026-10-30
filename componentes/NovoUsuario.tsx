'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Quadro } from '@/componentes/ui';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { hojeNoBrasil, mesDeCompetencia, mesRotulo } from '@/lib/formatar';
import { emailDoLogin } from '@/lib/usuario';
import type { Cargo, PapelUsuario } from '@/lib/tipos';
import type { Setor } from '@/lib/setores';

const entrada = 'w-full rounded-md border border-slate-300 bg-superficie px-2 py-1.5 text-sm outline-none focus:border-marca-600';
const rotulo = 'mb-1 block text-xs font-medium text-slate-600';

/**
 * "+ Novo usuário" (3.0): a pessoa e o login num passo só, em "Usuários e
 * setores" › Pessoas. Antes, no Performance, só havia o cadastro por
 * planilha, e o "Criar acesso" ficava no fim da ficha. Os passos são os do
 * cadastro em lote: a pessoa, o setor e o cargo a partir do mês de entrada,
 * e o acesso (criar_acesso, migração 68), que gera a senha temporária.
 *
 * Quem não é atendente (gestão, qualidade, administrador) nasce fora das
 * listas, das médias e das monitorias — e sem cargo, porque não pontua.
 */
export default function NovoUsuario({ setores, cargos }: { setores: Setor[]; cargos: Cargo[] }) {
  const router = useRouter();
  const competencia = mesDeCompetencia(hojeNoBrasil());
  const vazio = { nome: '', papel: 'operador' as PapelUsuario, setor: String(setores[0]?.id ?? 1), cargo: '', login: '', desde: competencia.slice(0, 7) };
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState(vazio);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ nome: string; login: string | null; senha: string | null } | null>(null);
  const [copiada, setCopiada] = useState(false);

  const atendente = f.papel === 'operador';
  const cargosDoSetor = cargos.filter((c) => (c.setor_id ?? 1) === Number(f.setor));

  async function criar() {
    const nome = f.nome.trim();
    if (!nome) { setErro('Informe o nome.'); return; }
    const login = f.login.trim() ? emailDoLogin(f.login) : null;
    if (!confirm(`Cadastrar ${nome}${login ? ` e criar o acesso (${login})` : ''}?`)) return;
    setOcupado(true); setErro(null);
    const db = criarClienteNavegador();
    const desde = `${f.desde}-01`;
    const { data: criada, error } = await db.from('pessoas').insert({
      nome, papel: f.papel, ativo: true, admitido_em: desde,
      avaliado: atendente, exibir_no_painel: atendente, conta_nas_medias: atendente,
    }).select('id').single();
    if (error || !criada) { setOcupado(false); setErro(await mensagemDoErro(error!)); return; }

    // O setor padrão que o banco põe na pessoa nova (migração 86) dá lugar ao escolhido.
    const passos = [
      () => db.from('setores_da_pessoa').delete().eq('pessoa_id', criada.id),
      () => db.from('setores_da_pessoa').insert({ pessoa_id: criada.id, desde, setor_id: Number(f.setor) }),
      ...(atendente && f.cargo ? [() => db.from('cargos_da_pessoa').insert({ pessoa_id: criada.id, desde, cargo_id: Number(f.cargo) })] : []),
    ];
    for (const passo of passos) {
      const { error: e } = await passo();
      if (e) { setOcupado(false); setErro(`Pessoa criada, mas o setor ou o cargo não: ${await mensagemDoErro(e)}`); router.refresh(); return; }
    }
    let senha: string | null = null;
    if (login) {
      const { data, error: e } = await db.rpc('criar_acesso', { p_pessoa: criada.id, p_email: login, p_papel: f.papel });
      if (e) { setOcupado(false); setErro(`Pessoa criada, mas o acesso não: ${await mensagemDoErro(e)}`); router.refresh(); return; }
      senha = String(data);
    }
    setOcupado(false);
    setFeito({ nome, login, senha }); setCopiada(false);
    setF(vazio);
    router.refresh();
  }

  if (!aberto && !feito) {
    return (
      <button type="button" onClick={() => setAberto(true)}
              className="rounded-full bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700">
        + Novo usuário
      </button>
    );
  }

  return (
    <Quadro className="basis-full" titulo="Novo usuário" subtitulo="A pessoa e o login de uma vez. O login é opcional: dá para criar depois, na ficha."
            acao={<button type="button" onClick={() => { setAberto(false); setFeito(null); setErro(null); }}
                          className="text-sm text-slate-500 hover:underline">Fechar</button>}>
      {feito ? (
        <div className="space-y-3 text-sm text-slate-700">
          <p><b>{feito.nome}</b> cadastrado{feito.login ? <> com o login <b>{feito.login.replace(/@painel\.interno$/, '')}</b></> : ''}.</p>
          {feito.senha && (
            <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Senha temporária — aparece só agora. Repasse à pessoa; no primeiro acesso ela define a dela.</p>
              <p className="mt-1 flex items-center gap-3">
                <code className="select-all text-lg font-bold tracking-wider text-slate-900">{feito.senha}</code>
                <button type="button" className="text-xs text-marca-700 hover:underline dark:text-marca-400"
                        onClick={async () => { try { await navigator.clipboard.writeText(feito.senha!); setCopiada(true); } catch { setCopiada(false); } }}>
                  {copiada ? 'copiada' : 'copiar'}
                </button>
              </p>
            </div>
          )}
          <button type="button" onClick={() => setFeito(null)} className="text-sm text-marca-700 hover:underline dark:text-marca-400">
            Cadastrar outro
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="xl:col-span-2"><span className={rotulo}>Nome</span>
              <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className={entrada} disabled={ocupado} autoFocus />
            </label>
            <label><span className={rotulo}>Papel</span>
              <select value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value as PapelUsuario, cargo: '' })} className={entrada} disabled={ocupado}>
                <option value="operador">Atendente</option>
                <option value="qualidade">Qualidade</option>
                <option value="gestor">Gestor</option>
              </select>
            </label>
            <label><span className={rotulo}>Setor</span>
              <select value={f.setor} onChange={(e) => setF({ ...f, setor: e.target.value, cargo: '' })} className={entrada} disabled={ocupado}>
                {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </label>
            {atendente && (
              <label><span className={rotulo}>Cargo</span>
                <select value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} className={entrada} disabled={ocupado}>
                  <option value="">Definir depois</option>
                  {cargosDoSetor.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </label>
            )}
            <label><span className={rotulo}>Entrada (setor e cargo valem a partir de)</span>
              <input type="month" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} className={entrada} disabled={ocupado} />
            </label>
            <label className="xl:col-span-2"><span className={rotulo}>Login: e-mail ou nome de usuário (opcional)</span>
              <input value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} placeholder="nome@igreenenergy.com.br ou admin"
                     className={entrada} disabled={ocupado} autoCapitalize="none" spellCheck={false} />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            {atendente
              ? `Atendente: entra nas listas, nas médias e nas monitorias. Setor e cargo a partir de ${mesRotulo(`${f.desde}-01`)}.`
              : 'Gestão e qualidade: ficam fora das listas, das médias e das monitorias, e sem cargo (não pontuam).'}
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={criar} disabled={ocupado || !f.nome.trim()}
                    className="rounded-full bg-marca-600 px-5 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
              {ocupado ? 'Cadastrando…' : 'Cadastrar'}
            </button>
          </div>
        </div>
      )}
    </Quadro>
  );
}
