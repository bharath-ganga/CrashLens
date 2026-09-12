import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomToken, verifyPassword } from '../lib/passwords.ts';
const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const files = readdirSync(dir).filter(f => /^[a-f0-9]{64}\.sqlite$/.test(f));
assert.equal(files.length, 1);
const db = new DatabaseSync(`${dir}/${files[0]}`);
const email = `signup-qa-${randomToken().slice(0,12)}@example.test`;
const password = randomToken();
async function signup(pass = password) {
  return fetch('http://localhost:3000/api/account', {
    method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({action:'signup', name:'Disposable signup test', email, password:pass}),
  });
}
try {
  assert.equal((await signup('short')).status, 400);
  const response = await signup();
  assert.equal(response.status, 201, await response.text());
  const account = db.prepare('SELECT * FROM accounts WHERE email=?').get(email);
  assert.equal(account.verified, 0, 'Do not falsely mark email ownership verified');
  assert.ok(await verifyPassword(password, account.password_hash));
  assert.equal(db.prepare('SELECT count(*) n FROM email_outbox WHERE recipient=?').get(email).n, 0);
  assert.equal((await signup(randomToken())).status, 409);
  assert.equal(db.prepare('SELECT password_hash FROM accounts WHERE email=?').get(email).password_hash, account.password_hash);
  const login = await fetch('http://localhost:3000/api/account', {
    method: 'POST', headers: { Origin:'http://localhost:3000', 'Content-Type':'application/json' },
    body: JSON.stringify({action:'login', email, password}),
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const me = await fetch('http://localhost:3000/api/account', {headers:{Cookie:cookie}}).then(r=>r.json());
  assert.equal(me.user.id, account.id);
  console.log('PASS: signup without verification email; duplicate protection; password hashing; unverified account login and session.');
} finally {
  const account = db.prepare('SELECT id FROM accounts WHERE email=?').get(email);
  if (account) {
    db.prepare('DELETE FROM account_sessions WHERE user_id=?').run(account.id);
    db.prepare('DELETE FROM team_members WHERE user_id=?').run(account.id);
    db.prepare('DELETE FROM teams WHERE created_by=?').run(account.id);
    db.prepare('DELETE FROM users WHERE id=?').run(account.id);
  }
  db.prepare('DELETE FROM email_outbox WHERE recipient=?').run(email);
  db.prepare('DELETE FROM accounts WHERE email=?').run(email);
  db.close();
}
