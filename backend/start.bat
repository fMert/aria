@echo off
set PORT=8000
if not "%ARIA_PORT%"=="" set PORT=%ARIA_PORT%
cd /d "%~dp0"
python -m uvicorn main:app --host 127.0.0.1 --port %PORT%
