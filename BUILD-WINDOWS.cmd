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

echo.
echo [Vesper] Installing locked dependencies...
call npm ci
if errorlevel 1 (
  echo.
  echo [Vesper] Dependency installation failed.
  pause
  exit /b 1
)

echo.
echo [Vesper] Building Windows installer...
call npm run dist:win
if errorlevel 1 (
  echo.
  echo [Vesper] Windows build failed.
  pause
  exit /b 1
)

echo.
echo [Vesper] Build complete. Opening the dist folder.
start "" "%~dp0dist"
endlocal
