import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Zeitbasierte Einmal-Codes nach RFC 6238 (SHA-1, 6 Ziffern, 30 Sekunden) – das Verfahren der üblichen
 * Authenticator-Apps (Google Authenticator, Microsoft Authenticator, Aegis, FreeOTP …).
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function fromBase32(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) { value = (value << 5) | ALPHABET.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32(randomBytes(20));
export const stepOf = (ms = Date.now()) => Math.floor(ms / 30_000);

export function codeAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', fromBase32(secret)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

/** Prüft einen Code mit einem Schritt Toleranz (Uhren gehen selten genau gleich). Liefert den passenden Zeitschritt oder null. */
export function verifyCode(secret: string, code: string, now = Date.now()): number | null {
  const given = Buffer.from(code.replace(/\s/g, '').padStart(6, '0').slice(0, 6));
  const step = stepOf(now);
  for (const s of [step, step - 1, step + 1]) if (timingSafeEqual(Buffer.from(codeAt(secret, s)), given)) return s;
  return null;
}
export const otpauthUrl = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
