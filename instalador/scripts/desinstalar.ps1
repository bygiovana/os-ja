# Para e remove os serviços do OS Já. Os dados em C:\ProgramData\GestaoOS são mantidos
# (banco, configuração, backups e logs). Para apagar tudo, remova essa pasta manualmente.
param([Parameter(Mandatory)] [string] $PastaInstalacao)

$PastaInstalacao = $PastaInstalacao.TrimEnd('\')
$logs = Join-Path $env:ProgramData 'GestaoOS\logs'
New-Item -ItemType Directory -Force $logs | Out-Null
try { Start-Transcript -Path (Join-Path $logs 'instalacao.log') -Append -ErrorAction Stop | Out-Null; $comLog = $true }
catch { $comLog = $false }

foreach ($nome in 'GestaoOS', 'GestaoOS-Banco') {
  if (Get-Service -Name $nome -ErrorAction SilentlyContinue) {
    Write-Host "Parando $nome"
    Stop-Service $nome -Force -ErrorAction SilentlyContinue
  }
}

$winsw = Join-Path $PastaInstalacao 'servico\GestaoOS.exe'
if ((Get-Service -Name 'GestaoOS' -ErrorAction SilentlyContinue) -and (Test-Path $winsw)) { & $winsw uninstall }
if (Get-Service -Name 'GestaoOS' -ErrorAction SilentlyContinue) { sc.exe delete GestaoOS | Out-Null }

$pgCtl = Join-Path $PastaInstalacao 'pgsql\bin\pg_ctl.exe'
if ((Get-Service -Name 'GestaoOS-Banco' -ErrorAction SilentlyContinue) -and (Test-Path $pgCtl)) { & $pgCtl unregister -N GestaoOS-Banco }
if (Get-Service -Name 'GestaoOS-Banco' -ErrorAction SilentlyContinue) { sc.exe delete GestaoOS-Banco | Out-Null }

Get-NetFirewallRule -DisplayName 'OS Já (celulares)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Serviços removidos. Dados mantidos em' (Join-Path $env:ProgramData 'GestaoOS')
if ($comLog) { try { Stop-Transcript | Out-Null } catch { } }
exit 0
