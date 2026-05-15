@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0code-opencode-dev.ps1" %*
set EXIT_CODE=%ERRORLEVEL%

endlocal & exit /b %EXIT_CODE%
