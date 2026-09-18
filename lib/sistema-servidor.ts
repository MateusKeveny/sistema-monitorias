import { cache } from 'react';
import { headers } from 'next/headers';
import { sistemaDoHost, type Sistema } from '@/lib/sistema';

/** Sistema da requisição atual, para Server Components. */
export const sistemaAtual = cache(async (): Promise<Sistema> =>
  sistemaDoHost((await headers()).get('host')));
