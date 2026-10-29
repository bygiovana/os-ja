# Gera o instalador Windows (.msi) da Gestão de OS.
# Requisitos: Windows 64 bits, Node.js 20+ (com npm) e .NET SDK 8+ (para o WiX Toolset).
# Uso (na raiz do projeto):  powershell -ExecutionPolicy Bypass -File instalador\build.ps1
# Resultado: instalador\saida\GestaoOS-<versão>.msi
param(
  [string] $Versao,
  [switch] $ManterStage
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$VersaoNode = '22.21.1'
$UrlPostgres = 'https://get.enterprisedb.com/postgresql/postgresql-16.11-1-windows-x64-binaries.zip'
$UrlWinSW = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$VersaoWix = '5.0.2'

$instalador = $PSScriptRoot
$raiz = Split-Path $instalador -Parent
$vendor = Join-Path $instalador 'vendor'
$stage = Join-Path $instalador 'stage'
$saida = Join-Path $instalador 'saida'

function Passo([string] $msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Executar([string] $exe, [string[]] $argumentos) {
  & $exe @argumentos
  if ($LASTEXITCODE -ne 0) { throw "$exe $($argumentos -join ' ') falhou (código $LASTEXITCODE)" }
}
function Baixar([string] $url, [string] $destino) {
  if (Test-Path $destino) { return }
  Write-Host "Baixando $url"
  Invoke-WebRequest -UseBasicParsing $url -OutFile "$destino.part"
  Move-Item -Force "$destino.part" $destino
}
function Copiar-ComBom([string] $origem, [string] $destino) {
  # PowerShell 5.1 lê .ps1 sem BOM como ANSI e estraga os acentos
  $texto = [IO.File]::ReadAllText($origem, [Text.Encoding]::UTF8)
  [IO.File]::WriteAllText($destino, $texto, (New-Object Text.UTF8Encoding $true))
}

if (-not $Versao) { $Versao = (Get-Content (Join-Path $raiz 'package.json') -Raw | ConvertFrom-Json).version }
if ($Versao -notmatch '^\d+\.\d+\.\d+$') { throw "Versão inválida para MSI: $Versao (use X.Y.Z)" }

# ---------------------------------------------------------------------------
Passo 'Baixando componentes (ficam em instalador\vendor para os próximos builds)'
New-Item -ItemType Directory -Force $vendor | Out-Null

$zipNode = Join-Path $vendor "node-v$VersaoNode-win-x64.zip"
Baixar "https://nodejs.org/dist/v$VersaoNode/node-v$VersaoNode-win-x64.zip" $zipNode
$somas = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/v$VersaoNode/SHASUMS256.txt").Content
$esperado = ($somas -split "`n" | Where-Object { $_ -match "node-v$VersaoNode-win-x64\.zip$" }) -split '\s+' | Select-Object -First 1
$obtido = (Get-FileHash $zipNode -Algorithm SHA256).Hash
if ($obtido -ne $esperado.ToUpper()) { Remove-Item $zipNode; throw "Checksum do Node.js não confere (esperado $esperado, obtido $obtido)" }
Write-Host 'Node.js: checksum SHA-256 conferido.'

$zipPg = Join-Path $vendor ([IO.Path]::GetFileName($UrlPostgres))
Baixar $UrlPostgres $zipPg
$exeWinSW = Join-Path $vendor 'WinSW-x64.exe'
Baixar $UrlWinSW $exeWinSW

# ---------------------------------------------------------------------------
Passo 'Compilando o sistema'
Push-Location $raiz
try {
  if (Test-Path 'package-lock.json') { Executar npm.cmd @('ci', '--no-audit', '--no-fund') }
  else { Executar npm.cmd @('install', '--no-audit', '--no-fund') }
  Executar npm.cmd @('run', 'build')
} finally { Pop-Location }

# ---------------------------------------------------------------------------
Passo 'Montando a pasta do instalador'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
$app = Join-Path $stage 'app'
New-Item -ItemType Directory -Force $app, (Join-Path $stage 'node'), (Join-Path $stage 'servico'), (Join-Path $stage 'scripts') | Out-Null

Copy-Item -Recurse (Join-Path $raiz 'dist') $app
Copy-Item -Recurse (Join-Path $raiz 'public') $app
Copy-Item (Join-Path $raiz 'package.json') $app
if (Test-Path (Join-Path $raiz 'package-lock.json')) { Copy-Item (Join-Path $raiz 'package-lock.json') $app }
Get-ChildItem $app -Recurse -Filter '*.map' | Remove-Item
Push-Location $app
try {
  if (Test-Path 'package-lock.json') { Executar npm.cmd @('ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts') }
  else { Executar npm.cmd @('install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts') }
} finally { Pop-Location }

# Node.js: só o executável e a licença
$tmpNode = Join-Path $env:TEMP "gestaoos-node-$PID"
Expand-Archive -Force $zipNode $tmpNode
$pastaNode = Join-Path $tmpNode "node-v$VersaoNode-win-x64"
Copy-Item (Join-Path $pastaNode 'node.exe'), (Join-Path $pastaNode 'LICENSE') (Join-Path $stage 'node')
Remove-Item -Recurse -Force $tmpNode

# PostgreSQL: binários, bibliotecas e share (sem pgAdmin, StackBuilder, docs e símbolos)
$tmpPg = Join-Path $env:TEMP "gestaoos-pg-$PID"
Expand-Archive -Force $zipPg $tmpPg
$pastaPg = Join-Path $stage 'pgsql'
New-Item -ItemType Directory -Force $pastaPg | Out-Null
foreach ($sub in 'bin', 'lib', 'share') { Move-Item (Join-Path $tmpPg "pgsql\$sub") $pastaPg }
Get-ChildItem $pastaPg -Recurse -Include 'stackbuilder*', '*.pdb' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem (Join-Path $pastaPg 'lib') -Filter '*.lib' | Remove-Item -Force
Remove-Item -Recurse -Force $tmpPg

Copy-Item $exeWinSW (Join-Path $stage 'servico\GestaoOS.exe')
Copy-Item (Join-Path $instalador 'servico\GestaoOS.xml') (Join-Path $stage 'servico')
foreach ($ps1 in Get-ChildItem (Join-Path $instalador 'scripts') -Filter '*.ps1') {
  Copiar-ComBom $ps1.FullName (Join-Path $stage "scripts\$($ps1.Name)")
}
Copy-Item (Join-Path $instalador 'icone.ico') $stage
Copy-Item (Join-Path $instalador 'LEIA-ME.txt') $stage

$tamanho = (Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("Conteúdo: {0:N0} MB em {1} arquivos" -f $tamanho, (Get-ChildItem $stage -Recurse -File).Count)

# ---------------------------------------------------------------------------
Passo "Gerando o MSI com WiX $VersaoWix"
$ferramentas = Join-Path $env:USERPROFILE '.dotnet\tools'
if ($env:Path -notlike "*$ferramentas*") { $env:Path = "$ferramentas;$env:Path" }
$wixAtual = (& dotnet tool list -g) | Select-String '^wix\s+(\S+)' | ForEach-Object { $_.Matches[0].Groups[1].Value }
if ($wixAtual -ne $VersaoWix) {
  if ($wixAtual) { Executar dotnet @('tool', 'uninstall', '-g', 'wix') }
  Executar dotnet @('tool', 'install', '-g', 'wix', '--version', $VersaoWix)
}
Executar wix @('extension', 'add', '-g', "WixToolset.Util.wixext/$VersaoWix")
Executar wix @('extension', 'add', '-g', "WixToolset.UI.wixext/$VersaoWix")

New-Item -ItemType Directory -Force $saida | Out-Null
$msi = Join-Path $saida "GestaoOS-$Versao.msi"
Push-Location $instalador
try {
  Executar wix @('build', 'Produto.wxs', '-arch', 'x64',
    '-ext', 'WixToolset.Util.wixext', '-ext', 'WixToolset.UI.wixext',
    '-culture', 'pt-BR', '-bindpath', "Stage=$stage", '-d', "Versao=$Versao",
    '-o', $msi)
} finally { Pop-Location }

if (-not $ManterStage) { Remove-Item -Recurse -Force $stage }
Remove-Item (Join-Path $saida '*.wixpdb') -ErrorAction SilentlyContinue
$hash = (Get-FileHash $msi -Algorithm SHA256).Hash
Set-Content -Encoding ASCII "$msi.sha256" "$hash  $([IO.Path]::GetFileName($msi))"
Passo ("Pronto: {0} ({1:N0} MB)" -f $msi, ((Get-Item $msi).Length / 1MB))
Write-Host "SHA-256: $hash"
