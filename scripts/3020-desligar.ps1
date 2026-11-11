# Desliga a 3020 (o servidor local escondido): encerra o processo que atende
# a porta 3020 e os que o iniciaram (npx e o PowerShell sem janela).
$conexoes = Get-NetTCPConnection -LocalPort 3020 -State Listen -ErrorAction SilentlyContinue
if (-not $conexoes) { Write-Host 'A 3020 já estava desligada.'; exit 0 }
foreach ($c in $conexoes) {
  $id = $c.OwningProcess
  for ($i = 0; $i -lt 4 -and $id; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
    if (-not $p) { break }
    $pai = $p.ParentProcessId
    # Só sobe enquanto for o próprio servidor (node, cmd, npx ou o PowerShell que o ligou).
    if ($i -gt 0 -and $p.CommandLine -notmatch 'next|npx|3020') { break }
    try { Stop-Process -Id $id -Force -Confirm:$false -ErrorAction Stop } catch {}
    $id = $pai
  }
}
Write-Host 'A 3020 foi desligada.'
