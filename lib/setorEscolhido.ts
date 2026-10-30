import { cookies } from 'next/headers';

/**
 * O setor escolhido no seletor do menu (3.0): fica num cookie, e toda tela
 * por setor o usa quando o endereço não diz outro (?setor=). Só no servidor.
 */
export const COOKIE_SETOR = 'setor';

export async function setorDoCookie(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_SETOR)?.value;
}
