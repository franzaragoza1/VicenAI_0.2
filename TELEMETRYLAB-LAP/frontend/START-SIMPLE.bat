@echo off
title Telemetry Lab Launcher

echo.
echo ========================================  
echo     TELEMETRY LAB - INICIO SIMPLE
echo ========================================
echo.

echo Iniciando Bridge UDP-WebSocket...
start /B node udp-websocket-bridge.cjs

timeout /t 3 /nobreak >nul

echo.
echo Iniciando Frontend...
echo.
echo URLS IMPORTANTES:
echo   Frontend:     http://localhost:5173
echo   WebSocket:    ws://localhost:8887  
echo   UDP Bridge:   127.0.0.1:9999
echo.
echo INSTRUCCIONES:
echo   1. Ejecuta tu plugin C# de SimHub
echo   2. Ve a http://localhost:5173
echo   3. Cambia a modo Live (rojo)
echo   4. Deberas ver datos en tiempo real
echo.
echo Presiona Ctrl+C para detener todo
echo.

npm run dev