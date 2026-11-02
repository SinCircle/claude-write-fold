@echo off
setlocal
where python.exe >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 or newer is required. Please install Python first.
  pause
  exit /b 1
)
python.exe "%~dp0inject.py" --launch -- %*
exit /b %ERRORLEVEL%
