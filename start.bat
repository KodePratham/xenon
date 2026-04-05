@echo off
title Xenon Ventilation Studio
echo.
echo ===================================
echo   Xenon Ventilation Studio
echo ===================================
echo.

REM Kill anything on port 5500
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5500" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)
REM Kill anything on port 8000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo Starting Backend API (port 8000)...
start "Xenon Backend" cmd /k "cd xenon-backend && python -m uvicorn api:app --reload --port 8000"

echo Starting Vite dev server (port 5500)...
echo.
echo DO NOT close this window while using the app.
echo Press Ctrl+C to stop the server.
echo.

cd xenon-frontend && npx vite --port 5500

pause
