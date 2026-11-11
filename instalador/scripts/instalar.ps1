# Configuração pós-instalação do OS Já. Executado pelo .msi como SYSTEM.
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

# O log nunca pode impedir a instalação: se o arquivo não abrir, usa outro nome ou segue sem log.
function Iniciar-Log {
  foreach ($nome in 'instalacao.log', ('instalacao-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))) {
    try { Start-Transcript -Path (Join-Path $logs $nome) -Append -ErrorAction Stop | Out-Null; return $true }
    catch { Write-Warning "Não foi possível gravar o log em ${nome}: $($_.Exception.Message)" }
  }
  $false
}

$comLog = $false
try {
  # Permissões: só SYSTEM, Administradores e o serviço (NetworkService) acessam os dados.
  # SIDs em vez de nomes porque o Windows em português traduz os nomes dos grupos.
  # As permissões ficam SÓ na pasta raiz e todo o conteúdo herda dela. Não use /T com
  # /inheritance:r: nos arquivos as flags (OI)(CI) não valem e eles ficam sem permissão nenhuma
  # (foi o que travou a reinstalação da 0.2.0: config.env, banco e logs inacessíveis até p/ SYSTEM).
  Executar icacls.exe @($PastaDados, '/inheritance:r', '/grant:r',
    '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-20:(OI)(CI)M', '/Q')
  if (Get-ChildItem $PastaDados -Force | Select-Object -First 1) {
    # arquivos criados pelos serviços têm o NetworkService como dono: Administradores assumem
    # a posse para poder refazer as permissões, depois tudo volta a herdar da raiz.
    # takeown (privilégio de tomar posse) e não "icacls /setowner", que exige SeRestorePrivilege
    # e falha dentro do instalador. Sem /D: as pastas continuam legíveis, não há pergunta.
    & takeown.exe /F $PastaDados /R /A | Out-Null
    & icacls.exe "$PastaDados\*" /reset /T /C /Q
    if ($LASTEXITCODE -ne 0) { Write-Warning "Alguns arquivos em $PastaDados não tiveram as permissões refeitas (código $LASTEXITCODE)." }
  }
  # o serviço do banco roda como NetworkService e precisa de controle total em banco\ (herdado)
  if (Test-Path $pgData) { Executar icacls.exe @($pgData, '/grant:r', '*S-1-5-20:(OI)(CI)F', '/Q') }

  # o log só abre depois de acertar as permissões, para não mexer num arquivo em uso
  $comLog = Iniciar-Log
  Write-Host "Instalando OS Já em $PastaInstalacao (dados em $PastaDados)"

  # 1. Configuração (criada só na primeira vez)
  if (-not (Test-Path $config)) {
    $senhaBanco = Senha-Aleatoria
    $nome = ($NomeOficina -replace '[\r\n"]', '').Trim()
    if (-not $nome) { $nome = 'Minha Oficina' }
    Escrever-SemBom $config @"
# Configuração do OS Já. Depois de alterar, reinicie o serviço "OS Já"
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

# --- OS Já ---
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
    Executar icacls.exe @($pgData, '/grant:r', '*S-1-5-20:(OI)(CI)F', '/Q')
  }

  # 3. Serviço do banco
  if (-not (Servico-Existe $ServicoBanco)) {
    Executar (Join-Path $pgBin 'pg_ctl.exe') @('register', '-N', $ServicoBanco, '-U', $Rede,
      '-D', $pgData, '-S', 'auto', '-w')
  }
  Executar sc.exe @('description', $ServicoBanco, 'Banco de dados PostgreSQL do OS Já')
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

  $portaApp = [int]$cfg['PORT']

  # Celulares já liberados (HOST=0.0.0.0 pelo "Liberar celulares"): a desinstalação/atualização
  # remove a regra do firewall, então ela é recriada aqui — só para redes PRIVADAS.
  if ($cfg['HOST'] -eq '0.0.0.0') {
    try {
      Get-NetFirewallRule -DisplayName 'OS Já (celulares)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
      New-NetFirewallRule -DisplayName 'OS Já (celulares)' -Direction Inbound -Protocol TCP -LocalPort $portaApp `
        -Action Allow -Profile Private | Out-Null
      Write-Host "Firewall: porta $portaApp liberada para redes privadas (celulares)."
    } catch { Write-Warning "Não foi possível liberar a porta no firewall: $($_.Exception.Message)" }
  }

  # 5. Confere se o sistema respondeu (não desfaz a instalação se demorar)
  $ok = $false
  for ($i = 0; $i -lt 45 -and -not $ok; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$portaApp/api/saude" -TimeoutSec 3
      $ok = $r.StatusCode -eq 200
    } catch { Start-Sleep 1 }
  }
  if ($ok) { Write-Host "OS Já no ar em http://localhost:$portaApp" }
  else { Write-Warning "O serviço foi instalado mas ainda não respondeu. Veja $logs" }
  exit 0
} catch {
  Write-Error $_
  exit 1
} finally {
  if ($comLog) { try { Stop-Transcript | Out-Null } catch { } }
}
