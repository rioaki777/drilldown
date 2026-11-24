// 127.0.0.1 だけで待つ HTTP サーバー。静的ファイル、JSON API、終了処理をまとめる。
//
// 合言葉の扱い（方針）：
// - 静的ファイル（GET / を含む）は合言葉なしで配る。データを含まず、画面は ?t= を sessionStorage に移すため、
//   ?t= なしの再読み込みでも開けなければならない。ただし Host の確認、SECURITY_HEADERS、通常ファイルかの確認は行う。
// - /api/* はすべて X-Drilldown-Token ヘッダが必要。URL の ?t= は /api では受け付けない。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkHost, checkToken, safeStaticPath, SECURITY_HEADERS } from './security.js';
import { createStore } from './store.js';
import { createThreadManager } from './threads.js';
import { resolveClaudeBin } from './claude.js';
import { renderRecordMd, renderReturnMd, writeRecord } from './records.js';
import { deleteSessions } from './cleanup.js';
import { createIdleTimer } from './idle.js';

const JSON_LIMIT = 1024 * 1024;
const FINISH_LIMIT = 20 * 1024 * 1024;
const STATUSES = ['未決', '決定', '保留'];
const KINDS = ['pr', 'issue', 'doc', 'answer', 'file', 'diff'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function readOptional(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function loadDoc(dir) {
  const mainMd = readOptional(path.join(dir, 'main.md'));
  if (mainMd === null) throw new Error('main.md がありません');
  const title = (readOptional(path.join(dir, 'title.txt')) ?? '').trim() || '無題';
  const kindRaw = (readOptional(path.join(dir, 'kind.txt')) ?? '').trim();
  // 画面の札に出すため、知っている種類はそのまま渡す（ふるまいが変わるのは pr だけ）
  const kind = KINDS.includes(kindRaw) ? kindRaw : 'doc';
  const sources = (readOptional(path.join(dir, 'sources.txt')) ?? '')
    .split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '');
  let decisions = [];
  const raw = readOptional(path.join(dir, 'decisions.json'));
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('配列ではありません');
      decisions = parsed.filter((d) => d && typeof d === 'object' && typeof d.id === 'string');
    } catch (e) {
      console.warn(`decisions.json を読み込めなかったため、決める事項なしで開始します: ${e.message}`);
      decisions = [];
    }
  }
  return { mainMd, title, kind, sources, decisions };
}

// server.js が書いた <dir>/server.pid を消す（無ければ何もしない）。
// 残っていると、後片付けの kill が別のプロセスに当たるおそれがある。
export function removePidFile(dir) {
  try {
    fs.rmSync(path.join(dir, 'server.pid'), { force: true });
  } catch (e) {
    console.warn(`server.pid を消せませんでした: ${e.message}`);
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    let size = 0;
    let over = Number.isFinite(declared) && declared > limit;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) over = true;
      if (!over) chunks.push(c);
    });
    req.on('end', () => {
      if (over) return reject(new HttpError(413, '本文が大きすぎます'));
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return resolve({});
      try {
        const v = JSON.parse(text);
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('object ではありません');
        resolve(v);
      } catch {
        reject(new HttpError(400, 'JSON が読めません'));
      }
    });
    req.on('error', reject);
  });
}

