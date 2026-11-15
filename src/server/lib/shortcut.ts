/**
 * Erzeugt die Datei „PMS als Programm einrichten.bat“: legt auf dem Windows-PC, auf dem sie ausgeführt wird, ein Symbol auf dem
 * Desktop und im Startmenü an, das das PMS in einem eigenen Fenster öffnet (Edge oder Chrome im App-Modus, ohne Adressleiste).
 * Es wird nichts installiert; die Verknüpfung zeigt auf die Adresse, unter der das PMS gerade aufgerufen wurde.
 */
export const validHost = (host: string) => /^[A-Za-z0-9.-]{1,120}(:\d{1,5})?$/.test(host);

export function shortcutBat(url: string): string {
  const lines = [
    '@echo off',
    'setlocal',
    'rem Schuetzenhaus PMS als eigenes Fenster: Symbol auf dem Desktop und im Startmenue anlegen.',
    `set "URL=${url}"`,
    'set "NAME=Schuetzenhaus PMS"',
    'set "BROWSER=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not exist "%BROWSER%" set "BROWSER=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not exist "%BROWSER%" goto nobrowser',
    'set "ICODIR=%LocalAppData%\\SchuetzenhausPMS"',
    'if not exist "%ICODIR%" mkdir "%ICODIR%"',
    'curl -s -f -o "%ICODIR%\\pms.ico" "%URL%favicon.ico"',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$w = New-Object -ComObject WScript.Shell; foreach ($d in @([Environment]::GetFolderPath(\'Desktop\'), [Environment]::GetFolderPath(\'Programs\'))) { $s = $w.CreateShortcut((Join-Path $d ($env:NAME + \'.lnk\'))); $s.TargetPath = $env:BROWSER; $s.Arguments = \'--app=\' + $env:URL; $ico = Join-Path $env:ICODIR \'pms.ico\'; if (Test-Path $ico) { $s.IconLocation = $ico }; $s.Description = \'Hotel- und Restaurantprogramm\'; $s.Save() }"',
    'if errorlevel 1 goto failed',
    'echo.',
    'echo Fertig: Das Symbol "%NAME%" liegt jetzt auf dem Desktop und im Startmenue.',
    'echo An die Taskleiste anheften: Rechtsklick auf das Symbol, dann "An Taskleiste anheften"',
    'echo (unter Windows 11 zuerst "Weitere Optionen anzeigen").',
    'if defined PMS_NOSTART exit /b 0',
    'start "" "%BROWSER%" --app=%URL%',
    'pause',
    'exit /b 0',
    ':nobrowser',
    'echo Weder Microsoft Edge noch Google Chrome wurde gefunden. Das PMS wird im Standardbrowser geoeffnet.',
    'if defined PMS_NOSTART exit /b 2',
    'start "" "%URL%"',
    'pause',
    'exit /b 2',
    ':failed',
    'echo Das Symbol konnte nicht angelegt werden.',
    'if not defined PMS_NOSTART pause',
    'exit /b 1',
    '',
  ];
  return lines.join('\r\n');
}
