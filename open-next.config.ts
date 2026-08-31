import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Configuração mínima: sem cache incremental, porque todas as páginas deste
// sistema são dinâmicas (dependem da sessão e da RLS do usuário).
export default defineCloudflareConfig();
