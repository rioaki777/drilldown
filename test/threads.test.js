import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../skill/drilldown/app/lib/store.js';
import { createThreadManager } from '../skill/drilldown/app/lib/threads.js';
import { ClaudeError } from '../skill/drilldown/app/lib/claude.js';

// 作った一時フォルダはテストの最後に消す
const TMP_DIRS = [];
const keep = (d) => { TMP_DIRS.push(d); return d; };
after(() => { for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true }); });

const MAIN = 'main-session';
const flush = () => new Promise((r) => setImmediate(r));

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// 偽の run：呼ばれるたびに記録し、テストが手で解決する。
function setup(opts = {}) {
  const dir = keep(fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test-')));
  const store = createStore(dir);
  const calls = [];
  const waiters = [];
  const run = (req) => {
    const d = deferred();
    calls.push({ ...req, created: [...store.state.createdSessionIds], done: d });
    for (const w of waiters.splice(0)) w();
    if (req.signal) req.signal.addEventListener('abort', () => d.reject(new ClaudeError('aborted', '処理が中断されました。')), { once: true });
    return d.promise;
  };
  // n 回目の呼び出しが起きるまで待つ
  const called = async (n) => {
    while (calls.length < n) await new Promise((r) => waiters.push(r));
    return calls[n - 1];
  };
  let seq = 0;
  const mgr = createThreadManager({
    store, run, bin: 'BIN', mainSessionId: MAIN, cwd: '/proj', timeoutMs: 1234,
    uuid: () => `new-${++seq}`,
    ...opts,
  });
  return { dir, store, calls, called, mgr };
}

const ok = (sessionId, result = 'ans') => ({ result, sessionId });
const arg = (args, flag) => args[args.indexOf(flag) + 1];

test('新しいスレッドはメインから fork', async () => {
  const { mgr, called, store } = setup();
  const { threadId, turnId } = mgr.ask({ quote: '引用', action: 'question', question: 'なぜ？' });
  const c = await called(1);
  assert.equal(arg(c.args, '--resume'), MAIN);
  assert.ok(c.args.includes('--fork-session'));
  assert.equal(arg(c.args, '--session-id'), 'new-1');
  assert.ok(c.args.includes('--effort'));
  assert.equal(c.bin, 'BIN');
  assert.equal(c.cwd, '/proj');
  assert.equal(c.timeoutMs, 1234);
  assert.ok(c.signal instanceof AbortSignal);
  assert.match(c.stdin, /> 引用/);
  assert.match(c.stdin, /なぜ？/);
  assert.equal(mgr.getTurn(turnId).status, 'running');
  c.done.resolve(ok('new-1', '答え'));
  await mgr.idle();
  const th = store.state.threads[threadId];
  assert.deepEqual(th, {
    id: threadId, parentThreadId: null, parentTurnId: null, quote: '引用', sessionId: 'new-1',
    carryBack: false, note: '', decisionIds: [], turnIds: [turnId], createdAt: th.createdAt,
  });
  const turn = mgr.getTurn(turnId);
  assert.equal(turn.status, 'done');
  assert.equal(turn.answerMd, '答え');
  assert.equal(turn.error, null);
  assert.equal(turn.question, 'なぜ？');
  assert.equal(turn.threadId, threadId);
  assert.equal(turn.action, 'question');
  assert.ok(turn.startedAt && turn.finishedAt);
});

test('続けて質問は同じセッションに積む', async () => {
  const { mgr, called, calls } = setup();
  const a = mgr.ask({ quote: 'q', action: 'question', question: '1' });
  (await called(1)).done.resolve(ok('S1'));
  await mgr.idle();
  mgr.ask({ threadId: a.threadId, quote: 'q', action: 'question', question: '2' });
  const c = await called(2);
  assert.equal(arg(c.args, '--resume'), 'S1');
  assert.ok(!c.args.includes('--fork-session'));
  assert.ok(!c.args.includes('--session-id'));
  c.done.resolve(ok('S1'));
  await mgr.idle();
  assert.equal(calls.length, 2);
});

test('同じスレッドは直列', async () => {
  const { mgr, called, calls } = setup();
  const a = mgr.ask({ quote: 'q', action: 'question', question: '1' });
  const second = mgr.ask({ threadId: a.threadId, quote: 'q', action: 'question', question: '2' });
  const first = await called(1);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(mgr.getTurn(second.turnId).status, 'running');
  first.done.resolve(ok('S1'));
  const c2 = await called(2);
  assert.equal(arg(c2.args, '--resume'), 'S1');
  assert.ok(!c2.args.includes('--fork-session'));
  c2.done.resolve(ok('S1'));
  await mgr.idle();
});

test('別スレッドは並行', async () => {
  const { mgr, called, calls } = setup();
  mgr.ask({ quote: 'a', action: 'detail' });
  mgr.ask({ quote: 'b', action: 'detail' });
  await called(2);
  assert.equal(calls.length, 2);
  assert.notEqual(arg(calls[0].args, '--session-id'), arg(calls[1].args, '--session-id'));
  assert.equal(mgr.isBusy(), true);
  calls[0].done.resolve(ok(arg(calls[0].args, '--session-id')));
  calls[1].done.resolve(ok(arg(calls[1].args, '--session-id')));
  await mgr.idle();
  assert.equal(mgr.isBusy(), false);
});

test('子スレッドは親の最新から fork', async () => {
  const { mgr, called, calls, store } = setup();
  const p = mgr.ask({ quote: 'q', action: 'question', question: '1' });
  (await called(1)).done.resolve(ok('P1'));
  await mgr.idle();
  const p2 = mgr.ask({ threadId: p.threadId, quote: 'q', action: 'question', question: '2' });
  const child = mgr.ask({ parentThreadId: p.threadId, parentTurnId: p2.turnId, quote: '答えの一部', action: 'term' });
  const c2 = await called(2); // 親の2回目
  await flush();
  assert.equal(calls.length, 2, '親の2回目が終わるまで子は走らない');
  c2.done.resolve(ok('P2')); // 親の最新 sessionId が P2 になる
  const c3 = await called(3);
  assert.equal(arg(c3.args, '--resume'), 'P2');
  assert.ok(c3.args.includes('--fork-session'));
  c3.done.resolve(ok(arg(c3.args, '--session-id')));
  await mgr.idle();
  const th = store.state.threads[child.threadId];
  assert.equal(th.parentThreadId, p.threadId);
  assert.equal(th.parentTurnId, p2.turnId);
  assert.equal(th.quote, '答えの一部');
  assert.equal(th.sessionId, arg(c3.args, '--session-id'));
});

test('親の回が失敗しても子は進む（親の sessionId で fork）', async () => {
  const { mgr, called } = setup();
  const p = mgr.ask({ quote: 'q', action: 'question', question: '1' });
  (await called(1)).done.resolve(ok('P1'));
  await mgr.idle();
  mgr.ask({ threadId: p.threadId, quote: 'q', action: 'question', question: '2' });
  mgr.ask({ parentThreadId: p.threadId, quote: 'x', action: 'term' });
  (await called(2)).done.reject(new ClaudeError('exit', '失敗'));
  const c3 = await called(3);
  assert.equal(arg(c3.args, '--resume'), 'P1');
  assert.ok(c3.args.includes('--fork-session'));
  c3.done.resolve(ok(arg(c3.args, '--session-id')));
  await mgr.idle();
});

test('親に sessionId が無ければ子はメインから fork', async () => {
  const { mgr, called } = setup();
  const p = mgr.ask({ quote: 'q', action: 'memo', question: 'メモ' });
  mgr.ask({ parentThreadId: p.threadId, quote: 'x', action: 'term' });
  const c = await called(1);
  assert.equal(arg(c.args, '--resume'), MAIN);
  assert.ok(c.args.includes('--fork-session'));
  c.done.resolve(ok('new-1'));
  await mgr.idle();
});

test('親が存在しない／親の回が違うスレッドなら Error', () => {
  const { mgr } = setup();
  assert.throws(() => mgr.ask({ parentThreadId: 't99', quote: 'q', action: 'detail' }), /スレッド/);
  const a = mgr.ask({ quote: 'q', action: 'memo', question: 'm' });
  const b = mgr.ask({ quote: 'q', action: 'memo', question: 'm' });
  assert.throws(() => mgr.ask({ parentThreadId: a.threadId, parentTurnId: b.turnId, quote: 'q', action: 'detail' }), /回/);
  assert.throws(() => mgr.ask({ parentThreadId: a.threadId, parentTurnId: 'u999', quote: 'q', action: 'detail' }), /回/);
});

test('存在しない threadId・空の quote・未知の action は Error', () => {
  const { mgr, store } = setup();
  assert.throws(() => mgr.ask({ threadId: 't99', quote: 'q', action: 'detail' }), /スレッド/);
  assert.throws(() => mgr.ask({ quote: '', action: 'detail' }), /引用/);
  assert.throws(() => mgr.ask({ quote: '  ', action: 'detail' }), /引用/);
  assert.throws(() => mgr.ask({ quote: 'q', action: 'bogus' }), /操作/);
  assert.throws(() => mgr.ask({ quote: 'q', action: 'question', question: ' ' }), /質問/);
  assert.deepEqual(store.state.threads, {});
  assert.deepEqual(store.state.turns, {});
});

test('失敗しても sessionId は変わらない', async () => {
  const { mgr, called, store } = setup();
  const a = mgr.ask({ quote: 'q', action: 'question', question: '1' });
  (await called(1)).done.resolve(ok('S1'));
  await mgr.idle();
  const second = mgr.ask({ threadId: a.threadId, quote: 'q', action: 'question', question: '2' });
  (await called(2)).done.reject(new ClaudeError('exit', 'claude が終了コード 1 で終了しました。'));
  await mgr.idle();
  const t2 = mgr.getTurn(second.turnId);
  assert.equal(t2.status, 'error');
  assert.equal(t2.error, 'claude が終了コード 1 で終了しました。');
  assert.equal(t2.answerMd, null);
  assert.ok(t2.finishedAt);
  assert.equal(store.state.threads[a.threadId].sessionId, 'S1');
  mgr.ask({ threadId: a.threadId, quote: 'q', action: 'question', question: '3' });
  const c3 = await called(3);
  assert.equal(arg(c3.args, '--resume'), 'S1');
  assert.ok(!c3.args.includes('--fork-session'));
  c3.done.resolve(ok('S1'));
  await mgr.idle();
});

test('初回失敗なら次もメインから fork', async () => {
  const { mgr, called, store } = setup();
  const a = mgr.ask({ quote: 'q', action: 'question', question: '1' });
  (await called(1)).done.reject(new ClaudeError('timeout', 'タイムアウトしました。'));
  await mgr.idle();
  assert.equal(store.state.threads[a.threadId].sessionId, null);
  mgr.ask({ threadId: a.threadId, quote: 'q', action: 'question', question: '2' });
  const c2 = await called(2);
  assert.equal(arg(c2.args, '--resume'), MAIN);
  assert.ok(c2.args.includes('--fork-session'));
  assert.equal(arg(c2.args, '--session-id'), 'new-2');
  c2.done.resolve(ok('new-2'));
  await mgr.idle();
  assert.equal(store.state.threads[a.threadId].sessionId, 'new-2');
});

test('fork 前に ID 一覧に足す', async () => {
  const { mgr, called, store } = setup();
  mgr.ask({ quote: 'q', action: 'detail' });
  const c = await called(1);
  assert.deepEqual(c.created, ['new-1']);
  c.done.resolve(ok('new-1'));
  await mgr.idle();
  assert.deepEqual(store.state.createdSessionIds, ['new-1']);
});

test('run が呼ばれた時点で state.json にも保存されている', async () => {
  const { mgr, called, dir } = setup();
  mgr.ask({ quote: 'q', action: 'detail' });
  const c = await called(1);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.deepEqual(onDisk.createdSessionIds, ['new-1']);
  assert.equal(Object.values(onDisk.turns)[0].status, 'running');
  c.done.resolve(ok('new-1'));
  await mgr.idle();
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.equal(Object.values(after.turns)[0].status, 'done');
});

test('useSessionId=false なら --session-id なしで、返った ID を一覧に足す', async () => {
  const { mgr, called, store } = setup({ useSessionId: false });
  mgr.ask({ quote: 'q', action: 'detail' });
  const c = await called(1);
  assert.ok(!c.args.includes('--session-id'));
  assert.deepEqual(store.state.createdSessionIds, []);
  c.done.resolve(ok('returned-1'));
  await mgr.idle();
  assert.deepEqual(store.state.createdSessionIds, ['returned-1']);
});

test('返った sessionId が一覧に無ければ足す', async () => {
  const { mgr, called, store } = setup();
  mgr.ask({ quote: 'q', action: 'detail' });
  (await called(1)).done.resolve(ok('other'));
  await mgr.idle();
  assert.deepEqual(store.state.createdSessionIds, ['new-1', 'other']);
});

test('memo は run を呼ばない', async () => {
  const { mgr, calls, store } = setup();
  const r = mgr.ask({ quote: 'q', action: 'memo', question: 'あとで調べる' });
  await mgr.idle();
  assert.equal(calls.length, 0);
  const turn = mgr.getTurn(r.turnId);
  assert.equal(turn.status, 'done');
  assert.equal(turn.answerMd, null);
  assert.equal(turn.question, 'あとで調べる');
  assert.equal(turn.action, 'memo');
  assert.equal(store.state.threads[r.threadId].sessionId, null);
  assert.deepEqual(store.state.createdSessionIds, []);
  assert.equal(mgr.isBusy(), false);
});

test('point は run を呼ばず、回も作らず、持ち帰りの印とメモを付ける', async () => {
  const { mgr, calls, store } = setup();
  const r = mgr.ask({ quote: '最大5回', action: 'point', question: '回数の根拠を書いてほしい' });
  await mgr.idle();
  assert.equal(calls.length, 0);
  assert.equal(r.turnId, null);
  const th = store.state.threads[r.threadId];
  assert.equal(th.quote, '最大5回');
  assert.equal(th.carryBack, true);
  assert.equal(th.note, '回数の根拠を書いてほしい');
  assert.deepEqual(th.turnIds, []);
  assert.deepEqual(store.state.turns, {});
  assert.equal(mgr.isBusy(), false);
});

test('point は空なら Error、既存のスレッドには使えない', () => {
  const { mgr } = setup();
  assert.throws(() => mgr.ask({ quote: 'q', action: 'point', question: ' ' }), /指摘が空/);
  const { threadId } = mgr.ask({ quote: 'q', action: 'memo', question: 'm' });
  assert.throws(() => mgr.ask({ threadId, action: 'point', question: 'x' }), /新しいスレッド/);
});

test('point は回答の文から子スレッドとして作れる', () => {
  const { mgr, store } = setup();
  const p = mgr.ask({ quote: 'q', action: 'memo', question: 'm' });
  const c = mgr.ask({ parentThreadId: p.threadId, parentTurnId: p.turnId, quote: 'x', action: 'point', question: '直して' });
  assert.equal(store.state.threads[c.threadId].parentThreadId, p.threadId);
  assert.equal(store.state.threads[c.threadId].carryBack, true);
});

test('メインの ID は一覧に入らない', async () => {
  const { mgr, called, store } = setup();
  const a = mgr.ask({ quote: 'q', action: 'detail' });
  (await called(1)).done.resolve(ok('new-1'));
  await mgr.idle();
  mgr.ask({ threadId: a.threadId, quote: 'q', action: 'question', question: 'x' });
  (await called(2)).done.resolve(ok('new-1'));
  await mgr.idle();
  assert.ok(!store.state.createdSessionIds.includes(MAIN));
  // 万一メインの ID が返ってきても足さない
  mgr.ask({ quote: 'q', action: 'detail' });
  (await called(3)).done.resolve(ok(MAIN));
  await mgr.idle();
  assert.ok(!store.state.createdSessionIds.includes(MAIN));
});

test('detail/term/diagram の question は空文字', async () => {
  const { mgr, called } = setup();
  const r = mgr.ask({ quote: 'q', action: 'diagram', question: '無視される' });
  assert.equal(mgr.getTurn(r.turnId).question, '');
  (await called(1)).done.resolve(ok('new-1'));
  await mgr.idle();
});

test('abortAll は実行中も待機中も error にする', async () => {
  const { mgr, called, calls } = setup();
  const a = mgr.ask({ quote: 'q', action: 'question', question: '1' });
  const queued = mgr.ask({ threadId: a.threadId, quote: 'q', action: 'question', question: '2' });
  const other = mgr.ask({ quote: 'z', action: 'detail' });
  await called(2);
  mgr.abortAll();
  await mgr.idle();
  assert.equal(mgr.getTurn(a.turnId).status, 'error');
  assert.equal(mgr.getTurn(a.turnId).error, '処理が中断されました。');
  assert.equal(mgr.getTurn(other.turnId).status, 'error');
  assert.equal(mgr.getTurn(queued.turnId).status, 'error');
  assert.equal(mgr.getTurn(queued.turnId).error, '処理が中断されました。');
  assert.equal(calls.length, 2, '待機中だった回は run を呼ばない');
  assert.equal(mgr.isBusy(), false);
});

test('abortAll の後でも新しい質問は通る', async () => {
  const { mgr, called } = setup();
  mgr.ask({ quote: 'q', action: 'detail' });
  await called(1);
  mgr.abortAll();
  await mgr.idle();
  const r = mgr.ask({ quote: 'q', action: 'detail' });
  const c = await called(2);
  assert.equal(c.signal.aborted, false);
  c.done.resolve(ok('new-2'));
  await mgr.idle();
  assert.equal(mgr.getTurn(r.turnId).status, 'done');
});

test('idle は後から積まれた回も待つ／getTurn は未知なら undefined', async () => {
  const { mgr, called } = setup();
  assert.equal(mgr.getTurn('u999'), undefined);
  await mgr.idle();
  const a = mgr.ask({ quote: 'q', action: 'detail' });
  let idled = false;
  const p = mgr.idle().then(() => { idled = true; });
  (await called(1)).done.resolve(ok('new-1'));
  mgr.ask({ threadId: a.threadId, quote: 'q', action: 'detail' });
  await flush();
  assert.equal(idled, false);
  (await called(2)).done.resolve(ok('new-1'));
  await p;
  assert.equal(idled, true);
});

test('run が Error 以外を投げても error 回になる', async () => {
  const { mgr, called } = setup();
  const r = mgr.ask({ quote: 'q', action: 'detail' });
  (await called(1)).done.reject('文字列の失敗');
  await mgr.idle();
  assert.equal(mgr.getTurn(r.turnId).status, 'error');
  assert.equal(mgr.getTurn(r.turnId).error, '文字列の失敗');
});

test('続きの質問は quote を省ける（thread.quote を使い、turn.quote に残す）', async () => {
  const { mgr, called, store } = setup();
  const a = mgr.ask({ quote: '元の引用', action: 'question', question: '1' });
  assert.equal(mgr.getTurn(a.turnId).quote, '元の引用');
  (await called(1)).done.resolve(ok('S1'));
  await mgr.idle();
  const b = mgr.ask({ threadId: a.threadId, quote: '', action: 'question', question: '2' });
  const c = await called(2);
  assert.match(c.stdin, /> 元の引用/);
  assert.equal(mgr.getTurn(b.turnId).quote, '元の引用');
  c.done.resolve(ok('S1'));
  await mgr.idle();
  const d = mgr.ask({ threadId: a.threadId, action: 'detail' });
  const c3 = await called(3);
  assert.match(c3.stdin, /> 元の引用/);
  assert.equal(mgr.getTurn(d.turnId).quote, '元の引用');
  c3.done.resolve(ok('S1'));
  await mgr.idle();
  assert.equal(store.state.threads[a.threadId].quote, '元の引用');
});

test('続きの質問に quote があればそれを使う（スレッドの quote は変えない）', async () => {
  const { mgr, called, store } = setup();
  const a = mgr.ask({ quote: '元の引用', action: 'detail' });
  (await called(1)).done.resolve(ok('S1'));
  await mgr.idle();
  const b = mgr.ask({ threadId: a.threadId, quote: '別の引用', action: 'question', question: '2' });
  const c = await called(2);
  assert.match(c.stdin, /> 別の引用/);
  assert.doesNotMatch(c.stdin, /元の引用/);
  assert.equal(mgr.getTurn(b.turnId).quote, '別の引用');
  assert.equal(store.state.threads[a.threadId].quote, '元の引用');
  c.done.resolve(ok('S1'));
  await mgr.idle();
});

test('子スレッドの続きの質問は、自分の sessionId があれば親の未完了の回を待たない', async () => {
  const { mgr, called, calls } = setup();
  const p = mgr.ask({ quote: 'q', action: 'detail' });
  (await called(1)).done.resolve(ok('P1'));
  await mgr.idle();
  const child = mgr.ask({ parentThreadId: p.threadId, quote: 'x', action: 'term' });
  (await called(2)).done.resolve(ok('C1'));
  await mgr.idle();
  // 親に未完了の回を作る
  mgr.ask({ threadId: p.threadId, quote: 'q', action: 'question', question: 'また' });
  const parentRun = await called(3);
  // 子の続きは待たずに走る
  mgr.ask({ threadId: child.threadId, quote: 'x', action: 'question', question: '続き' });
  const c4 = await called(4);
  assert.equal(calls.length, 4);
  assert.equal(arg(c4.args, '--resume'), 'C1');
  assert.ok(!c4.args.includes('--fork-session'));
  c4.done.resolve(ok('C1'));
  parentRun.done.resolve(ok('P1'));
  await mgr.idle();
});

test('最後の save が失敗しても、同じスレッドの次の回は走り、未処理の拒否も出ない', async () => {
  const dir = keep(fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test-')));
  const real = createStore(dir);
  let saves = 0;
  const store = { ...real, save() { saves += 1; if (saves === 4) throw new Error('disk full'); return real.save(); } };
  const calls = [];
  const waiters = [];
  const run = (req) => {
    const d = deferred();
    calls.push({ ...req, done: d });
    for (const w of waiters.splice(0)) w();
    return d.promise;
  };
  const called = async (n) => { while (calls.length < n) await new Promise((r) => waiters.push(r)); return calls[n - 1]; };
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    let seq = 0;
    const mgr = createThreadManager({ store, run, mainSessionId: MAIN, cwd: '/p', timeoutMs: 1, uuid: () => `n-${++seq}` });
    // 保存回数: ask a(1), ask b(2), a の実行前(3), a の最後(4, 失敗), b の最後(5)
    const a = mgr.ask({ quote: 'q', action: 'question', question: '1' });
    const b = mgr.ask({ threadId: a.threadId, quote: 'q', action: 'question', question: '2' });
    (await called(1)).done.resolve(ok('S1'));
    const c2 = await called(2);
    assert.equal(arg(c2.args, '--resume'), 'S1');
    c2.done.resolve(ok('S1'));
    await mgr.idle();
    await flush();
    assert.equal(mgr.getTurn(a.turnId).status, 'done');
    assert.equal(mgr.getTurn(b.turnId).status, 'done');
    assert.equal(mgr.errors.length, 1);
    assert.match(mgr.errors[0].message, /disk full/);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('__proto__ や constructor を ID に使っても Object.prototype を引かない', () => {
  const { mgr } = setup();
  const before = Object.getOwnPropertyNames(Object.prototype).sort();
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.throws(() => mgr.ask({ threadId: bad, action: 'detail' }), /スレッドが見つかりません/, bad);
    assert.throws(() => mgr.ask({ parentThreadId: bad, quote: 'q', action: 'detail' }), /親のスレッドが見つかりません/, bad);
    assert.equal(mgr.getTurn(bad), undefined, bad);
  }
  const p = mgr.ask({ quote: 'q', action: 'memo', question: 'm' });
  assert.throws(() => mgr.ask({ parentThreadId: p.threadId, parentTurnId: '__proto__', quote: 'q', action: 'detail' }), /該当する回がありません/);
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before);
});
