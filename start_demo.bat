@echo off
REM Double-click to start the virtual prosthesis trainer with the WEBCAM as sensor (no band needed).
REM For the simulated band use: python realtime\server.py --source sim
cd /d "%~dp0"
python --version >nul 2>&1
if errorlevel 1 (
  echo Python was not found. Install Python 3.11+ from https://www.python.org and tick "Add python.exe to PATH".
  pause
  exit /b 1
)
echo Installing / checking Python packages (first time only takes a minute)...
python -m pip install -q -r requirements.txt
echo.
echo Starting server... the browser opens in a few seconds. Close this window to stop.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:8000/"
python realtime\server.py --source camera
pause
