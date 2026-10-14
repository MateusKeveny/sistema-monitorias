/**
 * Gera os ícones da Agenda da Gestão em public/ (uma vez, ou ao mudar o desenho).
 *
 *   node scripts/icones-da-agenda.js
 *
 * Calendário branco com o visto, no verde do fundo dos painéis. O selo é a
 * silhueta que o Android mostra na barra de status: só branco no transparente.
 */
const path = require('node:path');
const sharp = require('sharp');

const VERDE = '#005d0c';

// Desenho em 512×512; `area` encolhe para caber na zona segura do maskable.
const calendario = (area = 1) => {
  const s = 512 * area;
  const o = (512 - s) / 2;
  const u = s / 100;
  return `
    <g transform="translate(${o} ${o})" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
      <rect x="${18 * u}" y="${24 * u}" width="${64 * u}" height="${58 * u}" rx="${9 * u}" stroke-width="${6 * u}"/>
      <path d="M${18 * u} ${40 * u}H${82 * u}" stroke-width="${6 * u}"/>
      <path d="M${34 * u} ${16 * u}v${14 * u}M${66 * u} ${16 * u}v${14 * u}" stroke-width="${6 * u}"/>
      <path d="m${37 * u} ${61 * u} ${9 * u} ${9 * u} ${18 * u}-${19 * u}" stroke-width="${7 * u}"/>
    </g>`;
};

const svg = (conteudo, fundo, raio) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    ${fundo ? `<rect width="512" height="512" rx="${raio}" fill="${VERDE}"/>` : ''}
    ${conteudo}
  </svg>`);

const publico = (nome) => path.join(__dirname, '..', 'public', nome);

(async () => {
  const comum = svg(calendario(0.8), true, 112);
  await sharp(comum).resize(192, 192).png().toFile(publico('agenda-192.png'));
  await sharp(comum).resize(512, 512).png().toFile(publico('agenda-512.png'));
  // Maskable: fundo cheio, desenho dentro dos 80% centrais.
  await sharp(svg(calendario(0.62), true, 0)).png().toFile(publico('agenda-mascaravel.png'));
  await sharp(svg(calendario(0.9), false, 0)).resize(96, 96).png().toFile(publico('agenda-selo.png'));
  console.log('Ícones gerados em public/.');
})();
