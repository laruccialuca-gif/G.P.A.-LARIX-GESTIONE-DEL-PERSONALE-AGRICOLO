Demo diagnostics for Windows

Run after installing and opening the demo:

tools\collect-demo-runtime-diagnostics.cmd
tools\generate-demo-windows-report.cmd

Expected outputs:
- environment.txt
- roaming-GestionaleDemo.txt
- roaming-gestionale-presenze-offline.txt
- install-dir.txt
- main-process.log
- legacy-main-process.log
- better-sqlite3-hash.txt
- installed-exe-hash.txt
- installed-app-asar-hash.txt
- shortcuts.txt

The report script writes a single .txt file on the user's Desktop with:
- installed app version
- exe path
- active Gestionale Demo processes
- %APPDATA%\GestionaleDemo path
- database presence and size
- main-process.log presence
- last 80 log lines
- detected legacy folders
- Windows system information
