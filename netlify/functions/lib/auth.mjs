// Password hashing (scrypt) and signed login tokens (HMAC-SHA256, JWT format).
import crypto from "node:crypto";
import { db } from "./store.mjs";

const TOKEN_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function checkPassword(password, stored) {
  if (!stored || !password) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, "hex");
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

let cachedSecret;
async function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (cachedSecret) return cachedSecret;
  // No secret configured: create one once and keep it in storage.
  const store = await db();
  let s = await store.getJSON("_secret");
  if (!s) {
    s = crypto.randomBytes(32).toString("hex");
    await store.setJSON("_secret", s);
  }
  return (cachedSecret = s);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export async function signToken(user) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    sub: user.id,
    role: user.role,
    ver: user.tokenVersion || 0,
    exp: Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400,
  }));
  const sig = crypto.createHmac("sha256", await secret()).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export async function verifyToken(token) {
  if (!token) return null;
  const [header, payload, sig] = token.split(".");
  if (!header || !payload || !sig) return null;
  const expected = crypto.createHmac("sha256", await secret()).update(`${header}.${payload}`).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (data.exp < Date.now() / 1000) return null;
  return data;
}

export function randomPassword() {
  const words = ["noor", "sabr", "huda", "salam", "iman", "ilm", "amal", "barak", "rahma", "taqwa"];
  return words[crypto.randomInt(words.length)] + "-" + crypto.randomInt(1000, 9999);
}
