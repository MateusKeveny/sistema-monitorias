import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import PainelUsuarios from '@/componentes/PainelUsuarios';
import PainelCriterios from '@/componentes/PainelCriterios';
import PainelCadastro from '@/componentes/PainelCadastro';
import type { Canal, Criterio, Operador, Perfil } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function Configuracoes() {
  await exigirGestor();
  const db = await criarClienteServidor();

  const [{ data: criterios }, { data: operadores }, { data: perfis }, { data: canais }] =
    await Promise.all([
      db.from('criterios').select('*').order('ordem'),
      db.from('operadores').select('*').order('nome'),
      db.from('perfis').select('id, nome, email, papel, operador_id, ativo, senha_definida').order('nome'),
      db.from('canais').select('*').order('nome'),
    ]);

  // Quem é avaliado e quem entra no sistema são cadastros diferentes: há
  // operador sem login e há login que não é operador. O painel de Operadores
  // mostra esta ligação para a diferença ficar visível na tela, e não só no
  // modelo de dados.
  const acessoPorOperador = Object.fromEntries(
    ((perfis ?? []) as Perfil[])
      .filter((p) => p.operador_id)
      .map((p) => [p.operador_id as string, p.email]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-sobre-fundo">Configurações</h1>
        <p className="text-sm text-sobre-fundo-suave">
          Critérios e pesos, cadastros e liberação de acesso.
        </p>
      </div>

      <PainelCriterios criterios={(criterios ?? []) as Criterio[]} />

      <div className="grid gap-6 xl:grid-cols-2">
        <PainelCadastro
          titulo="Operadores"
          subtitulo={'Quem é avaliado nas monitorias. Cadastrar alguém aqui não cria login — '
            + 'para a pessoa entrar no sistema ela precisa de conta e de um papel em '
            + 'Acessos, logo abaixo.'}
          tabela="operadores"
          registros={(operadores ?? []) as Operador[]}
          temEmail
          acessoPorOperador={acessoPorOperador}
          dica={'Estes são os nomes que aparecem nos relatórios. Se o nome da planilha '
            + 'estiver diferente do nome real da pessoa, corrija aqui: as monitorias já '
            + 'lançadas apontam para o registro, não para o texto, então o histórico inteiro '
            + 'passa a mostrar o nome novo.'}
        />

        <PainelCadastro
          titulo="Canais de atendimento"
          subtitulo="Por onde o atendimento chegou. Vira opção no formulário de monitoria."
          tabela="canais"
          registros={(canais ?? []) as Canal[]}
        />
      </div>

      <PainelUsuarios
        perfis={(perfis ?? []) as Perfil[]}
        operadores={(operadores ?? []) as Operador[]}
      />
    </div>
  );
}
