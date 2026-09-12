const encoder = new TextEncoder();
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function tokenHash(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(token)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function validPassword(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    password.length >= 12 &&
    password.length <= 128
  );
}
async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(salt),
      iterations: 100000,
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function hashPassword(password: string) {
  const salt = randomToken();
  return `pbkdf2-sha256:100000:${salt}:${await derive(password, salt)}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [scheme, iterations, salt, expected] = stored.split(':');
  if (
    scheme !== 'pbkdf2-sha256' ||
    iterations !== '100000' ||
    !salt ||
    !expected
  )
    return false;
  const actual = await derive(password, salt);
  let difference = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++)
    difference |= actual.charCodeAt(i) ^ (expected.charCodeAt(i) || 0);
  return difference === 0;
}
