import crypto from 'node:crypto';
import path from 'node:path';

export const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Host ヘッダが 127.0.0.1:<port> か localhost:<port> のときだけ true（IPv6 表記は拒否）
export function checkHost(hostHeader, port) {
  if (typeof hostHeader !== 'string') return false;
  const h = hostHeader.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

function sameToken(given, token) {
  if (typeof given !== 'string' || typeof token !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// X-Drilldown-Token ヘッダ、または URL クエリ t が合言葉と一致するか
export function checkToken(req, token) {
  const headers = (req && req.headers) || {};
  let given = headers['x-drilldown-token'];
  if (Array.isArray(given)) given = given[0];
  if (sameToken(given, token)) return true;
  try {
    const q = new URL((req && req.url) || '/', 'http://x').searchParams.get('t');
    return sameToken(q, token);
  } catch {
    return false;
  }
}

// URL パスを publicDir の中のファイルパスに直す。外へ出るもの・不正なものは null
export function safeStaticPath(publicDir, urlPath) {
  if (typeof urlPath !== 'string') return null;
  const raw = urlPath.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  // バックスラッシュは区切りとして扱い、先頭の区切りは外す（絶対パス扱いを防ぐ）
  const rel = decoded.replace(/\\/g, '/').replace(/^\/+/, '');
  const root = path.resolve(publicDir);
  const target = path.resolve(root, rel === '' ? 'index.html' : rel);
  if (target === root || target.startsWith(root + path.sep)) return target;
  return null;
}
