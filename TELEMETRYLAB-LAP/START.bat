@echo off
echo ========================================
echo TELEMETRY-LAB2 - Iniciando sistema
echo ========================================
echo.
echo [1] Iniciando backend (iRacing WebSocket Bridge)...
start "Backend" cmd /k "cd backend && py irsdk_bridge.py"
timeout /t 3 /nobreak >nul

echo [2] Iniciando frontend (React + Vite)...
cd frontend
start "Frontend" cmd /k "npm run dev"

echo.
echo [OK] Sistema iniciado
echo.
echo Backend:  http://localhost:8887
echo Frontend: http://localhost:5173
echo.
echo Presiona cualquier tecla para salir...
pause >nul
