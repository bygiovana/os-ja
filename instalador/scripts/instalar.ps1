# Configuração pós-instalação da Gestão de OS. Executado pelo .msi como SYSTEM.
# Idempotente: numa atualização reaproveita banco e configuração existentes.
param(
  [Parameter(Mandatory)] [string] $PastaInstalacao,
  [string] $NomeOficina = 'Minha Oficina',
  [int] $Porta = 7300,
  [string] $PastaDados = (Join-Path $env:ProgramData 'GestaoOS')
)

$ErrorActionPreference = 'Stop'
$PastaInstalacao = $PastaInstalacao.TrimEnd('\')
$PortaBanco = 55433
$ServicoBanco = 'GestaoOS-Banco'
$ServicoApp = 'GestaoOS'
$Rede = 'NT AUTHORITY\NetworkService'

$pgBin = Join-Path $PastaInstalacao 'pgsql\bin'
$pgData = Join-Path $PastaDados 'banco'
$logs = Join-Path $PastaDados 'logs'
$config = Join-Path $PastaDados 'config.env'

New-Item -ItemType Directory -Force $PastaDados, $logs, (Join-Path $PastaDados 'backups') | Out-Null
Start-Transcript -Path (Join-Path $logs 'instalacao.log') -Append | Out-Null

function Escrever-SemBom([string] $caminho, [string] $texto) {
  [IO.File]::WriteAllText($caminho, $texto, (New-Object Text.UTF8Encoding $false))
}

function Senha-Aleatoria([int] $tamanho = 32) {
  $letras = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $bytes = New-Object byte[] $tamanho
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $letras[$_ % $letras.Length] })
}

function Ler-Config {
  $valores = @{}
  foreach ($linha in Get-Content $config -Encoding UTF8) {
    if ($linha -match '^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$') { $valores[$Matches[1]] = $Matches[2] }
  }
  $valores
}

function Executar([string] $exe, [string[]] $argumentos) {
  & $exe @argumentos
  if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($exe)) terminou com código $LASTEXITCODE" }
}

function Servico-Existe([string] $nome) { [bool](Get-Service -Name $nome -ErrorAction SilentlyContinue) }

