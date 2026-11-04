# Cadastra no GitHub as chaves da publicação agendada (04/11/2026).
#
# Roda no computador do gestor: lê o .env.local e manda cada valor direto para
# os Secrets do repositório pelo GitHub CLI. Nenhum valor aparece na tela nem
# passa pelo chat. A chave da Cloudflare é pedida aqui, com o texto escondido.
#
# Uso (na pasta do projeto):  powershell -ExecutionPolicy Bypass -File scripts\chaves-do-github.ps1

$ErrorActionPreference = 'Stop'
$repo = 'MateusKeveny/sistema-monitorias'

# GitHub CLI: instalado e com login.
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host 'Instale o GitHub CLI: winget install GitHub.cli  (depois abra um novo terminal)' -ForegroundColor Yellow; exit 1
}
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Entrando no GitHub (abre o navegador)...'; gh auth login --hostname github.com --web --git-protocol https }

function Gravar($nome, $valor) {
  if ([string]::IsNullOrWhiteSpace($valor)) { Write-Host "  - $nome : vazio, não gravado" -ForegroundColor Yellow; return }
  $valor | gh secret set $nome --repo $repo
  if ($LASTEXITCODE -eq 0) { Write-Host "  OK  $nome" -ForegroundColor Green } else { Write-Host "  ERRO $nome" -ForegroundColor Red }
}

# 1. Os quatro do Supabase, do .env.local.
$env_local = Join-Path (Get-Location) '.env.local'
if (-not (Test-Path $env_local)) { Write-Host 'Rode na pasta do projeto (não achei o .env.local).' -ForegroundColor Red; exit 1 }
$vars = @{}
foreach ($linha in Get-Content $env_local) {
  if ($linha -match '^\s*([A-Z_]+)\s*=\s*(.*)\s*$') { $vars[$Matches[1]] = $Matches[2].Trim('"').Trim("'") }
}
Write-Host 'Supabase (do .env.local):'
foreach ($n in 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_AGENDA_SUPABASE_URL', 'NEXT_PUBLIC_AGENDA_SUPABASE_ANON_KEY') {
  Gravar $n $vars[$n]
}

# 2. O ID da conta da Cloudflare, pelo login do wrangler que já existe aqui.
Write-Host 'Cloudflare:'
$conta = (npx wrangler whoami 2>$null | Select-String -Pattern '[0-9a-f]{32}' -AllMatches | ForEach-Object { $_.Matches.Value } | Select-Object -First 1)
if (-not $conta) { $conta = Read-Host 'Account ID da Cloudflare (Workers & Pages, lateral direita)' }
Gravar 'CLOUDFLARE_ACCOUNT_ID' $conta

# 3. A chave da Cloudflare: criada pelo gestor no painel, colada aqui, escondida.
Write-Host ''
Write-Host 'Crie a chave em https://dash.cloudflare.com/profile/api-tokens > Create Token > modelo "Edit Cloudflare Workers".'
$seguro = Read-Host 'Cole a chave da Cloudflare (não aparece na tela)' -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
Gravar 'CLOUDFLARE_API_TOKEN' $token
$token = $null

Write-Host ''
Write-Host 'Chaves no GitHub agora (só os nomes):'
gh secret list --repo $repo
