import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../dist/server/wrangler.json', import.meta.url);
const destination = new URL(
  '../dist/server/wrangler.production.json',
  import.meta.url,
);
const config = JSON.parse(await readFile(source, 'utf8'));

config.name = 'crashlens-production';
config.d1_databases = [
  {
    binding: 'DB',
    database_name: 'crashlens-production-db',
    database_id: '7b1dd88c-ee78-48cc-922a-f7aadeca4772',
    migrations_dir: '../../drizzle',
  },
];
config.r2_buckets = [
  {
    binding: 'FILES',
    bucket_name: 'crashlens-production-files',
  },
];
config.observability = { enabled: true };

await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`);
console.log('Prepared dist/server/wrangler.production.json');
