# Performance Testing Guide

## Objective

Test page load times across all 9 pages in the GPA application to ensure they meet performance targets:
- **Ideal:** < 1000ms (1 second)
- **Acceptable:** < 1500ms (1.5 seconds)
- **Critical:** > 1500ms (requires optimization)

## Test Setup

1. **Built Application:** The app has been built with performance monitoring:
   ```bash
   npm run dist:win:dir
   ```
   The unpacked distributable is at: `release\win-unpacked\GPA 1.0.4.exe`

2. **Performance Logging:** When you navigate between pages, the app will log:
   ```
   [nav-perf] route=<route> loadMs=<milliseconds>
   ```
   These logs are stored in: `C:\Users\llaru\AppData\Roaming\gestionale-presenze-offline\main-process.log`

## Test Procedure

### Step 1: Clear Previous Logs

```powershell
$logPath = "C:\Users\llaru\AppData\Roaming\gestionale-presenze-offline\main-process.log"
if (Test-Path $logPath) {
    Remove-Item $logPath -Force
    Write-Host "Log cleared"
}
```

### Step 2: Launch the Application

```powershell
$exePath = "c:\Users\llaru\Downloads\gestionale-presenze-offline\G.P.A.-LARIX-GESTIONE-DEL-PERSONALE-AGRICOLO\release\win-unpacked\GPA 1.0.4.exe"
& $exePath
```

### Step 3: Login (Demo Mode)

- Wait for the app to load completely
- You should see the login screen with Demo mode banner
- Click "Inizia" to dismiss the welcome modal if shown
- The app will auto-load with demo data

### Step 4: Navigate Through All 9 Pages

Navigate to each page in order, waiting ~2 seconds between clicks to ensure the page loads completely:

1. **Dashboard** - Click home icon or navigate to `/`
2. **Dipendenti** (Employees) - `dipendenti`
3. **Presenze** (Attendance) - `presenze`
4. **Acconti e Rate** (Financial) - `acconti-rate`
5. **Report Dipendente** (Employee Report) - `report`
6. **Storico Operaio** (Worker History) - `storico-operaio`
7. **Buste Paga** (Payroll) - `buste-paga`
8. **Comunicazione** (Communication) - `comunicazione`
9. **DPI** (Safety Equipment) - `dpi`

Note: Omit "Impostazioni" (Settings) and "Utenti" (Users) - they require admin access.

### Step 5: Extract Performance Logs

After navigating all pages, wait 2 seconds then run:

```powershell
$logPath = "C:\Users\llaru\AppData\Roaming\gestionale-presenze-offline\main-process.log"
if (Test-Path $logPath) {
    $content = Get-Content $logPath -Raw
    $perfLines = $content -split "`n" | Where-Object { $_ -match "nav-perf" }
    $perfLines | Select-Object -Last 20
} else {
    "Log file not found"
}
```

### Step 6: Analyze Results

Extract the metrics into a table:

```
┌─────────────────────────────────┬─────────┬────────────────┐
│ Pagina                          │ Tempo   │ Stato          │
├─────────────────────────────────┼─────────┼────────────────┤
│ / (Dashboard)                   │ XXX ms  │ OK / LENTO     │
│ /dipendenti (Employees)         │ XXX ms  │ OK / LENTO     │
│ /presenze (Attendance)          │ XXX ms  │ OK / LENTO     │
│ /acconti-rate (Financial)       │ XXX ms  │ OK / LENTO     │
│ /report (Employee Report)       │ XXX ms  │ OK / LENTO     │
│ /storico-operaio (History)      │ XXX ms  │ OK / LENTO     │
│ /buste-paga (Payroll)           │ XXX ms  │ OK / LENTO     │
│ /comunicazione (Communication)  │ XXX ms  │ OK / LENTO     │
│ /dpi (DPI)                      │ XXX ms  │ OK / LENTO     │
└─────────────────────────────────┴─────────┴────────────────┘
```

## Performance Targets

- **✅ OK:** 0-1000ms (ideal)
- **⚠️ ACCEPTABLE:** 1001-1500ms (acceptable)
- **🔴 SLOW:** 1501+ ms (needs optimization)

## Log Format

Each navigation generates a log entry like:

```
[2026-05-22T14:35:22.123Z] nav-perf
{
  "route": "/dashboard",
  "loadMs": 245,
  "timestamp": "2026-05-22T14:35:22.123Z"
}
```

## Troubleshooting

### App Won't Start
- Check that `release\win-unpacked\GPA 1.0.4.exe` exists
- Ensure no other instance of GPA is running
- Try killing all Node processes: `Get-Process | Where-Object { $_.Name -match 'node' } | Stop-Process -Force`

### No Performance Logs Appearing
- Ensure the log file exists: `Test-Path "C:\Users\llaru\AppData\Roaming\gestionale-presenze-offline\main-process.log"`
- Check that you're navigating using the sidebar, not the back button
- The logs may take a few seconds to appear after page load

### Log File Location Changed
Run this to find the app data directory:
```powershell
$appData = Get-ChildItem "$env:APPDATA" -Filter "gestionale*" -Directory
Write-Host "Found at: $($appData.FullName)"
```

## Next Steps After Testing

1. If all pages load in < 1.5 seconds:
   - ✅ Ready to create NSIS installer: `npm run dist:win:nsis`

2. If any page > 1.5 seconds:
   - Identify the slow page(s)
   - Check database queries (use `main-process.log` for duration_ms entries)
   - Review component rendering (check React DevTools performance)
   - Consider code splitting or lazy loading
   - Optimize database queries if needed
   - Then rebuild and retest
