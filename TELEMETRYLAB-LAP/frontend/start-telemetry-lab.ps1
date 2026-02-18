# Telemetry Lab - Script de Inicio
# Ejecuta frontend + bridge UDP→WebSocket

Write-Host "Iniciando Telemetry Lab..." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan

# Verificar que estamos en el directorio correcto
if (!(Test-Path "package.json")) {
    Write-Host "❌ Error: Ejecuta este script desde el directorio TELEMETRY-LAB" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

Write-Host "Verificando dependencias..." -ForegroundColor Yellow

# Verificar Node.js
try {
    $nodeVersion = node --version
    Write-Host "Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js no encontrado. Instala Node.js primero." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

# Verificar módulo ws
if (!(Test-Path "node_modules\ws")) {
    Write-Host "⬇️ Instalando dependencia ws..." -ForegroundColor Yellow
    npm install ws
}

Write-Host "`n🚀 Iniciando servicios..." -ForegroundColor Green

# Función para manejar Ctrl+C
$ctrlCHandler = {
    Write-Host "`n`n🛑 Deteniendo servicios..." -ForegroundColor Yellow
    
    # Matar procesos de Node.js relacionados
    Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.MainWindowTitle -eq "" -or $_.ProcessName -eq "node") {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
    
    Write-Host "✅ Servicios detenidos" -ForegroundColor Green
    exit 0
}

# Registrar el manejador Ctrl+C
[Console]::TreatControlCAsInput = $false
[Console]::CancelKeyPress += $ctrlCHandler

try {
    # Iniciar Bridge UDP→WebSocket en segundo plano
    Write-Host "🌉 Iniciando UDP→WebSocket Bridge..." -ForegroundColor Cyan
    $bridgeJob = Start-Job -ScriptBlock {
        Set-Location $using:PWD
        node udp-websocket-bridge.cjs
    }
    
    # Esperar un momento para que el bridge se inicie
    Start-Sleep -Seconds 2
    
    # Verificar que el bridge se inició correctamente
    if ($bridgeJob.State -eq "Running") {
        Write-Host "✅ Bridge ejecutándose (Job ID: $($bridgeJob.Id))" -ForegroundColor Green
    } else {
        Write-Host "❌ Error iniciando bridge" -ForegroundColor Red
        Receive-Job $bridgeJob
        Remove-Job $bridgeJob -Force
        exit 1
    }
    
    Write-Host "🌐 Iniciando Frontend (Vite)..." -ForegroundColor Cyan
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "🎮 URLS IMPORTANTES:" -ForegroundColor White
    Write-Host "   Frontend:     http://localhost:5173" -ForegroundColor Green  
    Write-Host "   WebSocket:    ws://localhost:8887" -ForegroundColor Green
    Write-Host "   UDP Bridge:   127.0.0.1:9999" -ForegroundColor Green
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "📋 INSTRUCCIONES:" -ForegroundColor White
    Write-Host "   1. Ejecuta tu plugin C# de SimHub" -ForegroundColor Yellow
    Write-Host "   2. Ve a http://localhost:5173" -ForegroundColor Yellow  
    Write-Host "   3. Cambia a modo 'Live (rojo)'" -ForegroundColor Yellow
    Write-Host "   4. ¡Deberías ver datos en tiempo real!" -ForegroundColor Yellow
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "💡 Presiona Ctrl+C para detener todo" -ForegroundColor White
    Write-Host ""
    
    # Ejecutar frontend en primer plano (para ver logs de Vite)
    npm run dev
    
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
} finally {
    # Limpiar trabajos en segundo plano
    Write-Host "`n🧹 Limpiando procesos..." -ForegroundColor Yellow
    
    if ($bridgeJob) {
        Stop-Job $bridgeJob -ErrorAction SilentlyContinue
        Remove-Job $bridgeJob -Force -ErrorAction SilentlyContinue
    }
    
    # Asegurar que no queden procesos Node.js colgando
    Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.MainWindowTitle -eq "" -or $_.ProcessName -eq "node") {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
    
    Write-Host "✅ Limpieza completada" -ForegroundColor Green
}