@echo off
setlocal EnableExtensions
rem ===========================================================================
rem  Schuetzenhaus PMS - Update von Hand
rem  Holt die neueste Version von GitHub und spielt sie ein. Gedacht fuer den
rem  Fall, dass das Update im Programm nicht klappt (z. B. langsames Internet).
rem
rem  Ablauf: herunterladen (setzt bei Abbruch fort) - Pruefsumme kontrollieren -
rem  PMS beenden - Datensicherung - neue Programmdateien kopieren - PMS starten.
rem  Die Ordner data und backups sowie die Datei pms.env bleiben unveraendert.
rem  Die bisherigen Programmdateien liegen danach in update\previous.
rem
rem  Benutzung: Diese Datei in den PMS-Ordner legen (dort, wo pms.exe liegt)
rem  und doppelt anklicken.
rem ===========================================================================
cd /d "%~dp0"
set "HOME_DIR=%~dp0"
if "%HOME_DIR:~-1%"=="\" set "HOME_DIR=%HOME_DIR:~0,-1%"
set "UPD=%HOME_DIR%\update"
set "LOG=%UPD%\update.log"
set "URL=https://github.com/jiuh9uio/Pms/releases/latest/download/SchuetzenhausPMS-Windows.zip"
rem nur fuer den automatischen Test: andere Download-Adresse
if defined PMS_UPDATE_ZIP set "URL=%PMS_UPDATE_ZIP%"

if not exist "%HOME_DIR%\pms.exe" (
  echo Diese Datei muss im PMS-Ordner liegen, direkt neben pms.exe.
  pause
  exit /b 1
)
where curl.exe >nul 2>&1
if errorlevel 1 goto nocurl
where tar.exe >nul 2>&1
if errorlevel 1 goto nocurl
goto tools_ok
:nocurl
echo curl.exe oder tar.exe fehlt - dafuer ist mindestens Windows 10, Version 1803 noetig.
pause
exit /b 1
:tools_ok
if not exist "%UPD%" mkdir "%UPD%"
echo [%date% %time%] Update von Hand gestartet >> "%LOG%"

echo.
echo  Schritt 1 von 5: Neueste Version herunterladen
echo  (bei langsamem Internet kann das einige Minuten dauern - bricht die
echo   Verbindung ab, wird automatisch dort weitergemacht)
echo.
rem Pruefsumme zuerst: ist ein frueherer Download schon vollstaendig, muss nichts mehr geladen werden
curl.exe -L --fail -s --connect-timeout 30 -o "%UPD%\manual.zip.sha256" "%URL%.sha256"
if errorlevel 1 (
  echo Keine Verbindung zu GitHub. Bitte Internet pruefen und spaeter erneut versuchen.
  pause
  exit /b 1
)
set /a TRY=0
set /a FAIL22=0
:download
if exist "%UPD%\manual.zip" (
  call :hashok
  if not errorlevel 1 goto downloaded
)
set /a TRY+=1
if %TRY% GTR 15 (
  echo.
  echo Der Download hat nach 15 Versuchen nicht geklappt. Bitte Internet pruefen
  echo und diese Datei spaeter noch einmal starten - sie macht dort weiter.
  echo [%date% %time%] Download abgebrochen >> "%LOG%"
  pause
  exit /b 1
)
curl.exe -L --fail --connect-timeout 30 --speed-limit 1 --speed-time 120 -C - -o "%UPD%\manual.zip" "%URL%"
set "RC=%errorlevel%"
if "%RC%"=="0" goto download
rem Fortsetzen nicht moeglich oder Datei passt nicht (z. B. alte Version): neu anfangen
if "%RC%"=="22" set /a FAIL22+=1
if "%RC%"=="33" set /a FAIL22+=3
if %FAIL22% GEQ 3 (
  del /q "%UPD%\manual.zip" >nul 2>&1
  set /a FAIL22=0
)
echo Verbindung unterbrochen - neuer Versuch in 10 Sekunden ...
timeout /t 10 /nobreak >nul
goto download

