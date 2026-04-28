@echo off
setlocal EnableExtensions

set "OUTDIR=%~dp0demo-runtime-diagnostics"
if exist "%OUTDIR%" rmdir /s /q "%OUTDIR%"
mkdir "%OUTDIR%"

echo [info] collecting runtime diagnostics...

echo USERNAME=%USERNAME%>"%OUTDIR%\environment.txt"
echo COMPUTERNAME=%COMPUTERNAME%>>"%OUTDIR%\environment.txt"
echo DATE=%DATE%>>"%OUTDIR%\environment.txt"
echo TIME=%TIME%>>"%OUTDIR%\environment.txt"
echo APPDATA=%APPDATA%>>"%OUTDIR%\environment.txt"
echo LOCALAPPDATA=%LOCALAPPDATA%>>"%OUTDIR%\environment.txt"

if exist "%APPDATA%\GestionaleDemo" (
  dir /s "%APPDATA%\GestionaleDemo" > "%OUTDIR%\roaming-GestionaleDemo.txt"
) else (
  echo Missing: %APPDATA%\GestionaleDemo > "%OUTDIR%\roaming-GestionaleDemo.txt"
)

if exist "%APPDATA%\gestionale-presenze-offline" (
  dir /s "%APPDATA%\gestionale-presenze-offline" > "%OUTDIR%\roaming-gestionale-presenze-offline.txt"
) else (
  echo Missing: %APPDATA%\gestionale-presenze-offline > "%OUTDIR%\roaming-gestionale-presenze-offline.txt"
)

if exist "%LOCALAPPDATA%\Programs\Gestionale Demo" (
  dir /s "%LOCALAPPDATA%\Programs\Gestionale Demo" > "%OUTDIR%\install-dir.txt"
) else (
  echo Missing: %LOCALAPPDATA%\Programs\Gestionale Demo > "%OUTDIR%\install-dir.txt"
)

if exist "%APPDATA%\GestionaleDemo\main-process.log" (
  copy /y "%APPDATA%\GestionaleDemo\main-process.log" "%OUTDIR%\main-process.log" >nul
) else (
  echo Missing: %APPDATA%\GestionaleDemo\main-process.log > "%OUTDIR%\main-process.log"
)

if exist "%APPDATA%\gestionale-presenze-offline\main-process.log" (
  copy /y "%APPDATA%\gestionale-presenze-offline\main-process.log" "%OUTDIR%\legacy-main-process.log" >nul
) else (
  echo Missing: %APPDATA%\gestionale-presenze-offline\main-process.log > "%OUTDIR%\legacy-main-process.log"
)

if exist "%LOCALAPPDATA%\Programs\Gestionale Demo\resources\app.asar.unpacked\node_modules\better-sqlite3\build\Release\better_sqlite3.node" (
  certutil -hashfile "%LOCALAPPDATA%\Programs\Gestionale Demo\resources\app.asar.unpacked\node_modules\better-sqlite3\build\Release\better_sqlite3.node" SHA256 > "%OUTDIR%\better-sqlite3-hash.txt"
) else (
  echo Missing installed better_sqlite3.node > "%OUTDIR%\better-sqlite3-hash.txt"
)

if exist "%LOCALAPPDATA%\Programs\Gestionale Demo\Gestionale Demo.exe" (
  certutil -hashfile "%LOCALAPPDATA%\Programs\Gestionale Demo\Gestionale Demo.exe" SHA256 > "%OUTDIR%\installed-exe-hash.txt"
) else (
  echo Missing installed exe > "%OUTDIR%\installed-exe-hash.txt"
)

if exist "%LOCALAPPDATA%\Programs\Gestionale Demo\resources\app.asar" (
  certutil -hashfile "%LOCALAPPDATA%\Programs\Gestionale Demo\resources\app.asar" SHA256 > "%OUTDIR%\installed-app-asar-hash.txt"
) else (
  echo Missing installed app.asar > "%OUTDIR%\installed-app-asar-hash.txt"
)

where powershell >nul 2>nul
if %errorlevel%==0 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$desktop = [Environment]::GetFolderPath('Desktop');" ^
    "$start1 = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Gestionale Demo.lnk';" ^
    "$start2 = Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs\\Gestionale Demo.lnk';" ^
    "$desktopLink = Join-Path $desktop 'Gestionale Demo.lnk';" ^
    "$shell = New-Object -ComObject WScript.Shell;" ^
    "$paths = @($desktopLink, $start1, $start2);" ^
    "$lines = foreach ($p in $paths) { if (Test-Path $p) { $s = $shell.CreateShortcut($p); 'LINK=' + $p; 'TARGET=' + $s.TargetPath; 'ARGS=' + $s.Arguments; 'WORKDIR=' + $s.WorkingDirectory; '' } };" ^
    "if (-not $lines) { $lines = @('No shortcut found.') };" ^
    "$lines | Set-Content -Encoding UTF8 '%OUTDIR%\shortcuts.txt'"
)

echo [done] diagnostics written to:
echo %OUTDIR%
endlocal
