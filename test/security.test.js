import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { makeToken, checkHost, checkToken, safeStaticPath, SECURITY_HEADERS } from '../skill/drilldown/app/lib/security.js';

const tok = makeToken();
const pub = path.join(os.tmpdir(), 'drilldown-security-pub');
const fakeReq = (headers = {}, url = '/') => ({ headers, url });

test('合言葉は 64 桁の hex で毎回違う', () => {
  assert.match(tok, /^[0-9a-f]{64}$/);
  assert.notEqual(makeToken(), makeToken());
});

test('127.0.0.1 は通す', () => assert.equal(checkHost('127.0.0.1:5000', 5000), true));
test('localhost は通す', () => assert.equal(checkHost('localhost:5000', 5000), true));
test('LOCALHOST も通す', () => assert.equal(checkHost('LOCALHOST:5000', 5000), true));
test('別ホストは拒否', () => assert.equal(checkHost('evil.com:5000', 5000), false));
test('ポート違いは拒否', () => assert.equal(checkHost('127.0.0.1:1', 5000), false));
test('Host なしは拒否', () => assert.equal(checkHost(undefined, 5000), false));
test('ポートなしは拒否', () => assert.equal(checkHost('127.0.0.1', 5000), false));
test('IPv6 は拒否', () => {
  assert.equal(checkHost('[::1]:5000', 5000), false);
  assert.equal(checkHost('::1:5000', 5000), false);
});
test('前後に付け足したホストは拒否', () => {
  assert.equal(checkHost('127.0.0.1:5000.evil.com', 5000), false);
  assert.equal(checkHost('evil.com127.0.0.1:5000', 5000), false);
  assert.equal(checkHost('127.0.0.1:5000 ', 5000), false);
});

test('ヘッダの合言葉で通す', () => assert.equal(checkToken(fakeReq({ 'x-drilldown-token': tok }), tok), true));
test('合言葉が違えば false', () => assert.equal(checkToken(fakeReq({ 'x-drilldown-token': 'x' }), tok), false));
test('長さが違っても false（例外にならない）', () => assert.equal(checkToken(fakeReq({ 'x-drilldown-token': tok + 'a' }), tok), false));
test('クエリの合言葉で通す', () => assert.equal(checkToken(fakeReq({}, `/?t=${tok}`), tok), true));
test('クエリの合言葉が違えば false', () => assert.equal(checkToken(fakeReq({}, '/?t=nope'), tok), false));
test('合言葉なしは false', () => assert.equal(checkToken(fakeReq({}, '/'), tok), false));

test('.. で外に出られない', () => assert.equal(safeStaticPath(pub, '/%2e%2e/server.js'), null));
test('素の .. でも外に出られない', () => assert.equal(safeStaticPath(pub, '/../server.js'), null));
test('バックスラッシュでも外に出られない', () => {
  assert.equal(safeStaticPath(pub, '/..\\server.js'), null);
  assert.equal(safeStaticPath(pub, '/%2e%2e%5cserver.js'), null);
});
// ドライブ指定は Windows だけの話（mac では /C:/... は publicDir の中の普通のパスになる）
test('ドライブ指定で外に出られない', { skip: process.platform !== 'win32' }, () => assert.equal(safeStaticPath(pub, '/C:/Windows/win.ini'), null));
test('NUL 文字を含めば null', () => assert.equal(safeStaticPath(pub, '/a%00.js'), null));
test('壊れたエスケープは null', () => assert.equal(safeStaticPath(pub, '/%E0%A4%A'), null));
test('/ は index.html', () => assert.equal(safeStaticPath(pub, '/'), path.join(pub, 'index.html')));
test('クエリは無視する', () => assert.equal(safeStaticPath(pub, '/app.js?t=abc'), path.join(pub, 'app.js')));
test('中に入る .. は許す', () => assert.equal(safeStaticPath(pub, '/a/../app.js'), path.join(pub, 'app.js')));
test('通常のパスは publicDir の中に解決される', () => assert.equal(safeStaticPath(pub, '/css/a.css'), path.join(pub, 'css', 'a.css')));

test('セキュリティヘッダ', () => {
  assert.equal(
    SECURITY_HEADERS['Content-Security-Policy'],
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'no-referrer');
});
