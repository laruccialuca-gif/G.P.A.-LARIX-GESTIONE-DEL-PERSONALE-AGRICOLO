@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo [1/7] Verifica host Windows...
if /I not "%OS%"=="Windows_NT" (
  echo Errore: questo script deve essere eseguito su Windows.
  exit /b 1
)

echo [2/7] Pulizia artefatti...
node tools\clean-build-artifacts.mjs || exit /b 1

echo [3/7] Install dipendenze lockfile...
npm ci || exit /b 1

echo [4/7] Rebuild moduli nativi per Electron...
npm run rebuild:native:electron || exit /b 1

echo [5/7] Build renderer...
npm run build || exit /b 1

echo [6/7] Build installer demo Windows x64...
npm run build:demo:info || exit /b 1
npx electron-builder --win nsis --x64 || exit /b 1

echo [7/7] Verifica binario nativo unpacked...
node tools\verify-win-native-module.mjs demo || exit /b 1
npm run build:demo:result || exit /b 1

echo OK: build completata
echo Output: release-demo\Gestionale-Demo-1.0.0-Setup.exe
endlocal
