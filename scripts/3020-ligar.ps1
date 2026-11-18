# Liga a 3020 (Performance local, banco OFICIAL) sem janela aparecendo.
# A saída vai para %TEMP%\painel-3020.log (fora do .next-local: dentro dele, o
# arquivo aberto travava o build). Para desligar: 3020-desligar.ps1.
$projeto = Split-Path -Parent $PSScriptRoot
$log = Join-Path $env:TEMP 'painel-3020.log'

# Já está no ar? Não liga outra.
if (Get-NetTCPConnection -LocalPort 3020 -State Listen -ErrorAction SilentlyContinue) {
  Write-Host 'A 3020 já está ligada: http://localhost:3020'
  exit 0
}

# Guarda o registro da vez anterior: se a 3020 cair, ele diz por quê.
if (Test-Path $log) { Copy-Item $log (Join-Path $env:TEMP 'painel-3020.anterior.log') -Force }

# Liga pelo Win32_Process (CIM), e não pelo Start-Process: assim o servidor
# não fica preso à janela/terminal que rodou este script e não cai quando ela
# fecha (era o que derrubava a 3020 "sozinha").
$comando = "powershell.exe -NoProfile -WindowStyle Hidden -Command `"`$env:SISTEMA='cota'; `$env:NEXT_DIST_DIR='.next-local'; npx next start -p 3020 *> '$log'`""
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $comando; CurrentDirectory = $projeto } | Out-Null

# Espera responder (até 40 s).
for ($i = 0; $i -lt 40; $i++) {
  try {
    if ((Invoke-WebRequest -Uri 'http://localhost:3020/login' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) {
      Write-Host 'A 3020 está no ar: http://localhost:3020'
      exit 0
    }
  } catch { Start-Sleep -Seconds 1 }
}
Write-Host "A 3020 não respondeu em 40 s. Veja o registro: $log"
exit 1
