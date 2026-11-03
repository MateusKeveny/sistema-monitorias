const config = {
  // Importa só as partes usadas do recharts (gráficos), em vez da biblioteca
  // inteira — arquivo menor para o navegador baixar (1.39.3).
  experimental: {
    optimizePackageImports: ['recharts'],
  },
};
export default config;
