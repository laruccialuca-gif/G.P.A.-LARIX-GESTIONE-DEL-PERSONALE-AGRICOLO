#!/usr/bin/env node
// Test payrollRepo.listPayrollHistory performance directly

import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(
  os.homedir(),
  'AppData/Roaming/Gestionale/data/presenze.sqlite'
);

console.log('\n========================================');
console.log('PAYROLL REPO PERFORMANCE TEST');
console.log('========================================\n');

console.log(`Database path: ${dbPath}\n`);

// Import the database functions
const { default: Database } = await import('better-sqlite3');

let db = null;
try {
  db = new Database(dbPath, { readonly: true });

  console.log('✓ Database connection successful\n');

  // Test the optimized query directly
  console.log('Running optimized listPayrollHistory query...\n');

  const queryStart = Date.now();

  // Count total
  const countStart = Date.now();
  const totalRow = db.prepare(`
    SELECT COUNT(*) AS total FROM payroll_records pr
    JOIN employees e ON e.id = pr.employee_id
  `).get();
  const countDuration = Date.now() - countStart;

  console.log(`[Test] COUNT query: ${countDuration}ms`);

  // Select with pagination
  const selectStart = Date.now();
  const rows = db.prepare(`
    SELECT
      pr.id,
      pr.employee_id,
      pr.month,
      pr.datore,
      pr.retribuzione_calcolata,
      pr.importo_busta_paga,
      pr.is_pagato,
      pr.archived_at,
      pr.created_at,
      pr.note,
      e.first_name,
      e.last_name,
      e.role,
      e.status,
      CASE WHEN EXISTS (
        SELECT 1 FROM payroll_documents pd
        WHERE pd.payroll_record_id = pr.id
          AND pd.category = 'payroll_slip'
        LIMIT 1
      ) THEN 1 ELSE 0 END AS has_document
    FROM payroll_records pr
    JOIN employees e ON e.id = pr.employee_id
    ORDER BY pr.archived_at IS NOT NULL ASC, pr.month DESC, e.last_name COLLATE NOCASE ASC
    LIMIT 50
  `).all();
  const selectDuration = Date.now() - selectStart;

  console.log(`[Test] SELECT query: ${selectDuration}ms (${rows.length} rows)`);

  const totalDuration = Date.now() - queryStart;

  console.log(`\n========== RESULTS ==========\n`);
  console.log(`Total Rows in Database: ${totalRow?.total || 0}`);
  console.log(`Rows Fetched (LIMIT 50): ${rows.length}`);
  console.log(`\nQuery Performance:`);
  console.log(`  Total Duration: ${totalDuration}ms`);
  console.log(`  ├─ COUNT: ${countDuration}ms`);
  console.log(`  └─ SELECT: ${selectDuration}ms`);

  const status = totalDuration < 500 ? '✓ OPTIMIZED' : totalDuration < 1000 ? '⚠ ACCEPTABLE' : '✗ SLOW';
  const statusColor = totalDuration < 500 ? '\x1b[32m' : totalDuration < 1000 ? '\x1b[33m' : '\x1b[31m';
  const resetColor = '\x1b[0m';

  console.log(`\nStatus: ${statusColor}${status}${resetColor}`);
  console.log(`Target: <500ms`);
  console.log(`Actual: ${totalDuration}ms`);

  if (totalDuration > 500) {
    console.log(`\n⚠️  Performance target not met`);
    console.log(`Improvement needed: ${totalDuration - 500}ms`);
  } else {
    const improvement = 20786 - totalDuration;
    const improvementPct = Math.round((improvement / 20786) * 100);
    console.log(`\n✓ Target achieved!`);
    console.log(`Improvement: ${improvement}ms (${improvementPct}% faster than before)`);
  }

  console.log('\n========================================\n');

} catch (error) {
  console.error('ERROR:', error.message);
  console.error('\nMake sure:');
  console.error('  1. The app has been launched at least once');
  console.error('  2. The database exists at:', dbPath);
  console.error('  3. You have read permission to the database file');
  process.exit(1);
} finally {
  if (db) db.close();
}
