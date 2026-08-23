import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BACKUP_FORMAT, BACKUP_TABLES, verifyPortableBackup } from '../src/backup.mjs';

function identifier(value) {
  if (!BACKUP_TABLES.includes(value)) throw new Error(`Unsupported table ${value}.`);
  return `"${value}"`;
}

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Backup contains a non-finite number.');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function orderedSchema(schema) {
  const typeRank = { table: 0, index: 1, trigger: 2 };
  const tableRank = new Map(BACKUP_TABLES.map((table, index) => [table, index]));
  return [...(schema || [])].sort((a, b) => {
    const at = typeRank[String(a?.type || '').toLowerCase()] ?? 9;
    const bt = typeRank[String(b?.type || '').toLowerCase()] ?? 9;
    if (at !== bt) return at - bt;
    const ar = tableRank.get(String(a?.tbl_name || '')) ?? Number.MAX_SAFE_INTEGER;
    const br = tableRank.get(String(b?.tbl_name || '')) ?? Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });
}

export async function buildRestoreSql(backup, options = {}) {
  if (backup?.format !== BACKUP_FORMAT || !await verifyPortableBackup(backup)) throw new Error('Portable backup integrity verification failed.');
  // Portable restore preserves FK enforcement. Both schema creation and row
  // insertion are explicitly dependency-ordered; no foreign-key bypass is used.
  const lines = [];
  if (options.includeSchema) {
    for (const item of orderedSchema(backup.schema)) {
      const sql = String(item?.sql || '').trim();
      if (sql) lines.push(`${sql.replace(/;+$/g, '')};`);
    }
  } else if (options.clearExisting) {
    for (const table of [...BACKUP_TABLES].reverse()) lines.push(`DELETE FROM ${identifier(table)};`);
  }
  for (const table of BACKUP_TABLES) {
    for (const row of backup.tables[table]) {
      const columns = Object.keys(row);
      if (!columns.length) continue;
      const columnSql = columns.map(column => `"${String(column).replace(/"/g, '""')}"`).join(',');
      const values = columns.map(column => literal(row[column])).join(',');
      lines.push(`INSERT INTO ${identifier(table)}(${columnSql}) VALUES(${values});`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) throw new Error('Usage: node portable-restore.mjs <backup.json> <restore.sql>');
  const backup = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const sql = await buildRestoreSql(backup, { includeSchema: true });
  fs.writeFileSync(outputPath, sql);
  process.stdout.write(JSON.stringify({ status: 'PASS', inputPath, outputPath, rowCounts: backup.integrity.rowCounts }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
