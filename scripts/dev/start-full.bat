@echo off
REM IORA Full Dev Mode - Windows Launcher
REM Starts both Vite dev server and iora-home backend

echo Starting IORA Full Development Mode...
node "%~dp0start-full.mjs" %*
