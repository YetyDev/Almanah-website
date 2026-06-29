@echo off
title Almana Website Server Launcher
echo ==================================================
echo Starting Almana Outreach Foundation Website...
echo ==================================================
cd /d "%~dp0"

echo.
echo [1/3] Checking Node.js installation...
set "NODE_EXE="
set "NPM_CMD="

where node >nul 2>&1
if %errorlevel% equ 0 (
    set "NODE_EXE=node"
    set "NPM_CMD=npm"
) else if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe"
    set "NPM_CMD=C:\Program Files (x86)\nodejs\npm.cmd"
) else if exist "%USERPROFILE%\AppData\Local\Programs\node\node.exe" (
    set "NODE_EXE=%USERPROFILE%\AppData\Local\Programs\node\node.exe"
    set "NPM_CMD=%USERPROFILE%\AppData\Local\Programs\node\npm.cmd"
) else if exist "%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe" (
    set "NODE_EXE=%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe"
    set "NPM_CMD=%USERPROFILE%\AppData\Local\Programs\nodejs\npm.cmd"
) else if exist "%USERPROFILE%\node\node.exe" (
    set "NODE_EXE=%USERPROFILE%\node\node.exe"
    set "NPM_CMD=%USERPROFILE%\node\npm.cmd"
) else if exist "%USERPROFILE%\nodejs\node.exe" (
    set "NODE_EXE=%USERPROFILE%\nodejs\node.exe"
    set "NPM_CMD=%USERPROFILE%\nodejs\npm.cmd"
)


if "%NODE_EXE%"=="" (
    echo.
    echo ❌ ERROR: Node.js was not found in PATH or standard Program Files!
    echo.
    echo Please download and install Node.js from https://nodejs.org/ before launching.
    echo.
    echo Opening https://nodejs.org/ in your browser...
    start https://nodejs.org/
    pause
    exit /b
)

echo.
echo [2/3] Installing website dependencies (please wait)...
call "%NPM_CMD%" install

echo.
echo [3/3] Launching Node.js Express server...
echo.
echo ==================================================
echo Server is launching. Keep this window OPEN!
echo ==================================================
echo.

:: Open the browser to the website
start "" http://localhost:3000/

:: Start the server
call "%NODE_EXE%" server.js

pause
