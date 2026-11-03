# Grava as chaves do painel no serviço "painel" do Cloud Run e a chave do
# repasse no Worker de repasse da Cloudflare. Rode VOCÊ, no terminal, na pasta
# do projeto:
#
#   powershell -ExecutionPolicy Bypass -File nuvem\configurar-segredos.ps1 -Worker painel-nuvem-teste
#
# Lê .env.local e .dev.vars (os mesmos arquivos do dia a dia), monta um arquivo
# temporário, envia ao Cloud Run e apaga o arquivo. Nenhum valor aparece na
# tela: só os NOMES do que foi enviado e do que faltou.
param(
  [string]$Worker = 'painel-nuvem-teste',
  [string]$ConfigDoWorker = 'nuvem/wrangler.repasse.jsonc',
  [string]$AmbienteDoWorker = 'teste'
)
$ErrorActionPreference = 'Stop'

$nomes = @(
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_AGENDA_SUPABASE_URL', 'NEXT_PUBLIC_AGENDA_SUPABASE_ANON_KEY',
  'SENHA_PADRAO', 'PONTE_SEGREDO', 'AGENDA_SEGREDO', 'TELEGRAM_TOKEN', 'VAPID_PRIVADA'
)
$valores = @{}
foreach ($arquivo in @('.env.local', '.dev.vars')) {
  if (-not (Test-Path $arquivo)) { continue }
  foreach ($linha in Get-Content $arquivo) {
    if ($linha -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') {
      $v = $Matches[2].Trim().Trim('"').Trim("'")
      if ($nomes -contains $Matches[1] -and $v) { $valores[$Matches[1]] = $v }
    }
  }
}
# A pública do aviso no computador está no wrangler.jsonc (não é segredo).
$valores['VAPID_PUBLICA'] = 'BCQCqXSYb9IlViA4t1M6eso9tLXIWz__I3VN6JMITHsq_sEuG6zVm14UyLgLn_UJux1V42ianEW4fOpF4P6lxyA'

# Chave do repasse: nova a cada execução, a mesma nos dois lados.
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$chave = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$valores['CHAVE_DA_PONTE'] = $chave

$temp = Join-Path $env:TEMP ("painel-env-" + [guid]::NewGuid() + '.yaml')
try {
  $yaml = ($valores.GetEnumerator() | ForEach-Object { "$($_.Key): '" + ($_.Value -replace "'", "''") + "'" }) -join "`n"
  [System.IO.File]::WriteAllText($temp, $yaml)
  gcloud run services update painel --region southamerica-east1 --env-vars-file $temp --quiet
} finally {
  Remove-Item $temp -Force -ErrorAction SilentlyContinue
}
$chave | npx wrangler secret put CHAVE_DA_PONTE --config $ConfigDoWorker --env $AmbienteDoWorker

Write-Host ''
Write-Host "Enviados: $((($valores.Keys | Sort-Object) -join ', '))"
$faltando = $nomes | Where-Object { -not $valores.ContainsKey($_) }
if ($faltando) { Write-Host "Faltaram (nao achei nos arquivos): $($faltando -join ', ')" -ForegroundColor Yellow }
Write-Host "Chave do repasse gravada no Worker $Worker." -ForegroundColor Green
