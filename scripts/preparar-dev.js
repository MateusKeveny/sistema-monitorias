/**
 * Roda antes do `next dev`.
 *
 * O dev e o build de produção dividem a pasta `.next`, e o build sobrescreve os
 * artefatos do dev — o sintoma é a página abrir sem estilo, com o CSS dando 404.
 * O arquivo `.next/BUILD_ID` só existe em build de produção, então serve de marca:
 * se estiver lá, a pasta é descartada para o dev começar limpo.
 */
const fs = require('node:fs');
const path = require('node:path');

const pasta = path.join(__dirname, '..', '.next');
const marcaDeProducao = path.join(pasta, 'BUILD_ID');

if (fs.existsSync(marcaDeProducao)) {
  try {
    fs.rmSync(pasta, { recursive: true, force: true });
    console.log('.next continha um build de produção e foi limpo para o modo dev.');
  } catch (erro) {
    console.warn('Não consegui limpar .next automaticamente:', erro.message);
    console.warn('Encerre servidores abertos (next, wrangler, workerd) e apague .next à mão.');
  }
}
