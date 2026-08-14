import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

class BoundStatement {
  constructor(adapter, sql, params = []) {
    this.adapter = adapter;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) { return new BoundStatement(this.adapter, this.sql, params); }
  async first(column) {
    const row = this.adapter.raw.prepare(this.sql).get(...this.params) || null;
    return column && row ? row[column] : row;
  }
  async run() {
    const result = this.adapter.raw.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }
}

export class SqliteD1Adapter {
  constructor(raw) { this.raw = raw; }
  withSession() { return this; }
  prepare(sql) { return new BoundStatement(this, sql); }
  async batch(boundStatements) {
    this.raw.exec('BEGIN IMMEDIATE');
    const results = [];
    try {
      for (const item of boundStatements) {
        const sql = String(item.sql || '').trim();
        if (/^(SELECT|WITH|PRAGMA)\b/i.test(sql)) {
          const rows = this.raw.prepare(sql).all(...item.params);
          results.push({ success: true, results: rows, meta: { changes: 0 } });
        } else {
          const result = this.raw.prepare(sql).run(...item.params);
          results.push({ success: true, results: [], meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } });
        }
      }
      this.raw.exec('COMMIT');
      return results;
    } catch (error) {
      try { this.raw.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
}

export function createSeededSqliteD1() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sliceB = path.resolve(here, '../../slice-b');
  const sliceC = path.resolve(here, '..');
  raw.exec(fs.readFileSync(path.join(sliceB, 'migrations/0001_initial.sql'), 'utf8'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcf-slice-c-'));
  const importSql = path.join(tmp, 'import.sql');
  const report = path.join(tmp, 'report.json');
  execFileSync(process.execPath, [path.join(sliceB, 'tools/build-import.mjs'), importSql, report], { stdio: 'pipe' });
  raw.exec(fs.readFileSync(importSql, 'utf8'));
  raw.exec(fs.readFileSync(path.join(sliceC, 'migrations/0002_revision_state.sql'), 'utf8'));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { db: new SqliteD1Adapter(raw), raw };
}
