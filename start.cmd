@echo off
rem Starts Alpha-Sales and restarts it after an in-app update (exit code 75).
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages...
  call npm install || exit /b 1
)
:loop
node src\cli.js start %*
if %ERRORLEVEL%==75 goto loop
