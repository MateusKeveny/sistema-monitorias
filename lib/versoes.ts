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
 *
 * O que cada número significa, nos dois sistemas:
 *
 *   MAJOR — muda regra de cálculo que altera pontuação de competência já
 *           calculada, ou qualquer coisa que obrigue a refazer um envio.
 *   MINOR — recurso novo.
 *   PATCH — correção, sem mudar número de ninguém.
 *
 * E a regra de processo, aprendida errando: **commit e tag antes do deploy**.
 * Em setembro/2026 três versões da cota (0.12.0, 0.13.0 e 0.14.0) foram ao ar
 * sem commit correspondente — código em produção com número que não existia no
 * repositório.
 */
export const VERSAO_MONITORIAS: string = pacote.version;

/**
 * A numeração 0.x usada até 24/09/2026 não correspondia a nada: contava
 * publicações, não entregas. Recontada pelo que foi de fato entregue desde a
 * estreia em produção (1.0.0, em 18/09/2026), a cota está em 1.4.0.
 */
export const VERSAO_COTA = '1.10.0';
