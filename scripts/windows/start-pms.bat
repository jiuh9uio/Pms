@echo off
rem Startet das Schuetzenhaus PMS. Wird von der Aufgabenplanung beim Hochfahren aufgerufen.
cd /d "%~dp0..\.."
if not exist logs mkdir logs
node dist\server\index.js >> logs\pms.log 2>&1