try {
  Write-Host "Instalando Gestão de OS em $PastaInstalacao (dados em $PastaDados)"

  # Permissões: só SYSTEM, Administradores e o serviço (NetworkService) acessam os dados.
  # SIDs em vez de nomes porque o Windows em português traduz os nomes dos grupos.
  Executar icacls.exe @($PastaDados, '/inheritance:r', '/grant:r',
    '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-20:(OI)(CI)M', '/T', '/Q')

  # 1. Configuração (criada só na primeira vez)
  if (-not (Test-Path $config)) {
    $senhaBanco = Senha-Aleatoria
    $nome = ($NomeOficina -replace '[\r\n"]', '').Trim()
    if (-not $nome) { $nome = 'Minha Oficina' }
    Escrever-SemBom $config @"
# Configuração da Gestão de OS. Depois de alterar, reinicie o serviço "Gestão de OS"
# (services.msc) ou rode no PowerShell como administrador:  Restart-Service GestaoOS

DATABASE_URL=postgres://oficina:$senhaBanco@127.0.0.1:$PortaBanco/oficina
PORT=$Porta

# 127.0.0.1 = só este computador acessa. Para liberar outros computadores da rede,
# troque por 0.0.0.0, defina usuário e senha abaixo e libere a porta no firewall.
HOST=127.0.0.1

OFICINA_NOME="$nome"
OFICINA_DADOS=""

APP_USUARIO=
APP_SENHA=

FUSO_HORARIO=America/Sao_Paulo
"@
    Write-Host 'Configuração criada.'
  }
  $cfg = Ler-Config
  $senhaBanco = ([uri]$cfg['DATABASE_URL']).UserInfo.Split(':')[1]

  # 2. Banco de dados (criado só na primeira vez)
  if (-not (Test-Path (Join-Path $pgData 'PG_VERSION'))) {
    Write-Host 'Criando banco de dados...'
    $arquivoSenha = Join-Path $PastaDados 'senha-temp.txt'
    Escrever-SemBom $arquivoSenha $senhaBanco
    try {
      Executar (Join-Path $pgBin 'initdb.exe') @('-D', $pgData, '-U', 'oficina', '-A', 'scram-sha-256',
        "--pwfile=$arquivoSenha", '-E', 'UTF8', '--locale=C')
    } finally {
      Remove-Item $arquivoSenha -Force -ErrorAction SilentlyContinue
    }
    $logBanco = ($logs -replace '\\', '/')
    Add-Content -Path (Join-Path $pgData 'postgresql.conf') -Encoding ASCII -Value @"

# --- Gestão de OS ---
port = $PortaBanco
listen_addresses = 'localhost'
timezone = 'America/Sao_Paulo'
logging_collector = on
log_directory = '$logBanco'
log_filename = 'banco-%a.log'
log_truncate_on_rotation = on
log_rotation_age = 1d
"@
    # o serviço do banco roda como NetworkService e precisa ser dono dos arquivos
    Executar icacls.exe @($pgData, '/grant:r', '*S-1-5-20:(OI)(CI)F', '/T', '/Q')
  }

  # 3. Serviço do banco
  if (-not (Servico-Existe $ServicoBanco)) {
    Executar (Join-Path $pgBin 'pg_ctl.exe') @('register', '-N', $ServicoBanco, '-U', $Rede,
      '-D', $pgData, '-S', 'auto', '-w')
  }
  Executar sc.exe @('description', $ServicoBanco, 'Banco de dados PostgreSQL da Gestão de OS')
  Executar sc.exe @('failure', $ServicoBanco, 'reset=', '86400', 'actions=', 'restart/10000/restart/30000/restart/60000')
  Start-Service $ServicoBanco
  $pronto = $false
  for ($i = 0; $i -lt 60 -and -not $pronto; $i++) {
    & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p $PortaBanco -q
    if ($LASTEXITCODE -eq 0) { $pronto = $true } else { Start-Sleep 1 }
  }
  if (-not $pronto) { throw 'O banco de dados não respondeu a tempo. Veja os logs em ' + $logs }

  $env:PGPASSWORD = $senhaBanco
  $existe = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $PortaBanco -U oficina -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'oficina'"
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível conectar ao banco de dados.' }
  if ("$existe".Trim() -ne '1') {
    Executar (Join-Path $pgBin 'createdb.exe') @('-h', '127.0.0.1', '-p', "$PortaBanco", '-U', 'oficina', 'oficina')
    Write-Host 'Base "oficina" criada.'
  }
  Remove-Item Env:PGPASSWORD

  # 4. Serviço do sistema (WinSW executa o Node.js como serviço do Windows)
  $winsw = Join-Path $PastaInstalacao 'servico\GestaoOS.exe'
  if (-not (Servico-Existe $ServicoApp)) { Executar $winsw @('install') }
  # roda como NetworkService (sem privilégios de administrador). Via CIM porque o PowerShell 5.1
  # descarta argumentos vazios ao chamar o sc.exe ("password= ''").
  $alterado = Get-CimInstance Win32_Service -Filter "Name='$ServicoApp'" |
    Invoke-CimMethod -MethodName Change -Arguments @{ StartName = $Rede; StartPassword = '' }
  if ($alterado.ReturnValue -ne 0) { throw "Não foi possível definir a conta do serviço (código $($alterado.ReturnValue))" }
  Executar sc.exe @('failure', $ServicoApp, 'reset=', '86400', 'actions=', 'restart/10000/restart/30000/restart/60000')
  Start-Service $ServicoApp

  # 5. Confere se o sistema respondeu (não desfaz a instalação se demorar)
  $portaApp = [int]$cfg['PORT']
  $ok = $false
  for ($i = 0; $i -lt 45 -and -not $ok; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$portaApp/api/saude" -TimeoutSec 3
      $ok = $r.StatusCode -eq 200
    } catch { Start-Sleep 1 }
  }
  if ($ok) { Write-Host "Gestão de OS no ar em http://localhost:$portaApp" }
  else { Write-Warning "O serviço foi instalado mas ainda não respondeu. Veja $logs" }
  exit 0
} catch {
  Write-Error $_
  exit 1
} finally {
  Stop-Transcript | Out-Null
}
