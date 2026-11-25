import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createApp } from '../skill/drilldown/app/lib/app.js';
import { projectDir } from '../skill/drilldown/app/lib/paths.js';

// 作った一時フォルダはテストの最後に消す
const TMP_DIRS = [];
const keep = (d) => { TMP_DIRS.push(d); return d; };
after(() => { for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true }); });

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK = path.join(here, '..', 'dev', 'mock-claude.js');
const MAIN = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'test-token-abc';
const MAIN_LINE = `${JSON.stringify({ type: 'user', message: 'main' })}\n`;

// 偽の claude は os.homedir() の下に jsonl を書くので、HOME / USERPROFILE を一時フォルダにする
const HOME = keep(fs.mkdtempSync(path.join(os.tmpdir(), 'app-test-home-')));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const CWD = fs.realpathSync.native(keep(fs.mkdtempSync(path.join(os.tmpdir(), 'app-test-cwd-'))));
const PROJ = projectDir(HOME, CWD);
const MAIN_JSONL = path.join(PROJ, `${MAIN}.jsonl`);
const claudeBin = { cmd: process.execPath, prefixArgs: [MOCK] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makePublic() {
  const pub = keep(fs.mkdtempSync(path.join(os.tmpdir(), 'app-test-pub-')));
  fs.writeFileSync(path.join(pub, 'index.html'), '<!doctype html><title>x</title>');
  fs.mkdirSync(path.join(pub, 'lib'));
  fs.writeFileSync(path.join(pub, 'lib', 'a.mjs'), 'export const a = 1;');
  fs.writeFileSync(path.join(pub, 'style.css'), 'body{}');
  return pub;
}

function makeDir(files = {}) {
  const dir = keep(fs.mkdtempSync(path.join(os.tmpdir(), 'app-test-dir-')));
  const all = {
    'main.md': '# 題\n\n本文です。',
    'title.txt': 'テスト題',
    'sources.txt': 'a.md\nb.md\n',
    'decisions.json': JSON.stringify([{ id: 'D1', title: '連絡手段', options: ['メール', 'はがき'] }]),
    ...files,
  };
  for (const [k, v] of Object.entries(all)) if (v !== null) fs.writeFileSync(path.join(dir, k), v);
  return dir;
}

function resetMain() {
  fs.rmSync(PROJ, { recursive: true, force: true });
  fs.mkdirSync(PROJ, { recursive: true });
  fs.writeFileSync(MAIN_JSONL, MAIN_LINE);
}

const jsonls = () => fs.readdirSync(PROJ).filter((n) => n.endsWith('.jsonl')).sort();

// 実際に listen し、exit を差し替えて起動する
async function start({ dir = makeDir(), kind, ...opts } = {}) {
  if (kind) fs.writeFileSync(path.join(dir, 'kind.txt'), kind);
  let exitCode;
  let onExit;
  const exited = new Promise((r) => { onExit = r; });
  const exit = (code) => { exitCode = code; onExit(code); };
  const app = await createApp({
    dir, mainSessionId: MAIN, cwd: CWD, token: TOKEN, publicDir: makePublic(), homeDir: HOME, claudeBin, timeoutMs: 20000, exit, ...opts,
  });
  const base = `http://127.0.0.1:${app.port}`;
  const api = (p, { method = 'GET', body, headers = {}, token = TOKEN } = {}) => fetch(base + p, {
    method,
    headers: { ...(token ? { 'X-Drilldown-Token': token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const stop = async () => { await app.shutdown('signal'); };
  return { app, dir, base, api, exited, stop, exitCode: () => exitCode };
}

async function waitDone(api, turnId) {
  for (let i = 0; i < 200; i++) {
    const t = await (await api(`/api/turn/${turnId}`)).json();
    if (t.status !== 'running') return t;
    await sleep(50);
  }
  throw new Error('回が終わりません');
}

function rawGet(port, p, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, headers: { Host: host, 'X-Drilldown-Token': TOKEN } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('合言葉なしの /api は 403（ヘッダだけ有効、?t= は不可）', async () => {
  resetMain();
  const s = await start();
  try {
    assert.equal((await s.api('/api/doc', { token: null })).status, 403);
    assert.equal((await s.api('/api/doc', { token: 'wrong' })).status, 403);
    assert.equal((await fetch(`${s.base}/api/doc?t=${TOKEN}`)).status, 403, 'API は URL の合言葉を受け付けない');
    assert.equal((await s.api('/api/state', { token: null })).status, 403);
    const ok = await s.api('/api/doc');
    assert.equal(ok.status, 200);
    const doc = await ok.json();
    assert.equal(doc.title, 'テスト題');
    assert.equal(doc.kind, 'doc');
    assert.deepEqual(doc.sources, ['a.md', 'b.md']);
    assert.equal(doc.decisions[0].id, 'D1');
    assert.match(doc.mainMd, /本文です/);
  } finally {
    await s.stop();
  }
});

test('静的ファイルは合言葉なしで配り、セキュリティヘッダを付ける', async () => {
  resetMain();
  const s = await start();
  try {
    for (const p of ['/', '/lib/a.mjs', '/style.css']) {
      const r = await fetch(s.base + p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    }
    assert.match((await fetch(`${s.base}/lib/a.mjs`)).headers.get('content-type'), /^text\/javascript/);
    assert.equal((await fetch(`${s.base}/lib`)).status, 404, 'ディレクトリは 404');
    assert.equal((await fetch(`${s.base}/lib/`)).status, 404);
    assert.equal((await fetch(`${s.base}/nothing.js`)).status, 404);
    assert.equal(await rawGet(s.app.port, '/..%2f..%2fmain.md', `127.0.0.1:${s.app.port}`), 404);
  } finally {
    await s.stop();
  }
});

test('Host が違えば 403', async () => {
  resetMain();
  const s = await start();
  try {
    assert.equal(await rawGet(s.app.port, '/api/doc', `127.0.0.1:${s.app.port}`), 200);
    assert.equal(await rawGet(s.app.port, '/api/doc', 'evil.example:80'), 403);
    assert.equal(await rawGet(s.app.port, '/api/doc', `evil.example:${s.app.port}`), 403);
    assert.equal(await rawGet(s.app.port, '/', 'evil.example'), 403, '静的ファイルも Host を確かめる');
  } finally {
    await s.stop();
  }
});

test('一通りの流れ', async () => {
  resetMain();
  const s = await start();
  const { api } = s;
  const post = (body) => api('/api/ask', { method: 'POST', body });

  const r1 = await post({ quote: '一文目', action: 'question', question: 'これは何？' });
  assert.equal(r1.status, 200);
  const { threadId: t1, turnId: u1 } = await r1.json();
  const turn1 = await waitDone(api, u1);
  assert.equal(turn1.status, 'done');
  assert.match(turn1.answerMd, /（偽）質問：一文目/);

  const r2 = await post({ threadId: t1, action: 'detail' }); // 続きは quote を省ける
  assert.equal(r2.status, 200);
  const turn2 = await waitDone(api, (await r2.json()).turnId);
  assert.equal(turn2.status, 'done');
  assert.equal(turn2.quote, '一文目');

  const r3 = await post({ parentThreadId: t1, quote: '子の引用', action: 'term' });
  assert.equal(r3.status, 200);
  const { threadId: t2, turnId: u3 } = await r3.json();
  assert.equal((await waitDone(api, u3)).status, 'done');

  assert.equal(jsonls().length, 3, 'メイン + 分岐 2 つ');

  const st = await (await api('/api/state')).json();
  assert.equal(st.createdSessionIds, undefined);
  assert.ok(st.threads[t1] && st.threads[t2]);
  assert.equal(st.threads[t2].parentThreadId, t1);

  const dres = await api('/api/decision/D1', { method: 'PUT', body: { status: '決定', judgement: 'メール', reason: '安いから', threadIds: [t1] } });
  assert.equal(dres.status, 200);
  const tres = await api(`/api/thread/${t2}`, { method: 'PUT', body: { carryBack: true, note: '直してほしい' } });
  assert.equal(tres.status, 200);
  const st2 = await (await api('/api/state')).json();
  assert.equal(st2.decisions.D1.status, '決定');
  assert.deepEqual(st2.threads[t1].decisionIds, ['D1']);
  assert.equal(st2.threads[t2].carryBack, true);

  const fin = await api('/api/finish', { method: 'POST', body: { mode: 'return', snapshotHtml: '<p>x</p>' } });
  assert.equal(fin.status, 200);
  const { recordDir } = await fin.json();
  assert.equal(await s.exited, 0);

  assert.equal(fs.readFileSync(path.join(recordDir, 'record.html'), 'utf8'), '<p>x</p>');
  assert.match(fs.readFileSync(path.join(recordDir, 'record.md'), 'utf8'), /テスト題/);
  const ret = fs.readFileSync(path.join(s.dir, 'return.md'), 'utf8');
  assert.match(ret, /— 決定/);
  assert.match(ret, /record\.html/);
  assert.match(ret, /直してほしい/);
  assert.equal(path.dirname(path.dirname(recordDir)), path.join(HOME, '.drilldown'));

  assert.deepEqual(jsonls(), [`${MAIN}.jsonl`], '分岐は全部消え、メインは残る');
  assert.equal(fs.readFileSync(MAIN_JSONL, 'utf8'), MAIN_LINE, 'メインの中身は不変');
});

test('pr では return を拒否し、持ち帰りの指定も拒否する', async () => {
  resetMain();
  const s = await start({ kind: 'pr' });
  try {
    assert.equal((await (await s.api('/api/doc')).json()).kind, 'pr');
    const { threadId } = await (await s.api('/api/ask', { method: 'POST', body: { quote: 'q', action: 'memo', question: 'メモ' } })).json();
    const c = await s.api(`/api/thread/${threadId}`, { method: 'PUT', body: { carryBack: true } });
    assert.equal(c.status, 400);
    const pt = await s.api('/api/ask', { method: 'POST', body: { quote: 'q', action: 'point', question: '指摘' } });
    assert.equal(pt.status, 400, 'pr では指摘も作れない');
    assert.equal((await s.api(`/api/thread/${threadId}`, { method: 'PUT', body: { carryBack: false, note: 'n' } })).status, 200);
    const r = await s.api('/api/finish', { method: 'POST', body: { mode: 'return', snapshotHtml: '<p>x</p>' } });
    assert.equal(r.status, 400);
    assert.equal(fs.existsSync(path.join(s.dir, 'return.md')), false);
    assert.equal(s.exitCode(), undefined, '拒否したら終了しない');
  } finally {
    await s.stop();
  }
});

test('close は return.md を作らず、snapshotHtml が空なら record.html も作らない', async () => {
  resetMain();
  const s = await start();
  const fin = await s.api('/api/finish', { method: 'POST', body: { mode: 'close', snapshotHtml: '' } });
  assert.equal(fin.status, 200);
  const { recordDir } = await fin.json();
  await s.exited;
  assert.ok(fs.existsSync(path.join(recordDir, 'record.md')));
  assert.equal(fs.existsSync(path.join(recordDir, 'record.html')), false);
  assert.equal(fs.existsSync(path.join(s.dir, 'return.md')), false);
});

test('return で snapshotHtml が無ければ return.md は record.md を指す', async () => {
  resetMain();
  const s = await start();
  const fin = await s.api('/api/finish', { method: 'POST', body: { mode: 'return' } });
  const { recordDir } = await fin.json();
  await s.exited;
  assert.equal(fs.existsSync(path.join(recordDir, 'record.html')), false);
  assert.match(fs.readFileSync(path.join(s.dir, 'return.md'), 'utf8'), /record\.md/);
});

test('回答待ちで finish すると子を止めて分岐も消す', async () => {
  resetMain();
  const s = await start();
  const r = await s.api('/api/ask', { method: 'POST', body: { quote: '遅い', action: 'question', question: '@@SLOW' } });
  const { turnId } = await r.json();
  await sleep(300);
  assert.equal((await (await s.api(`/api/turn/${turnId}`)).json()).status, 'running');
  const t0 = Date.now();
  const fin = await s.api('/api/finish', { method: 'POST', body: { mode: 'close', snapshotHtml: '<p>x</p>' } });
  assert.equal(fin.status, 200);
  assert.ok(Date.now() - t0 < 2500, '3 秒の回答を待たずに止める');
  await s.exited;
  await sleep(3500); // 止め損ねた偽 claude が後から書かないこと
  assert.deepEqual(jsonls(), [`${MAIN}.jsonl`]);
  assert.equal(fs.readFileSync(MAIN_JSONL, 'utf8'), MAIN_LINE);
});

test('shutdown は一度だけで、signal は record.md だけを作る', async () => {
  resetMain();
  const calls = [];
  const s = await start({ exit: (c) => calls.push(c) });
  const p1 = s.app.shutdown('signal');
  const p2 = s.app.shutdown('idle');
  assert.equal(p1, p2);
  await p1;
  assert.deepEqual(calls, [0]);
  assert.equal(fs.existsSync(path.join(s.dir, 'return.md')), false);
  const recs = fs.readdirSync(path.join(HOME, '.drilldown', 'records'));
  assert.ok(recs.length >= 1);
});

test('放置で idle 終了し、record.md だけを作る', async () => {
  resetMain();
  const s = await start({ idleMs: 50, idleTickMs: 10 });
  assert.equal(await s.exited, 0);
  assert.equal(fs.existsSync(path.join(s.dir, 'return.md')), false);
});

test('decisions.json が壊れていても起動', async (t) => {
  resetMain();
  const warn = t.mock.method(console, 'warn', () => {});
  const s = await start({ dir: makeDir({ 'decisions.json': '{ 壊れた' }) });
  try {
    assert.deepEqual((await (await s.api('/api/doc')).json()).decisions, []);
    assert.ok(warn.mock.calls.some((c) => /decisions\.json/.test(String(c.arguments[0]))));
  } finally {
    await s.stop();
  }
});

test('title・kind・decisions.json が無ければ既定値', async () => {
  resetMain();
  const s = await start({ dir: makeDir({ 'title.txt': null, 'decisions.json': null, 'sources.txt': null }) });
  try {
    const doc = await (await s.api('/api/doc')).json();
    assert.equal(doc.title, '無題');
    assert.equal(doc.kind, 'doc');
    assert.deepEqual(doc.decisions, []);
    assert.deepEqual(doc.sources, []);
  } finally {
    await s.stop();
  }
});

test('main.md が無ければ起動失敗', async () => {
  await assert.rejects(
    createApp({ dir: makeDir({ 'main.md': null }), mainSessionId: MAIN, cwd: CWD, token: TOKEN, publicDir: makePublic(), homeDir: HOME, claudeBin, timeoutMs: 1000, exit: () => {} }),
    /main\.md がありません/,
  );
});

test('再起動で state が戻る', async () => {
  resetMain();
  const dir = makeDir();
  const a = await start({ dir, exit: () => {} });
  const { threadId, turnId } = await (await a.api('/api/ask', { method: 'POST', body: { quote: '引用', action: 'memo', question: 'メモ' } })).json();
  await a.stop();
  const b = await start({ dir, exit: () => {} });
  try {
    const st = await (await b.api('/api/state')).json();
    assert.ok(st.threads[threadId]);
    assert.equal(st.turns[turnId].question, 'メモ');
    assert.equal(st.decisions.D1.status, '未決');
  } finally {
    await b.stop();
  }
});

test('不正な入力は 400、未知の id は 404、大きすぎる本文は 413', async () => {
  resetMain();
  const s = await start();
  try {
    const bad = await s.api('/api/ask', { method: 'POST', body: '{ 壊れた' });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'JSON が読めません' });
    assert.equal((await s.api('/api/ask', { method: 'POST', body: { quote: '', action: 'question', question: 'q' } })).status, 400);
    assert.equal((await s.api('/api/ask', { method: 'POST', body: { quote: 'q', action: 'nope' } })).status, 400);
    assert.equal((await s.api('/api/turn/u999')).status, 404);
    assert.equal((await s.api('/api/decision/D9', { method: 'PUT', body: { status: '決定' } })).status, 404);
    assert.equal((await s.api('/api/decision/D1', { method: 'PUT', body: { status: 'だめ' } })).status, 400);
    assert.equal((await s.api('/api/thread/t99', { method: 'PUT', body: { note: 'x' } })).status, 404);
    assert.equal((await s.api('/api/finish', { method: 'POST', body: { mode: 'xx' } })).status, 400);
    assert.equal((await s.api('/api/nothing')).status, 404);

    const big = JSON.stringify({ quote: 'q', action: 'question', question: 'x'.repeat(1024 * 1024 + 10) });
    assert.equal((await s.api('/api/ask', { method: 'POST', body: big })).status, 413);
    // /api/finish だけは 20MB まで
    const snap = 'x'.repeat(2 * 1024 * 1024);
    const fin = await s.api('/api/finish', { method: 'POST', body: { mode: 'close', snapshotHtml: snap } });
    assert.equal(fin.status, 200);
    await s.exited;
  } finally {
    await s.stop();
  }
});

test('__proto__ / constructor を ID に使っても 404 か 400 で、Object.prototype は汚れない', async () => {
  resetMain();
  const s = await start();
  const before = Object.getOwnPropertyNames(Object.prototype).sort();
  try {
    for (const bad of ['__proto__', 'constructor', 'toString']) {
      assert.equal((await s.api(`/api/turn/${bad}`)).status, 404, `turn ${bad}`);
      assert.equal((await s.api(`/api/decision/${bad}`, { method: 'PUT', body: { status: '決定', judgement: 'x', reason: 'y', threadIds: [] } })).status, 404, `decision ${bad}`);
      assert.equal((await s.api(`/api/thread/${bad}`, { method: 'PUT', body: { carryBack: true, note: 'n' } })).status, 404, `thread ${bad}`);
      assert.equal((await s.api('/api/ask', { method: 'POST', body: { threadId: bad, action: 'detail' } })).status, 400, `ask threadId ${bad}`);
      assert.equal((await s.api('/api/ask', { method: 'POST', body: { parentThreadId: bad, quote: 'q', action: 'detail' } })).status, 400, `ask parent ${bad}`);
    }
    // threadIds に混ぜても拾われない
    const r = await s.api('/api/decision/D1', { method: 'PUT', body: { status: '決定', threadIds: ['__proto__', 'constructor'] } });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).threadIds, []);
    assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before);
    assert.equal({}.carryBack, undefined);
    assert.equal({}.status, undefined);
  } finally {
    await s.stop();
  }
});

// 本文を送りきる前に終了処理を始めて、処理中の接続（切られない）へ残りを送る
async function putDuringShutdown(s, p, bodyObj) {
  const body = JSON.stringify(bodyObj);
  const half = Math.floor(body.length / 2);
  const sock = net.connect(s.app.port, '127.0.0.1');
  await new Promise((r) => sock.once('connect', r));
  let out = '';
  sock.on('data', (d) => { out += d; });
  const head = ['PUT ' + p + ' HTTP/1.1', `Host: 127.0.0.1:${s.app.port}`, `X-Drilldown-Token: ${TOKEN}`,
    'Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`, 'Connection: close', '', ''].join('\r\n');
  sock.write(head + body.slice(0, half));
  await sleep(100);
  const done = s.app.shutdown('finish'); // 処理中の接続は閉じない
  await sleep(100);
  sock.write(body.slice(half));
  await new Promise((r) => sock.once('close', r));
  await done;
  return Number(/^HTTP\/1\.1 (\d+)/.exec(out)?.[1]);
}

test('終了処理が始まったら PUT も 503', async () => {
  for (const [p, body] of [['/api/decision/D1', { status: '決定' }], ['/api/thread/t1', { note: 'n' }]]) {
    resetMain();
    const s = await start({ exit: () => {} });
    await s.api('/api/ask', { method: 'POST', body: { quote: 'q', action: 'memo', question: 'm' } }); // t1
    assert.equal(await putDuringShutdown(s, p, body), 503, p);
  }
});

test('finish の途中で相手が切れても exit(0) は一度だけ呼ばれる', async () => {
  resetMain();
  const calls = [];
  const s = await start({ exit: (c) => calls.push(c) });
  // 回答待ちの子を止める間（終了処理の最中）に切れるようにする
  await s.api('/api/ask', { method: 'POST', body: { quote: '遅い', action: 'question', question: '@@SLOW' } });
  await sleep(300);
  await new Promise((resolve) => {
    const body = JSON.stringify({ mode: 'close', snapshotHtml: '<p>x</p>' });
    const sock = net.connect(s.app.port, '127.0.0.1', () => {
      const head = ['POST /api/finish HTTP/1.1', `Host: 127.0.0.1:${s.app.port}`, `X-Drilldown-Token: ${TOKEN}`,
        'Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`, '', ''].join('\r\n');
      // 送って少ししたら切る（応答は読まない）
      sock.write(head + body, () => setTimeout(() => sock.destroy(), 5));
    });
    sock.on('error', () => {});
    sock.on('close', resolve);
  });
  for (let i = 0; i < 100 && calls.length === 0; i++) await sleep(20);
  await sleep(200);
  assert.deepEqual(calls, [0]);
});

test('通常の finish でも exit(0) は一度だけ', async () => {
  resetMain();
  const calls = [];
  const s = await start({ exit: (c) => calls.push(c) });
  const fin = await s.api('/api/finish', { method: 'POST', body: { mode: 'close' } });
  assert.equal(fin.status, 200);
  await fin.json();
  assert.equal((await s.api('/api/finish', { method: 'POST', body: { mode: 'close' } }).catch(() => ({ status: 503 }))).status, 503);
  await sleep(300);
  assert.deepEqual(calls, [0]);
});

test('終了すると server.pid を消す（finish・signal・idle）', async () => {
  for (const how of ['finish', 'signal', 'idle']) {
    resetMain();
    const dir = makeDir({ 'server.pid': '12345' });
    const s = await start({ dir, ...(how === 'idle' ? { idleMs: 50, idleTickMs: 10 } : {}) });
    if (how === 'finish') {
      const fin = await s.api('/api/finish', { method: 'POST', body: { mode: 'close' } });
      assert.equal(fin.status, 200);
      await fin.json();
    } else if (how === 'signal') {
      s.app.shutdown('signal');
    }
    assert.equal(await s.exited, 0);
    assert.equal(fs.existsSync(path.join(dir, 'server.pid')), false, `${how} で server.pid が残った`);
  }
});

test('kind は pr・issue・doc・answer・file・diff ならそのまま返し、ほかは doc', async () => {
  for (const [raw, want] of [['issue', 'issue'], ['answer', 'answer'], ['file', 'file'], ['diff', 'diff'], ['doc', 'doc'], ['pr', 'pr'], ['weird', 'doc'], [' issue \n', 'issue']]) {
    resetMain();
    const s = await start({ kind: raw });
    try {
      assert.equal((await (await s.api('/api/doc')).json()).kind, want, raw);
      // pr 以外は持ち帰りができる
      const ok = (await s.api('/api/finish', { method: 'POST', body: { mode: 'return' } })).status;
      assert.equal(ok, want === 'pr' ? 400 : 200, raw);
    } finally {
      await s.stop();
    }
  }
});
