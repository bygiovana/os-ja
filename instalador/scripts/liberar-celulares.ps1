# Libera o OS Já para os celulares da oficina (mesma rede Wi-Fi/cabo):
#  - HOST=0.0.0.0 no config.env
#  - cria usuário e senha de acesso, se ainda não houver
#  - libera a porta no Firewall do Windows só para redes PRIVADAS
#  - reinicia o serviço e abre a tela Equipe com os QR codes
# Atalho no menu Iniciar: "OS Já — Liberar celulares". Pede confirmação de administrador.
param([switch] $Elevado)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  if ($Elevado) { throw 'Não foi possível obter permissão de administrador.' }
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevado')
  exit 0
}

function Mostrar([string] $texto, [string] $icone = 'Information') {
  [System.Windows.MessageBox]::Show($texto, 'OS Já — Liberar celulares', 'OK', $icone) | Out-Null
}

try {
  $config = Join-Path $env:ProgramData 'GestaoOS\config.env'
  if (-not (Test-Path $config)) { throw "Configuração não encontrada em $config. O OS Já está instalado?" }
  $linhas = [Collections.Generic.List[string]](Get-Content $config -Encoding UTF8)

  function Valor([string] $chave) {
    foreach ($l in $linhas) { if ($l -match "^\s*$chave\s*=\s*`"?(.*?)`"?\s*$") { return $Matches[1] } }
    return ''
  }
  function Definir([string] $chave, [string] $valor) {
    for ($i = 0; $i -lt $linhas.Count; $i++) {
      if ($linhas[$i] -match "^\s*$chave\s*=") { $linhas[$i] = "$chave=$valor"; return }
    }
    $linhas.Add("$chave=$valor")
  }

  $usuario = Valor 'APP_USUARIO'
  $senha = Valor 'APP_SENHA'
  $novaSenha = $false
  if (-not $usuario -or -not $senha) {
    $usuario = 'oficina'
    $letras = [char[]]'abcdefghjkmnpqrstuvwxyz23456789'
    $bytes = New-Object byte[] 8
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $senha = -join ($bytes | ForEach-Object { $letras[$_ % $letras.Length] })
    Definir 'APP_USUARIO' $usuario
    Definir 'APP_SENHA' $senha
    $novaSenha = $true
  }
  Definir 'HOST' '0.0.0.0'
  [IO.File]::WriteAllLines($config, $linhas, (New-Object Text.UTF8Encoding $false))

  $porta = [int](Valor 'PORT')
  if (-not $porta) { $porta = 7300 }
  Get-NetFirewallRule -DisplayName 'OS Já (celulares)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName 'OS Já (celulares)' -Direction Inbound -Protocol TCP -LocalPort $porta `
    -Action Allow -Profile Private | Out-Null

  Restart-Service GestaoOS
  for ($i = 0; $i -lt 30; $i++) {
    try { if ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$porta/api/saude" -TimeoutSec 2).StatusCode -eq 200) { break } } catch { Start-Sleep 1 }
  }

  $redePublica = Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Public'
  $aviso = if ($redePublica) {
    "`n`nATENÇÃO: a rede '$($redePublica[0].Name)' está como PÚBLICA no Windows. Os celulares só conseguem acessar se ela for PRIVADA (Configurações > Rede e Internet > Propriedades da rede)."
  } else { '' }
  $credenciais = if ($novaSenha) { "Usuário: $usuario`nSenha: $senha`n(anote — os celulares vão pedir)" } else { "Usuário e senha: os que já estavam no config.env (usuário: $usuario)" }

  Start-Process "http://localhost:$porta/#/equipe"
  Mostrar "Celulares liberados!`n`n$credenciais`n`nNa tela Equipe que abriu no navegador há um QR code para os mecânicos escanearem.$aviso"
} catch {
  Mostrar "Não foi possível liberar os celulares:`n`n$($_.Exception.Message)" 'Error'
  exit 1
}
