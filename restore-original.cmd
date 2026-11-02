@echo off
setlocal
python.exe "%~dp0inject.py" --restore %*
set "WRITEFOLD_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %WRITEFOLD_EXIT%
