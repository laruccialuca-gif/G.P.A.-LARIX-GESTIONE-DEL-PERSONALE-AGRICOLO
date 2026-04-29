$ErrorActionPreference = "Stop"

Write-Host "[1/7] Verifica host Windows..."
if (-not $IsWindows) {
  throw "Questo script deve essere eseguito su Windows."
}

Write-Host "[2/7] Pulizia artefatti..."
node tools/clean-build-artifacts.mjs

Write-Host "[3/7] Install dipendenze lockfile..."
npm ci

Write-Host "[4/7] Rebuild moduli nativi per Electron..."
npm run rebuild:native:electron

Write-Host "[5/7] Build renderer..."
npm run build

Write-Host "[6/7] Build installer demo Windows x64..."
npm run build:demo:info
npx electron-builder --win nsis --x64

Write-Host "[7/7] Verifica binario nativo unpacked..."
node tools/verify-win-native-module.mjs demo
npm run build:demo:result

Write-Host "OK: build completata"
Write-Host "Output: release-demo\\GPA-Demo-1.0.0-Setup.exe"
