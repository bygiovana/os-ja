@echo off
rem Inicia o OS Ja (servicos do Windows instalados pelo .msi) e abre no navegador.
setlocal
set URL=http://localhost:7300

sc query GestaoOS >nul 2>&1
if errorlevel 1 (
  echo O OS Ja ainda nao esta instalado neste computador.
  echo Rode o instalador GestaoOS-x.y.z.msi primeiro - ele fica em instalador\saida
  echo ou na pagina de Releases do GitHub. Para gerar o .msi, use gerar-instalador.bat
  pause
  exit /b 1
)

sc query GestaoOS | find "RUNNING" >nul
if errorlevel 1 (
  echo Iniciando o OS Ja... confirme como administrador se o Windows pedir.
  powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command Start-Service GestaoOS-Banco; Start-Service GestaoOS'"
)

echo Aguardando o sistema responder...
powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){try{if((Invoke-WebRequest -UseBasicParsing '%URL%/api/saude' -TimeoutSec 2).StatusCode -eq 200){exit 0}}catch{};Start-Sleep 1};exit 1"
if errorlevel 1 (
  echo O sistema nao respondeu. Veja os logs em C:\ProgramData\GestaoOS\logs
  pause
  exit /b 1
)
start "" %URL%
