import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt mit den von OWASP empfohlenen Parametern (N=2^17, r=8, p=1)
const N = 2 ** 17, R = 8, P = 1, KEYLEN = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, len: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, len, { N: n, r, p, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEYLEN);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p), expected.length);
  return timingSafeEqual(key, expected);
}

/** Gleicht die Antwortzeit an, wenn es den Benutzernamen nicht gibt. */
let dummy: Promise<string> | undefined;
export async function fakeVerify(password: string) {
  dummy ??= hashPassword('nicht-vorhanden');
  await verifyPassword(password, await dummy);
}
