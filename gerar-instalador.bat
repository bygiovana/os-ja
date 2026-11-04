@echo off
rem Gera o instalador Windows (.msi) do OS Ja em instalador\saida
rem Requisitos: Windows 64 bits, Node.js 20+ e .NET SDK 8+
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File instalador\build.ps1 %*
echo.
if errorlevel 1 (echo Falhou. Veja as mensagens acima.) else (echo Instalador gerado em instalador\saida)
pause
