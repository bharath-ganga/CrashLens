import { createClient } from '@tursodatabase/serverless/compat';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

const [dumpPath] = process.argv.slice(2);
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!dumpPath || !url || !authToken) {
  throw new Error(
    'Usage: node scripts/import-d1-to-turso.mjs <d1-export.sql> with TURSO_DATABASE_URL and TURSO_AUTH_TOKEN set.',
  );
}

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const ignoredTables = new Set(['d1_migrations', 'sqlite_sequence', 'sqlite_stat1']);
const source = new DatabaseSync(':memory:');
const target = createClient({ url, authToken });

try {
  source.exec(await readFile(dumpPath, 'utf8'));
  const targetTables = await target.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__turso_%' ORDER BY name",
  );
  const targetNames = new Set(targetTables.rows.map((row) => String(row.name)));
  if (targetNames.size === 0) {
    throw new Error('The Turso schema is empty. Run npm run migrate:turso first.');
  }

  for (const table of targetNames) {
    const result = await target.execute(`SELECT COUNT(*) AS count FROM ${quote(table)}`);
    if (Number(result.rows[0]?.count ?? 0) > 0) {
      throw new Error(
        `Refusing to import into non-empty Turso table ${table}. Use a fresh database.`,
      );
    }
  }

  const sourceTables = source
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => String(row.name))
    .filter((table) => !ignoredTables.has(table) && targetNames.has(table));

  for (const table of sourceTables) {
    const columns = source
      .prepare(`PRAGMA table_info(${quote(table)})`)
      .all()
      .map((column) => String(column.name));
    const rows = source.prepare(`SELECT * FROM ${quote(table)}`).all();
    if (rows.length === 0) {
      console.log(`Imported ${table}: 0 rows`);
      continue;
    }

    const sql = `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    for (let offset = 0; offset < rows.length; offset += 100) {
      await target.batch(
        rows.slice(offset, offset + 100).map((row) => ({
          sql,
          args: columns.map((column) => row[column]),
        })),
        'write',
      );
    }

    const verification = await target.execute(
      `SELECT COUNT(*) AS count FROM ${quote(table)}`,
    );
    const imported = Number(verification.rows[0]?.count ?? 0);
    if (imported !== rows.length) {
      throw new Error(
        `Count mismatch for ${table}: D1=${rows.length}, Turso=${imported}`,
      );
    }
    console.log(`Imported ${table}: ${imported} rows`);
  }
} finally {
  source.close();
  target.close();
}
