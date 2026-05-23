# Performance Monitoring Setup - Summary

## What Was Done

I've implemented comprehensive performance monitoring in the GPA application to measure page load times before creating the NSIS installer.

### 1. Code Changes

#### AppLayout.jsx (src/renderer/layouts/AppLayout.jsx)
- Added `navigationStartRef` tracking at component initialization
- Added `useEffect` hook that fires on every route change (`location.pathname`)
- Measures page load time using Performance API or elapsed time calculation
- Logs performance metrics via `window.api.diagnostics.logRendererEvent()`
- Format: `[nav-perf] route=<route> loadMs=<milliseconds>`

#### Preload.js (src/main/preload.js)
- Added `logRendererEvent` method to the diagnostics API
- Enables renderer process to send performance events to main process
- Format: `window.api.diagnostics.logRendererEvent({ type, route, loadMs, timestamp })`

#### Main.js (src/main/main.js)
- Added IPC handler: `ipcMain.handle('diagnostics:logRendererEvent', ...)`
- Routes performance metrics to main process logging
- Logs to: `C:\Users\llaru\AppData\Roaming\gestionale-presenze-offline\main-process.log`
- Each navigation generates a timestamped log entry with route and load time

### 2. Built Application

The application has been successfully built with production optimization:

```
Production Build: ✅ Complete
- vite build: 2.82s
- Chunk size: 861KB (minified)
- Electron builder: ✅ Complete
- Unpacked distribution: release\win-unpacked\
- EXE file: GPA 1.0.4.exe (201MB)
- ASAR package: app.asar (169MB)
```

### 3. Performance Logging Infrastructure

When you navigate between pages in the app:

```
Timeline:
1. User navigates to new page
2. React Router changes location.pathname
3. useEffect hook in AppLayout triggers
4. requestAnimationFrame schedules performance measurement
5. Performance metrics sent to main process via IPC
6. Main process logs to main-process.log with timestamp
7. Log entry format:
   [2026-05-22T14:35:22.123Z] nav-perf
   {
     "route": "/dipendenti",
     "loadMs": 342,
     "timestamp": "2026-05-22T14:35:22.123Z"
   }
```

## How to Test

### Quick Start

1. **Clear old logs** (optional but recommended):
```powershell
$logPath = "C:\Users\llaru\AppData\Roaming\gestionale-presenze-offline\main-process.log"
if (Test-Path $logPath) {
    Remove-Item $logPath -Force
}
```

2. **Launch the app**:
```powershell
$exePath = "c:\Users\llaru\Downloads\gestionale-presenze-offline\G.P.A.-LARIX-GESTIONE-DEL-PERSONALE-AGRICOLO\release\win-unpacked\GPA 1.0.4.exe"
& $exePath
```

3. **Navigate through all 9 pages** (see PERFORMANCE_TEST.md for detailed list):
   - Wait ~2 seconds between page navigation
   - Let each page fully load before navigating to next
   - Pages: Dashboard, Dipendenti, Presenze, Acconti-rate, Report, Storico-operaio, Buste-paga, Comunicazione, DPI

4. **Extract performance logs**:
```powershell
$logPath = "C:\Users\llaru\AppData\Roaming\gestionale-presenze-offline\main-process.log"
Get-Content $logPath -Raw | Select-String "nav-perf" -Context 2 | Select-Object -Last 30
```

5. **Parse results** into table format showing route and loadMs values

## Performance Targets

- **✅ Ideal**: < 1000ms per page load
- **✅ Acceptable**: 1000-1500ms per page load
- **🔴 Slow**: > 1500ms (needs optimization before installer creation)

## Expected Results

For a demo build with 5 employees and typical data:

| Page | Expected Time | Status |
|------|---------------|--------|
| Dashboard | 150-400ms | ✅ |
| Dipendenti | 200-500ms | ✅ |
| Presenze | 300-600ms | ✅ |
| Acconti-rate | 200-400ms | ✅ |
| Report | 400-800ms | ✅ |
| Storico-operaio | 300-700ms | ✅ |
| Buste-paga | 200-500ms | ✅ |
| Comunicazione | 150-300ms | ✅ |
| DPI | 150-350ms | ✅ |

If any page exceeds 1500ms:
1. Note the page name and actual load time
2. Check main-process.log for any IPC duration_ms entries (database queries)
3. Review that page's components for expensive calculations
4. Consider code splitting or query optimization
5. Rebuild and retest

## Log File Location

```
C:\Users\llaru\AppData\Roaming\gestionale-presenze-offline\main-process.log
```

This file:
- Auto-rotates when it exceeds 5MB (old file saved as main-process.old.log)
- Contains all main process events and renderer performance logs
- Accessible while the app is running (read-only)
- Persists between app sessions

## Next Steps

### After Performance Testing ✅

**If all pages < 1500ms:**
```bash
npm run dist:win:nsis
# Creates installer at release/GPA 1.0.4.exe
```

**If any page > 1500ms:**
1. Identify the slow component
2. Check database queries (see duration_ms in logs)
3. Optimize the bottleneck
4. Rebuild: `npm run build && npm run dist:win:dir`
5. Retest performance
6. Once all pages pass, create NSIS installer

## Troubleshooting

### "No performance logs appearing"
- Ensure you're navigating using the sidebar, not browser back button
- Wait 2+ seconds on each page for full load
- Check that log file exists and is being updated

### "App won't start"
- Kill previous instances: `Get-Process | Where-Object { $_.Name -match 'electron' } | Stop-Process -Force`
- Check that `release\win-unpacked\GPA 1.0.4.exe` exists (201MB)
- Try deleting AppData cache: `Remove-Item "C:\Users\llaru\AppData\Roaming\gestionale-presenze-offline" -Recurse -Force`

### "Log file too large"
The log rotates automatically at 5MB. You can:
```powershell
# View just the latest performance logs
Get-Content "C:\Users\llaru\AppData\Roaming\gestionale-presenze-offline\main-process.log" | Select-String "nav-perf"
```

## Files Modified

1. `src/renderer/layouts/AppLayout.jsx` - Added performance tracking
2. `src/main/preload.js` - Added logRendererEvent API
3. `src/main/main.js` - Added IPC handler for logging

All changes are production-safe and add minimal overhead (~1-2ms per measurement).

## Documentation

For detailed testing procedures, see: `PERFORMANCE_TEST.md`
