@echo off
REM SCM BPO - start backend (FastAPI :8000) and frontend (Next.js :3001)
cd /d "%~dp0"
start "SCM-BPO Backend :8000" C:\Python314\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
cd /d "%~dp0frontend"
start "SCM-BPO Frontend :3001" C:\Program Files\nodejs\node.exe "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev -- -p 3001
echo Started backend (:8000) and frontend (:3001) in separate windows.
echo Open http://localhost:3001 in your browser.
