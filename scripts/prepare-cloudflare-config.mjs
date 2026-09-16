import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../dist/server/wrangler.json', import.meta.url);
const destination = new URL(
  '../dist/server/wrangler.production.json',
  import.meta.url,
);
const config = JSON.parse(await readFile(source, 'utf8'));

config.name = 'crashlens-production';
delete config.d1_databases;
config.r2_buckets = [
  {
    binding: 'FILES',
    bucket_name: 'crashlens-production-files',
  },
];
config.observability = { enabled: true };

await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`);
console.log('Prepared dist/server/wrangler.production.json');
