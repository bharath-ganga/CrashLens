import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
const directory='.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const files=(await readdir(directory)).filter(f=>/^[a-f0-9]{64}\.sqlite$/.test(f));
if(files.length!==1)throw new Error('Start the dev server once to create its local database; expected exactly one D1 database.');
const db=new DatabaseSync(join(directory,files[0]));
try {
 db.exec('PRAGMA busy_timeout=5000');
 for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()) {
   db.exec(await readFile(join('drizzle',file),'utf8'));console.log('Applied local schema:',file);
 }
}finally{db.close();}
