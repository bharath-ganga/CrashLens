import { createClient } from '@tursodatabase/serverless/compat';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first.');
}

const client = createClient({ url, authToken });
const schema = new DatabaseSync(':memory:');
try {
  const files = (await readdir('drizzle'))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    schema.exec(await readFile(join('drizzle', file), 'utf8'));
  }

  const objects = schema
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
       ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`,
    )
    .all();
  for (const object of objects) {
    const sql = String(object.sql)
      .replace(/^CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ')
      .replace(/^CREATE INDEX /i, 'CREATE INDEX IF NOT EXISTS ')
      .replace(/^CREATE UNIQUE INDEX /i, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
      .replace(/^CREATE TRIGGER /i, 'CREATE TRIGGER IF NOT EXISTS ');
    await client.execute(sql);
  }
  console.log(`Turso schema ready: ${objects.length} objects from ${files.length} migrations`);
} finally {
  schema.close();
  client.close();
}
