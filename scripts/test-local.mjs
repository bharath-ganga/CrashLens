import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomToken,tokenHash,hashPassword } from '../lib/passwords.ts';
const base='http://localhost:3000';
const dir='.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const files=(await readdir(dir)).filter(f=>/^[a-f0-9]{64}\.sqlite$/.test(f));
assert.equal(files.length,1,'Expected exactly one local test database');
const db=new DatabaseSync(`${dir}/${files[0]}`);db.exec('PRAGMA busy_timeout=5000');
const id=`qa-${randomToken().slice(0,12)}`;const email=`${id}@example.test`;const password=randomToken();
let session='';let monitorId='';
async function account(body,expected){const r=await fetch(`${base}/api/account`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:session},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return {r,data};}
try {
 db.prepare('INSERT INTO accounts (id,email,name,password_hash) VALUES (?,?,?,?)').run(id,email,'QA fixture',await hashPassword(password));
 const verify=randomToken();db.prepare('INSERT INTO account_tokens VALUES (?,?,?,?)').run(await tokenHash(verify),id,'verify',Date.now()+60000);
 await account({action:'verify',token:verify},200);await account({action:'verify',token:verify},400);
 await account({action:'login',email,password:'wrong'},401);
 const login=await account({action:'login',email,password},200);session=login.r.headers.get('set-cookie').split(';')[0];assert.ok(login.r.headers.get('set-cookie').includes('HttpOnly'));
 const me=await fetch(`${base}/api/account`,{headers:{Cookie:session}}).then(r=>r.json());assert.equal(me.user.id,id);
 const create=await fetch(`${base}/api/monitors`,{method:'POST',headers:{Origin:base,Cookie:session,'Content-Type':'application/json'},body:JSON.stringify({action:'create',name:'QA monitor',url:'https://example.com/',service:'qa-service',interval:300})});assert.equal(create.status,201);monitorId=(await create.json()).id;
 const list=await fetch(`${base}/api/monitors`,{headers:{Cookie:session}}).then(r=>r.json());assert.equal(list.monitors.length,1);assert.equal(list.monitors[0].id,monitorId);assert.equal(list.schedulerActive,false);
 const pause=await fetch(`${base}/api/monitors`,{method:'POST',headers:{Origin:base,Cookie:session,'Content-Type':'application/json'},body:JSON.stringify({action:'pause',id:monitorId})});assert.equal(pause.status,200);
 const csrf=await fetch(`${base}/api/account`,{method:'POST',headers:{Origin:'https://evil.example',Cookie:session,'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});assert.equal(csrf.status,403);
 const reset=randomToken();db.prepare('INSERT INTO account_tokens VALUES (?,?,?,?)').run(await tokenHash(reset),id,'reset',Date.now()+60000);
 const updated=randomToken();await account({action:'reset',token:reset,password:updated},200);await account({action:'reset',token:reset,password:updated},400);
 const expired=await fetch(`${base}/api/account`,{headers:{Cookie:session}}).then(r=>r.json());assert.equal(expired.user,null);
 const next=await account({action:'login',email,password:updated},200);session=next.r.headers.get('set-cookie').split(';')[0];await account({action:'logout'},200);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE recipient=? AND event_key LIKE 'login:%'").get(email).n,2);
 const unauthorized=await fetch(`${base}/api/monitor-tick`,{method:'POST'});assert.equal(unauthorized.status,401);
 console.log('PASS: verification and single-use tokens; password checks; sessions; isolated monitor CRUD; CSRF; reset revocation; login email queue; logout; scheduler auth.');
}finally{
 // Only fixtures created by this run are removed from the local emulator.
 if(monitorId)db.prepare('DELETE FROM uptime_checks WHERE monitor_id=?').run(monitorId);
 db.prepare('DELETE FROM uptime_monitors WHERE created_by=?').run(id);
 db.prepare('DELETE FROM email_outbox WHERE recipient=?').run(email);
 db.prepare('DELETE FROM account_tokens WHERE user_id=?').run(id);
 db.prepare('DELETE FROM account_sessions WHERE user_id=?').run(id);
 db.prepare('DELETE FROM team_members WHERE user_id=?').run(id);
 db.prepare('DELETE FROM teams WHERE created_by=?').run(id);
 db.prepare('DELETE FROM users WHERE id=?').run(id);
 db.prepare('DELETE FROM accounts WHERE id=?').run(id);
 db.close();
}
