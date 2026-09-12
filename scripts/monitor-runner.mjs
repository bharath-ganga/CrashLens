// Run on an always-on machine. A browser tab is never the scheduler.
const origin = process.env.CRASHLENS_URL;
const token = process.env.MONITOR_CRON_TOKEN;
if (!origin || !token) throw new Error('Set CRASHLENS_URL and MONITOR_CRON_TOKEN.');
const url = new URL('/api/monitor-tick', origin);
if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Remote schedulers require HTTPS.');
let stopped = false;
process.on('SIGINT',()=>{stopped=true;});
process.on('SIGTERM',()=>{stopped=true;});
while (!stopped) {
  try {
    const response = await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(55000)});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(new Date().toISOString(), await response.json());
  } catch(error) { console.error('Monitoring tick failed:',error.message); }
  if (process.argv.includes('--once')) break;
  await new Promise(resolve=>setTimeout(resolve,60000));
}
