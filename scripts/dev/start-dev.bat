@echo off
:: rumahl Dev Runner — Start interactive development manager
:: Requires Node.js >= 18
cd /d "%~dp0.."
node dev\rumahl-dev.mjs %*