export async function createApp({
  dir, mainSessionId, cwd, token, publicDir, homeDir = os.homedir(), claudeBin, timeoutMs,
  idleMs = 21600000, exit = process.exit, idleTickMs = 60000,
}) {
  const doc = loadDoc(dir);
  const store = createStore(dir);
  for (const w of store.warnings) console.warn(w);
  store.initDecisions(doc.decisions);
  store.save();
  const { state } = store;
  const bin = claudeBin ?? resolveClaudeBin(process.env);
  const manager = createThreadManager({ store, bin, mainSessionId, cwd, timeoutMs });

  let port = 0;
  let finalizing = null; // 終了処理（記録の保存と分岐の削除）。一度だけ走る
  let shutdownPromise = null;

  const idleTimer = createIdleTimer({
    ms: idleMs, isBusy: () => manager.isBusy(), onIdle: () => { shutdown('idle'); }, tickMs: idleTickMs,
  });

  async function finalize(reason, { mode, snapshotHtml } = {}) {
    manager.abortAll();
    await manager.idle();
    const isFinish = reason === 'finish';
    let recordDir = null;
    try {
      const html = isFinish && typeof snapshotHtml === 'string' && snapshotHtml !== '' ? snapshotHtml : null;
      const recordMd = renderRecordMd({ title: doc.title, sources: doc.sources, mainMd: doc.mainMd, state, decisions: doc.decisions });
      recordDir = writeRecord({ homeDir, now: new Date(), title: doc.title, snapshotHtml: html, recordMd });
      if (isFinish && mode === 'return') {
        const returnMd = renderReturnMd({
          title: doc.title, recordPath: recordDir, hasHtml: html !== null, sources: doc.sources, state, decisions: doc.decisions,
        });
        fs.writeFileSync(path.join(dir, 'return.md'), returnMd);
      }
    } catch (e) {
      if (isFinish) throw e; // 利用者が結果を待っているので、失敗を返す
      console.warn(`記録を書けませんでした: ${e.message}`);
    }
    try {
      deleteSessions({ homeDir, cwd, ids: state.createdSessionIds, mainSessionId });
    } catch (e) {
      console.warn(`分岐のセッションを消せませんでした: ${e.message}`);
    }
    return recordDir;
  }

  function shutdown(reason) {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      idleTimer.stop();
      try {
        if (!finalizing) finalizing = finalize(reason);
        await finalizing;
      } catch (e) {
        console.warn(`終了処理に失敗しました: ${e.message}`);
      }
      for (const e of manager.errors) console.warn(`内部エラー: ${e.message}`);
      server.close();
      if (reason === 'finish') server.closeIdleConnections?.();
      else server.closeAllConnections?.();
      removePidFile(dir);
      exit(0);
    })();
    return shutdownPromise;
  }

  function send(res, status, body, extra = {}) {
    const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
    const payload = isJson ? JSON.stringify(body) : body;
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'Cache-Control': 'no-store',
      'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      ...extra,
    });
    res.end(payload);
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET') return send(res, 404, { error: '見つかりません' });
    const file = safeStaticPath(publicDir, pathname);
    let st = null;
    try {
      if (file) st = fs.statSync(file);
    } catch {
      st = null;
    }
    if (!st || !st.isFile()) return send(res, 404, { error: '見つかりません' });
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': type, 'Content-Length': st.size });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }

  // リクエスト由来の ID は自前のキーだけを引く（__proto__ や constructor を引かない）
  const own = (obj, key) => (typeof key === 'string' && Object.hasOwn(obj, key) ? obj[key] : undefined);
  const closing = () => shutdownPromise !== null || finalizing !== null;

  const seg = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  };

  async function handleApi(req, res, pathname) {
    // 合言葉はヘッダだけ（URL の ?t= は API では受け付けない）
    if (!checkToken({ headers: req.headers, url: '/' }, token)) return send(res, 403, { error: '合言葉が違います' });
    idleTimer.touch();
    const method = req.method;
    const parts = pathname.split('/').slice(2); // /api/<a>/<b>

    if (method === 'GET' && pathname === '/api/doc') {
      return send(res, 200, { title: doc.title, kind: doc.kind, mainMd: doc.mainMd, decisions: doc.decisions, sources: doc.sources });
    }
    if (method === 'GET' && pathname === '/api/state') {
      const { createdSessionIds, ...rest } = state; // eslint-disable-line no-unused-vars
      return send(res, 200, rest);
    }
    if (method === 'POST' && pathname === '/api/ask') {
      const body = await readBody(req, JSON_LIMIT);
      if (closing()) return send(res, 503, { error: '終了処理中です' });
      try {
        const { threadId, parentThreadId, parentTurnId, quote, action, question } = body;
        return send(res, 200, manager.ask({ threadId, parentThreadId, parentTurnId, quote, action, question }));
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }
    if (method === 'GET' && parts[0] === 'turn' && parts.length === 2) {
      const turn = manager.getTurn(seg(parts[1]));
      return turn ? send(res, 200, turn) : send(res, 404, { error: '回が見つかりません' });
    }
    if (method === 'PUT' && parts[0] === 'decision' && parts.length === 2) {
      const id = seg(parts[1]);
      const body = await readBody(req, JSON_LIMIT);
      if (closing()) return send(res, 503, { error: '終了処理中です' });
      const dec = own(state.decisions, id);
      if (!dec) return send(res, 404, { error: '決める事項が見つかりません' });
      if (!STATUSES.includes(body.status)) return send(res, 400, { error: 'status は 未決・決定・保留 のどれかです' });
      for (const k of ['judgement', 'reason']) {
        if (body[k] !== undefined && typeof body[k] !== 'string') return send(res, 400, { error: `${k} は文字列です` });
      }
      if (body.threadIds !== undefined && (!Array.isArray(body.threadIds) || body.threadIds.some((t) => typeof t !== 'string'))) {
        return send(res, 400, { error: 'threadIds は文字列の配列です' });
      }
      const threadIds = (body.threadIds ?? []).filter((t) => own(state.threads, t));
      dec.status = body.status;
      dec.judgement = body.judgement ?? '';
      dec.reason = body.reason ?? '';
      dec.threadIds = threadIds;
      for (const th of Object.values(state.threads)) {
        const has = th.decisionIds.includes(id);
        if (threadIds.includes(th.id) && !has) th.decisionIds.push(id);
        else if (!threadIds.includes(th.id) && has) th.decisionIds = th.decisionIds.filter((d) => d !== id);
      }
      store.save();
      return send(res, 200, dec);
    }
    if (method === 'PUT' && parts[0] === 'thread' && parts.length === 2) {
      const body = await readBody(req, JSON_LIMIT);
      if (closing()) return send(res, 503, { error: '終了処理中です' });
      const th = own(state.threads, seg(parts[1]));
      if (!th) return send(res, 404, { error: 'スレッドが見つかりません' });
      if (body.carryBack !== undefined && typeof body.carryBack !== 'boolean') return send(res, 400, { error: 'carryBack は true か false です' });
      if (body.note !== undefined && typeof body.note !== 'string') return send(res, 400, { error: 'note は文字列です' });
      if (doc.kind === 'pr' && body.carryBack === true) return send(res, 400, { error: 'PR の確認ではメインの会話への持ち帰りはできません' });
      if (body.carryBack !== undefined) th.carryBack = body.carryBack;
      if (body.note !== undefined) th.note = body.note;
      store.save();
      return send(res, 200, th);
    }
    if (method === 'POST' && pathname === '/api/finish') {
      const body = await readBody(req, FINISH_LIMIT);
      if (body.mode !== 'close' && body.mode !== 'return') return send(res, 400, { error: 'mode は close か return です' });
      if (body.mode === 'return' && doc.kind === 'pr') return send(res, 400, { error: 'PR の確認では持ち帰りはできません' });
      if (body.snapshotHtml !== undefined && body.snapshotHtml !== null && typeof body.snapshotHtml !== 'string') {
        return send(res, 400, { error: 'snapshotHtml は文字列です' });
      }
      if (closing()) return send(res, 503, { error: '終了処理中です' });
      finalizing = finalize('finish', { mode: body.mode, snapshotHtml: body.snapshotHtml });
      let recordDir;
      try {
        recordDir = await finalizing;
      } catch (e) {
        finalizing = null; // 書けなかったときは続けられる
        return send(res, 500, { error: `記録を書けませんでした：${e.message}` });
      }
      // 記録を書いている間に相手が切れていても、必ず終了する（shutdown は一度しか走らない）
      const done = () => { shutdown('finish'); };
      if (res.destroyed || res.writableEnded) done();
      else {
        res.once('finish', done);
        res.once('close', done);
      }
      return send(res, 200, { recordDir }, { Connection: 'close' });
    }
    return send(res, 404, { error: '見つかりません' });
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!checkHost(req.headers.host, port)) return send(res, 403, { error: 'Host が違います' });
      const { pathname } = new URL(req.url, 'http://x');
      if (pathname === '/api' || pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
      return serveStatic(req, res, pathname);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (e instanceof HttpError) return send(res, e.status, { error: e.message }, e.status === 413 ? { Connection: 'close' } : {});
      send(res, 500, { error: `内部エラー：${e.message}` });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = server.address().port;
  return { server, port, shutdown };
}