:downloaded
echo.
echo  Schritt 2 von 5: Pruefsumme stimmt - Paket wird entpackt
if exist "%UPD%\manual" rmdir /s /q "%UPD%\manual"
mkdir "%UPD%\manual"
tar -xf "%UPD%\manual.zip" -C "%UPD%\manual"
if errorlevel 1 (
  echo Das Paket konnte nicht entpackt werden.
  pause
  exit /b 1
)
set "NEW_DIR=%UPD%\manual\SchuetzenhausPMS"
if not exist "%NEW_DIR%\pms.exe" set "NEW_DIR=%UPD%\manual"
if not exist "%NEW_DIR%\pms.exe" (
  echo Das heruntergeladene Paket ist unvollstaendig.
  pause
  exit /b 1
)
if not exist "%NEW_DIR%\app\version.json" (
  echo Das heruntergeladene Paket ist unvollstaendig.
  pause
  exit /b 1
)
rem version.json beginnt mit {"version":"1.2.3", ...
set "NEWVER="
for /f usebackq^ tokens^=4^ delims^=^" %%v in ("%NEW_DIR%\app\version.json") do if not defined NEWVER set "NEWVER=%%v"
echo Neue Version: %NEWVER%

echo.
echo  Schritt 3 von 5: PMS beenden
echo  (bitte vorher an allen Geraeten offene Eingaben speichern)
echo.
pause
taskkill /IM pms.exe /F >nul 2>&1
timeout /t 3 /nobreak >nul
if exist "%HOME_DIR%\data\postgres\postmaster.pid" "%HOME_DIR%\pgsql\bin\pg_ctl.exe" stop -D "%HOME_DIR%\data\postgres" -m fast -w >nul 2>&1

echo.
echo  Schritt 4 von 5: Datensicherung schreiben
"%HOME_DIR%\pms.exe" --backup
if errorlevel 1 (
  echo.
  echo Die Datensicherung hat nicht geklappt - das Update wird NICHT eingespielt.
  echo Bitte das PMS wie gewohnt starten und Bescheid geben.
  echo [%date% %time%] Sicherung fehlgeschlagen, Abbruch >> "%LOG%"
  pause
  exit /b 1
)

echo.
echo  Schritt 5 von 5: Neue Programmdateien kopieren
echo [%date% %time%] Sichere bisherige Programmdateien nach update\previous >> "%LOG%"
robocopy "%HOME_DIR%" "%UPD%\previous" /MIR /XD data backups update logs /XF pms.env /NFL /NDL /NJH /NJS /NP /R:2 /W:1 >> "%LOG%"
echo [%date% %time%] Kopiere Version %NEWVER% >> "%LOG%"
robocopy "%NEW_DIR%" "%HOME_DIR%" /E /XD data backups update logs /XF pms.env "%~nx0" /NFL /NDL /NJH /NJS /NP /R:2 /W:1 >> "%LOG%"
if errorlevel 8 (
  echo FEHLER beim Kopieren - die vorherige Version wird wiederhergestellt.
  echo [%date% %time%] FEHLER beim Kopieren - stelle vorherige Version wieder her >> "%LOG%"
  robocopy "%UPD%\previous" "%HOME_DIR%" /E /NFL /NDL /NJH /NJS /NP /R:2 /W:1 >> "%LOG%"
  pause
  exit /b 1
)
rmdir /s /q "%UPD%\manual" >nul 2>&1
del /q "%UPD%\manual.zip" "%UPD%\manual.zip.sha256" >nul 2>&1
echo [%date% %time%] Update von Hand auf %NEWVER% abgeschlossen >> "%LOG%"

echo.
echo  Fertig: Version %NEWVER% ist eingespielt. Das PMS wird gestartet.
start "Schuetzenhaus PMS" /D "%HOME_DIR%" "%HOME_DIR%\pms.exe"
timeout /t 5 /nobreak >nul
endlocal
exit /b 0

rem ---------------------------------------------------------------------------
rem Prueft die Datei manual.zip gegen manual.zip.sha256 (errorlevel 0 = stimmt).
rem Nur Windows-Bordmittel: certutil gibt die Pruefsumme in der zweiten Zeile aus.
:hashok
set "EXP="
set "GOT="
for /f "usebackq tokens=1" %%e in ("%UPD%\manual.zip.sha256") do if not defined EXP set "EXP=%%e"
for /f "skip=1 delims=" %%h in ('certutil -hashfile "%UPD%\manual.zip" SHA256') do if not defined GOT set "GOT=%%h"
if not defined GOT exit /b 1
set "GOT=%GOT: =%"
if /i "%GOT%"=="%EXP%" exit /b 0
exit /b 1
