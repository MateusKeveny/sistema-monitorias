/**
 * Publica o painel no Cloud Run: monta a imagem, envia ao Artifact Registry e
 * troca a versão do serviço "painel". Os segredos ficam no serviço (gravados
 * uma vez por nuvem/configurar-segredos.ps1) e passam de uma versão à outra.
 *
 *   node nuvem/publicar.mjs
 *
 * Guarda só as 2 imagens mais recentes (a cota gratuita do Artifact Registry
 * é de 0,5 GB).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REGIAO = 'southamerica-east1';
const rodar = (cmd, opcoes = {}) => execSync(cmd, { stdio: 'inherit', ...opcoes });
const ler = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const projeto = ler('gcloud config get-value project');
if (!projeto) throw new Error('Sem projeto no gcloud: gcloud config set project <id>');
const versao = JSON.parse(readFileSync('package.json', 'utf8')).version;
const marca = `${versao}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
const imagem = `${REGIAO}-docker.pkg.dev/${projeto}/painel/painel`;

rodar(`docker build -t ${imagem}:${marca} .`);
rodar(`docker push ${imagem}:${marca}`);
rodar(`gcloud run deploy painel --image ${imagem}:${marca} --region ${REGIAO} --allow-unauthenticated `
  + '--port 8080 --cpu 1 --memory 512Mi --min-instances 0 --max-instances 3 --concurrency 40 --cpu-boost --quiet');

// Limpeza: só as 2 imagens mais recentes.
const lista = JSON.parse(ler(`gcloud artifacts docker images list ${imagem} --include-tags --sort-by=~UPDATE_TIME --format=json`));
for (const antiga of lista.slice(2)) {
  rodar(`gcloud artifacts docker images delete ${imagem}@${antiga.version} --delete-tags --quiet`);
}
console.log(`\nPublicado: ${marca}`);
console.log(ler(`gcloud run services describe painel --region ${REGIAO} --format="value(status.url)"`));
