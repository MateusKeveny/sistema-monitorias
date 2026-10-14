import AtivarNotificacoes from '@/componentes/agenda/AtivarNotificacoes';
import PreferenciasDoResumo from '@/componentes/agenda/PreferenciasDoResumo';
import BotaoSair from '@/componentes/agenda/BotaoSair';
import BotaoTema from '@/componentes/BotaoTema';
import { Painel, Secao } from '@/componentes/ui';
import TrocarSenha from '@/componentes/agenda/TrocarSenha';
import { criarServidorDaAgenda, exigirUsuario } from '@/lib/agenda/db-servidor';
import { chavesVapid } from '@/lib/agenda/envio';
import { dataHora } from '@/lib/formatar';
import { PREFERENCIAS_PADRAO, type Preferencias } from '@/lib/agenda/tipos';
import { VERSAO_AGENDA } from '@/lib/versoes';

export const dynamic = 'force-dynamic';

/** Notificações deste aparelho, resumo do dia, aparelhos inscritos e a conta. */
export default async function Ajustes() {
  const usuario = await exigirUsuario();
  const db = await criarServidorDaAgenda();
  const [preferencias, aparelhos] = await Promise.all([
    db.from('agenda_preferencias').select('resumo_ativo, resumo_hora, resumo_fim_semana, pendencias').maybeSingle()
      .then((r) => (r.data as Preferencias | null) ?? PREFERENCIAS_PADRAO),
    db.from('agenda_inscricoes').select('endpoint, aparelho, criado_em').order('criado_em', { ascending: false })
      .then((r) => (r.data ?? []) as { endpoint: string; aparelho: string | null; criado_em: string }[]),
  ]);

  return (
    <div className="space-y-4">
      <header className="text-sobre-fundo">
        <h1 className="text-2xl font-bold tracking-tight">Ajustes</h1>
      </header>

      <Painel>
        <Secao titulo="Notificações neste aparelho"
               subtitulo="Ative em cada aparelho onde quer ser lembrado: no celular e no computador.">
          <AtivarNotificacoes chavePublica={chavesVapid()?.publica ?? null} />
        </Secao>

        <Secao titulo="Resumo do dia">
          <PreferenciasDoResumo inicial={preferencias} gestor={usuario.ve_pendencias} usuarioId={usuario.id} />
        </Secao>

        <Secao titulo="Aparelhos que recebem" subtitulo={aparelhos.length ? undefined : 'Nenhum ainda.'}>
          {aparelhos.length > 0 && (
            <ul className="divide-y divide-slate-100 text-sm">
              {aparelhos.map((a) => (
                <li key={a.endpoint} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-slate-800">{a.aparelho ?? 'Aparelho'}</span>
                  <span className="text-xs text-slate-500">desde {dataHora(a.criado_em)}</span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </Painel>

      <Painel>
        <Secao titulo="Instalar como aplicativo">
          <div className="grid gap-4 text-sm text-slate-600 sm:grid-cols-2">
            <div>
              <p className="mb-1 font-medium text-slate-800">Android (Chrome)</p>
              <ol className="list-decimal space-y-0.5 pl-5">
                <li>Toque nos três pontinhos ⋮ no canto de cima.</li>
                <li>Escolha <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).</li>
                <li>Abra a Agenda pelo ícone e ative as notificações aqui.</li>
              </ol>
            </div>
            <div>
              <p className="mb-1 font-medium text-slate-800">Windows (Edge ou Chrome)</p>
              <ol className="list-decimal space-y-0.5 pl-5">
                <li>Clique no ícone de instalar, à direita do endereço (ou ⋯ → Aplicativos → Instalar).</li>
                <li>A Agenda vira um programa no menu Iniciar.</li>
                <li>Ative as notificações aqui também — cada aparelho é separado.</li>
              </ol>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            No computador, as notificações chegam com o navegador fechado enquanto ele seguir rodando em segundo plano
            (o padrão do Edge no Windows). No celular, basta o app instalado.
          </p>
        </Secao>
      </Painel>

      <Painel>
        <Secao titulo="Conta">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium text-slate-900">{usuario.nome}</p>
              <p className="text-xs text-slate-500">Usuário · {usuario.usuario}</p>
            </div>
            <div className="flex items-center gap-2">
              <BotaoTema />
              <BotaoSair />
            </div>
          </div>
          <TrocarSenha />
          <p className="mt-4 select-none text-[10px] tabular-nums text-slate-400/60">v{VERSAO_AGENDA}</p>
        </Secao>
      </Painel>
    </div>
  );
}
