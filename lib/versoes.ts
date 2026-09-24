import pacote from '@/package.json';

/**
 * Versão de cada sistema, separadas.
 *
 * Os dois vivem no mesmo projeto e sobem juntos, mas evoluem em ritmos
 * diferentes e têm públicos diferentes: uma mudança só na cota não deve mudar
 * a versão que os operadores veem nas monitorias, e vice-versa.
 *
 * Ao publicar, suba só a versão do sistema que mudou:
 *   Monitorias — `npm version patch|minor --no-git-tag-version`
 *   Cota       — a constante abaixo
 */
export const VERSAO_MONITORIAS: string = pacote.version;

/** 0.x enquanto o painel de cota não for divulgado à equipe. */
export const VERSAO_COTA = '0.14.1';
