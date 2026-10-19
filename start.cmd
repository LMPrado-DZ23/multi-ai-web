@echo off
setlocal
cd /d "%~dp0"
if not exist config.json (
  copy config.example.json config.json >nul
  echo Created config.json from config.example.json. Start your bridges, then rerun this script.
)
node src\index.mjs check --config config.json || exit /b 1
node src\index.mjs serve --config config.json
