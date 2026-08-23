import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { backupTablesFor, verifyPortableBackup } from '../src/backup.mjs';

function identifier(value, tables) {
  if (!tables.includes(value)) throw new Error(`Unsupported table ${value}.`);
  return `"${value}"`;
}

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Backup contains an unsafe or non-integer numeric value.');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function orderedSchema(schema, tables) {
  const typeRank = { table: 0, index: 1, trigger: 2 };
  const tableRank = new Map(tables.map((table, index) => [table, index]));
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

function appendSchemaSql(lines, items) {
  for (const item of items) {
    const sql = String(item?.sql || '').trim();
    if (sql) lines.push(`${sql.replace(/;+$/g, '')};`);
  }
}

export async function buildRestoreSql(backup, options = {}) {
  if (!await verifyPortableBackup(backup)) throw new Error('Portable backup integrity verification failed.');
  const tables = backupTablesFor(backup);
  // FK enforcement remains on. Tables and indexes are created first; rows are
  // restored in dependency order; integrity/protection triggers are created only
  // after all audited historical rows exist so restore does not replay write-time
  // guards against already-valid history. Gate-1 verification has already proved
  // the exact schema allowlist, canonical identity types and acyclic effect graph.
  const lines = [];
  const schema = options.includeSchema ? orderedSchema(backup.schema, tables) : [];
  if (options.includeSchema) {
    appendSchemaSql(lines, schema.filter(item => String(item?.type || '').toLowerCase() !== 'trigger'));
  } else if (options.clearExisting) {
    for (const table of [...tables].reverse()) lines.push(`DELETE FROM ${identifier(table, tables)};`);
  }
  for (const table of tables) {
    for (const row of backup.tables[table]) {
      const columns = Object.keys(row);
      if (!columns.length) continue;
      const columnSql = columns.map(column => `"${String(column).replace(/"/g, '""')}"`).join(',');
      const values = columns.map(column => literal(row[column])).join(',');
      lines.push(`INSERT INTO ${identifier(table, tables)}(${columnSql}) VALUES(${values});`);
    }
  }
  if (options.includeSchema) {
    appendSchemaSql(lines, schema.filter(item => String(item?.type || '').toLowerCase() === 'trigger'));
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
