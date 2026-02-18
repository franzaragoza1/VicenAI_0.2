@echo off
title Telemetry Lab - Launcher

echo.
echo ========================================
echo    🚀 TELEMETRY LAB LAUNCHER 🚀
echo ========================================
echo.

REM Verificar si estamos en el directorio correcto
if not exist "package.json" (
    echo ❌ Error: Ejecuta este archivo desde el directorio TELEMETRY-LAB
    pause
    exit /b 1
)

echo 📦 Verificando PowerShell...

REM Verificar si PowerShell está disponible
powershell -Command "Write-Host '✅ PowerShell disponible'" >nul 2>&1
if errorlevel 1 (
    echo ❌ PowerShell no encontrado
    pause
    exit /b 1
)

echo 🚀 Ejecutando script principal...
echo.

REM Ejecutar el script de PowerShell
powershell -ExecutionPolicy Bypass -File "start-telemetry-lab.ps1"

echo.
echo 🏁 Telemetry Lab cerrado
pause