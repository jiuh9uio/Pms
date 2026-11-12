@echo off
rem Taegliche Datensicherung. Wird von der Aufgabenplanung aufgerufen.
cd /d "%~dp0..\.."
if not exist logs mkdir logs
node scripts\backup.mjs >> logs\backup.log 2>&1
