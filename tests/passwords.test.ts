import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword, randomToken, tokenHash, validPassword } from '../lib/passwords.ts';
import { redactSensitiveData } from '../lib/security.ts';
void test('passwords use random salts and verify only the matching password',async()=>{
 const a=await hashPassword('my long test passphrase');const b=await hashPassword('my long test passphrase');assert.notEqual(a,b);assert.equal(await verifyPassword('my long test passphrase',a),true);assert.equal(await verifyPassword('wrong',a),false);assert.equal(validPassword('short'),false);
});
void test('reset tokens have separate non-reversible stored digests',async()=>{const raw=randomToken();assert.match(raw,/^[a-f0-9]{64}$/);assert.notEqual(raw,await tokenHash(raw));assert.notEqual(raw,randomToken());});
void test('secret redaction preserves the field label',()=>{assert.equal(redactSensitiveData('token=abc123'),'token=[REDACTED_SECRET]');});
