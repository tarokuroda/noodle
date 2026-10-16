@echo off
rem Double-click this file to start Noodle. The first time it sets itself up, which takes a few minutes.
if not exist "%~dp0start.ps1" (
  echo.
  echo   Noodle needs to be unzipped first.
  echo   Right-click the Noodle zip file, choose "Extract All...", then open the
  echo   extracted folder and double-click "Start Noodle" again.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
