@echo off
rem Starts Local Chat at http://127.0.0.1:8765
rem First run: creates the Python environment and builds the React frontend.
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
  echo Creating Python environment...
  python -m venv .venv || goto :fail
)
.venv\Scripts\python.exe -m pip install --disable-pip-version-check -q -r requirements.txt || goto :fail

if not exist frontend\dist\index.html (
  where npm >nul 2>nul || (echo Node.js is needed to build the frontend: https://nodejs.org & goto :fail)
  echo Building the frontend...
  pushd frontend
  call npm install || (popd & goto :fail)
  call npm run build || (popd & goto :fail)
  popd
)

start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:8765"
echo Local Chat is running at http://127.0.0.1:8765  (close this window to stop it)
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8765
goto :eof

:fail
echo Setup failed.
pause
