import Link from '@/componentes/Link';
import { exigirGestor } from '@/lib/supabase/servidor';
import TelaPessoas from '@/componentes/telas/TelaPessoas';
import TelaSetores from '@/componentes/telas/TelaSetores';
import TelaAcessos from '@/componentes/telas/TelaAcessos';

export const dynamic = 'force-dynamic';

const ABAS = [
  { chave: 'pessoas', rotulo: 'Pessoas' },
  { chave: 'setores', rotulo: 'Setores e filas' },
  { chave: 'acessos', rotulo: 'Uso dos acessos' },
] as const;

/**
 * Usuários e setores (3.0, menu aprovado em 30/10/2026): pessoas, logins,
 * papéis e setores num lugar só — juntou as telas Atendentes e Acessos e a
 * aba Setores e filas da Configuração. Cada aba carrega só o que mostra.
 */
export default async function UsuariosESetores({ searchParams }: {
  searchParams: Promise<{ cat?: string; sistema?: string }>;
}) {
  await exigirGestor();
  const { cat, sistema } = await searchParams;
  const aba = ABAS.find((x) => x.chave === cat)?.chave ?? 'pessoas';
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Usuários e setores</h1>
        <div role="tablist" className="mt-3 inline-flex gap-1 rounded-full border border-slate-200 bg-superficie p-1 shadow-sm">
          {ABAS.map((x) => (
            <Link key={x.chave} role="tab" aria-selected={x.chave === aba}
                  href={x.chave === 'pessoas' ? '/cota/usuarios' : `/cota/usuarios?cat=${x.chave}`}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${x.chave === aba
                    ? 'bg-marca-600 font-semibold text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              {x.rotulo}
            </Link>
          ))}
        </div>
      </div>
      {aba === 'pessoas' && <TelaPessoas />}
      {aba === 'setores' && <TelaSetores />}
      {aba === 'acessos' && <TelaAcessos sistema={sistema === 'monitorias' ? 'monitorias' : 'cota'} />}
    </div>
  );
}
