@echo off
:: IORA Dev Runner — Start interactive development manager
:: Requires Node.js >= 18
cd /d "%~dp0.."
node dev\iora-dev.mjs %*
