@echo off
setlocal
where python.exe >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 or newer is required. Please install Python first.
  pause
  exit /b 1
)
python.exe "%~dp0inject.py" --update --install %*
set "WRITEFOLD_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %WRITEFOLD_EXIT%
