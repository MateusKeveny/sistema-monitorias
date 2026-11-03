const config = {
  // Servidor Node enxuto para o Cloud Run (Dockerfile). A publicação na
  // Cloudflare (OpenNext) não muda com isto.
  output: 'standalone',
  // Importa só as partes usadas do recharts (gráficos), em vez da biblioteca
  // inteira — arquivo menor para o navegador baixar (1.39.3).
  experimental: {
    optimizePackageImports: ['recharts'],
  },
};
export default config;
