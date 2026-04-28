@echo off
setlocal EnableExtensions

where powershell >nul 2>nul
if errorlevel 1 (
  echo PowerShell non trovato. Impossibile generare il report diagnostico.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'SilentlyContinue';" ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$stamp = Get-Date -Format 'yyyyMMdd-HHmmss';" ^
  "$reportPath = Join-Path $desktop ('GestionaleDemo-DiagnosticReport-' + $stamp + '.txt');" ^
  "$appDataDir = Join-Path $env:APPDATA 'GestionaleDemo';" ^
  "$dbPath = Join-Path $appDataDir 'data\presenze.sqlite';" ^
  "$logPath = Join-Path $appDataDir 'main-process.log';" ^
  "$legacyPaths = @(" ^
  "  (Join-Path $env:APPDATA 'gestionale-presenze-offline')," ^
  "  (Join-Path $env:APPDATA 'Gestionale Dipendenti Offline Demo')," ^
  "  (Join-Path $env:APPDATA 'Gestionale')," ^
  "  (Join-Path $env:APPDATA 'Gestionale Dipendenti Offline')" ^
  ");" ^
  "$installedExe = @(" ^
  "  (Join-Path $env:LOCALAPPDATA 'Programs\Gestionale Demo\Gestionale Demo.exe')," ^
  "  (Join-Path $env:ProgramFiles 'Gestionale Demo\Gestionale Demo.exe')," ^
  "  (Join-Path ${env:ProgramFiles(x86)} 'Gestionale Demo\Gestionale Demo.exe')," ^
  "  (Join-Path $env:ProgramFiles 'Gestionale\Demo\Gestionale Demo.exe')," ^
  "  (Join-Path ${env:ProgramFiles(x86)} 'Gestionale\Demo\Gestionale Demo.exe')" ^
  ") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1;" ^
  "$processes = Get-CimInstance Win32_Process | Where-Object {" ^
  "  $_.Name -like 'Gestionale Demo*.exe' -or $_.ExecutablePath -like '*Gestionale Demo.exe' -or $_.CommandLine -like '*Gestionale Demo*'" ^
  "};" ^
  "$version = if ($installedExe) { (Get-Item $installedExe).VersionInfo.ProductVersion } else { '' };" ^
  "$dbInfo = if (Test-Path $dbPath) { Get-Item $dbPath } else { $null };" ^
  "$logTail = if (Test-Path $logPath) { Get-Content -Path $logPath -Tail 80 } else { @('Log non trovato.') };" ^
  "$os = Get-CimInstance Win32_OperatingSystem;" ^
  "$cs = Get-CimInstance Win32_ComputerSystem;" ^
  "$bios = Get-CimInstance Win32_BIOS;" ^
  "$lines = New-Object System.Collections.Generic.List[string];" ^
  "$lines.Add('GESTIONALE DEMO - REPORT DIAGNOSTICO WINDOWS');" ^
  "$lines.Add('Generato il: ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')); " ^
  "$lines.Add('Report file: ' + $reportPath);" ^
  "$lines.Add('');" ^
  "$lines.Add('[APP INSTALLATA]');" ^
  "$lines.Add('Versione app installata: ' + ($(if ($version) { $version } else { 'Non rilevata' }))); " ^
  "$lines.Add('Percorso exe: ' + ($(if ($installedExe) { $installedExe } else { 'Non trovato' }))); " ^
  "$lines.Add('');" ^
  "$lines.Add('[PROCESSI ATTIVI GESTIONALE DEMO]');" ^
  "if ($processes) { foreach ($proc in $processes) { $lines.Add(('PID={0} | Name={1} | ExecutablePath={2}' -f $proc.ProcessId, $proc.Name, $proc.ExecutablePath)); } } else { $lines.Add('Nessun processo attivo rilevato.'); }" ^
  "$lines.Add('');" ^
  "$lines.Add('[CARTELLA DATI DEMO]');" ^
  "$lines.Add('Path %APPDATA%\GestionaleDemo: ' + $appDataDir);" ^
  "$lines.Add('Cartella presente: ' + ($(if (Test-Path $appDataDir) { 'SI' } else { 'NO' }))); " ^
  "$lines.Add('');" ^
  "$lines.Add('[DATABASE]');" ^
  "$lines.Add('Percorso database: ' + $dbPath);" ^
  "$lines.Add('Database presente: ' + ($(if ($dbInfo) { 'SI' } else { 'NO' }))); " ^
  "$lines.Add('Dimensione database bytes: ' + ($(if ($dbInfo) { [string]$dbInfo.Length } else { '0' }))); " ^
  "$lines.Add('Dimensione database MB: ' + ($(if ($dbInfo) { ('{0:N2}' -f ($dbInfo.Length / 1MB)) } else { '0.00' }))); " ^
  "$lines.Add('Ultima modifica database: ' + ($(if ($dbInfo) { $dbInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') } else { 'N/D' }))); " ^
  "$lines.Add('');" ^
  "$lines.Add('[LOG]');" ^
  "$lines.Add('Percorso log: ' + $logPath);" ^
  "$lines.Add('main-process.log presente: ' + ($(if (Test-Path $logPath) { 'SI' } else { 'NO' }))); " ^
  "$lines.Add('');" ^
  "$lines.Add('[ULTIME 80 RIGHE main-process.log]');" ^
  "foreach ($row in $logTail) { $lines.Add($row); }" ^
  "$lines.Add('');" ^
  "$lines.Add('[CARTELLE LEGACY RILEVATE]');" ^
  "foreach ($legacy in $legacyPaths) { $lines.Add($legacy + ' => ' + ($(if (Test-Path $legacy) { 'PRESENTE' } else { 'ASSENTE' }))); }" ^
  "$lines.Add('');" ^
  "$lines.Add('[SISTEMA WINDOWS]');" ^
  "$lines.Add('Computer name: ' + $env:COMPUTERNAME);" ^
  "$lines.Add('User name: ' + $env:USERNAME);" ^
  "$lines.Add('Windows caption: ' + $os.Caption);" ^
  "$lines.Add('Windows version: ' + $os.Version);" ^
  "$lines.Add('Windows build: ' + $os.BuildNumber);" ^
  "$lines.Add('OS architecture: ' + $os.OSArchitecture);" ^
  "$lines.Add('Manufacturer: ' + $cs.Manufacturer);" ^
  "$lines.Add('Model: ' + $cs.Model);" ^
  "$lines.Add('Total RAM GB: ' + ('{0:N2}' -f ($cs.TotalPhysicalMemory / 1GB)));" ^
  "$lines.Add('BIOS version: ' + (($bios.SMBIOSBIOSVersion | Select-Object -First 1)));" ^
  "$lines | Set-Content -Path $reportPath -Encoding UTF8;" ^
  "Write-Host '[done] Report creato sul Desktop:';" ^
  "Write-Host $reportPath"

exit /b %errorlevel%
