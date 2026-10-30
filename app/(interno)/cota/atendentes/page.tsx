import { redirect } from 'next/navigation';

/** A tela Atendentes virou a aba Pessoas de "Usuários e setores" (3.0). */
export default function Atendentes() {
  redirect('/cota/usuarios');
}
