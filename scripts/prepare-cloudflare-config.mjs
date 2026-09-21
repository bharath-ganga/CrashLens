import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../dist/server/wrangler.json', import.meta.url);
const destination = new URL(
  '../dist/server/wrangler.production.json',
  import.meta.url,
);
const config = JSON.parse(await readFile(source, 'utf8'));
const workerEntry = new URL('../dist/server/worker-entry.js', import.meta.url);

config.name = 'crashlens-production';
config.main = 'worker-entry.js';
delete config.d1_databases;
config.r2_buckets = [
  {
    binding: 'FILES',
    bucket_name: 'crashlens-production-files',
  },
];
config.observability = { enabled: true };
config.triggers = { crons: ['* * * * *'] };

await writeFile(
  workerEntry,
  `import application from './index.js';

export default {
  fetch(request, env, context) {
    return application.fetch(request, env, context);
  },
  scheduled(_controller, env, context) {
    if (!env.MONITOR_CRON_TOKEN) {
      console.error('MONITOR_CRON_TOKEN is not configured');
      return;
    }
    const origin = env.APP_ORIGIN || 'https://crashlens-production.bharathganga7.workers.dev';
    const request = new Request(new URL('/api/monitor-tick', origin), {
      method: 'POST',
      headers: { Authorization: \`Bearer \${env.MONITOR_CRON_TOKEN}\` },
    });
    context.waitUntil(
      application.fetch(request, env, context).then(async (response) => {
        if (!response.ok)
          console.error('Scheduled monitoring tick failed', {
            status: response.status,
          });
      }),
    );
  },
};
`,
);

await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`);
console.log('Prepared dist/server/wrangler.production.json');
