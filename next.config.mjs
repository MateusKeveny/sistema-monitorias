const config = {
  // Pasta do build: a apresentação local (banco-local\apresentacao.ps1) usa uma
  // separada, para não se misturar com o build das publicações.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Importa só as partes usadas do recharts (gráficos), em vez da biblioteca
  // inteira — arquivo menor para o navegador baixar (1.39.3).
  experimental: {
    optimizePackageImports: ['recharts'],
  },
};
export default config;
