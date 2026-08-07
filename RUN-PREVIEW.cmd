@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Vesper] Node.js/npm was not found.
  echo Install Node.js 22 or newer, then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\.vesper-deps-0.3.1" (
  echo.
  echo [Vesper] Installing launcher dependencies for the first run...
  call npm ci
  if errorlevel 1 (
    echo.
    echo [Vesper] Dependency installation failed.
    pause
    exit /b 1
  )
  >"node_modules\.vesper-deps-0.3.1" echo ready
)

echo.
echo [Vesper] Starting launcher...
call npm start
if errorlevel 1 (
  echo.
  echo [Vesper] The launcher exited with an error.
  pause
  exit /b 1
)

endlocal
