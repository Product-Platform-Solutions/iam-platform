import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s: the Keycloak defaults), only used to answer the
// provider's own OTP prompt for the test user. The secret never goes to stdout.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(s) {
  const clean = s.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32 character in TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secretBytes, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secretBytes).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin = mac.readUInt32BE(off) & 0x7fffffff;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

function readState() {
  try {
    return JSON.parse(readFileSync(config.stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  mkdirSync(dirname(config.stateFile), { recursive: true });
  writeFileSync(config.stateFile, JSON.stringify(state), { mode: 0o600 });
}

export function knownSecret() {
  return config.totpSecret ?? readState().secret;
}

export function rememberSecret(secret) {
  writeState({ ...readState(), secret });
}

// Providers reject a code that was already accepted. Keycloak accepts steps now-1..now+1 by default
// (look-ahead window 1), so up to three logins fit in one 30 s period. Use the next unused step from
// now-1 upwards; if that would be more than one step ahead of now, wait for the clock to catch up.
export async function nextCode(secret) {
  const state = readState();
  const now = Math.floor(Date.now() / 30000);
  const counter = Math.max(now - 1, (state.lastCounter ?? -1) + 1);
  if (counter > now + 1) {
    const waitMs = (counter - 1) * 30000 - Date.now() + 250;
    await new Promise((r) => setTimeout(r, Math.max(waitMs, 0)));
  }
  writeState({ ...readState(), lastCounter: counter });
  return hotp(base32Decode(secret), counter);
}
