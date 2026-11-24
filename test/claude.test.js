import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClaudeArgs, resolveClaudeBin, runClaude, ClaudeError } from '../skill/drilldown/app/lib/claude.js';
import { buildPrompt } from '../skill/drilldown/app/lib/prompts.js';
import { projectDir } from '../skill/drilldown/app/lib/paths.js';

const mockPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dev', 'mock-claude.js');
const mockBin = { bin: resolveClaudeBin({ DRILLDOWN_CLAUDE_BIN: mockPath }) };
const args = buildClaudeArgs({ resumeId: 'M', fork: true, newSessionId: 'N' });

let home;
let cwd;
const saved = {};
before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'drilldown-claude-home-'));
  // mac では os.tmpdir() が /var/... で、子の process.cwd() は /private/var/... になるので実パスにそろえる
  cwd = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'drilldown-claude-cwd-')));
  for (const k of ['HOME', 'USERPROFILE']) { saved[k] = process.env[k]; process.env[k] = home; }
});
after(() => {
  for (const k of ['HOME', 'USERPROFILE']) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('偽 claude で成功', async () => {
  const r = await runClaude({ ...mockBin, args, stdin: 'Q', cwd, timeoutMs: 5000 });
  assert.equal(r.sessionId, 'N');
  assert.match(r.result, /^（偽）/);
});
test('分岐の jsonl が HOME 配下に追記される', async () => {
  await runClaude({ ...mockBin, args, stdin: 'Q', cwd, timeoutMs: 5000 });
  const f = path.join(projectDir(os.homedir(), cwd), 'N.jsonl');
  assert.ok(fs.existsSync(f));
  assert.ok(fs.readFileSync(f, 'utf8').trim().length > 0);
});
test('fork なしは resume の ID のまま', async () => {
  const r = await runClaude({ ...mockBin, args: buildClaudeArgs({ resumeId: 'S1', fork: false }), stdin: 'Q', cwd, timeoutMs: 5000 });
  assert.equal(r.sessionId, 'S1');
});
test('fork で --session-id なしなら新しい UUID', async () => {
  const r = await runClaude({ ...mockBin, args: buildClaudeArgs({ resumeId: 'M', fork: true }), stdin: 'Q', cwd, timeoutMs: 5000 });
  assert.match(r.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
test('回答本文は判定語と引用の先頭20字', async () => {
  const quote = 'あいうえおかきくけこさしすせそたちつてとなにぬねの';
  const cases = [['question', '質問'], ['detail', '詳しく'], ['term', '用語'], ['diagram', 'mermaid']];
  for (const [action, word] of cases) {
    const stdin = buildPrompt(action, quote, 'なぜ？');
    const r = await runClaude({ ...mockBin, args, stdin, cwd, timeoutMs: 5000 });
    assert.equal(r.result, `（偽）${word}：${quote.slice(0, 20)}`);
  }
});
test('タイムアウト', async () => {
  const t0 = Date.now();
  await assert.rejects(runClaude({ ...mockBin, args, stdin: '@@SLOW', cwd, timeoutMs: 200 }), (e) => e instanceof ClaudeError && e.kind === 'timeout' && /タイムアウト/.test(e.message));
  assert.ok(Date.now() - t0 < 2500);
});
test('abort', async () => {
  const ac = new AbortController();
  const p = runClaude({ ...mockBin, args, stdin: '@@SLOW', cwd, timeoutMs: 5000, signal: ac.signal });
  setTimeout(() => ac.abort(), 150);
  await assert.rejects(p, (e) => e.kind === 'aborted');
});
test('最初から abort 済み', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(runClaude({ ...mockBin, args, stdin: 'Q', cwd, timeoutMs: 5000, signal: ac.signal }), (e) => e.kind === 'aborted');
});
test('終了コード 1', async () => {
  await assert.rejects(runClaude({ ...mockBin, args, stdin: '@@FAIL', cwd, timeoutMs: 5000 }), (e) => e.kind === 'exit' && /終了コード 1/.test(e.message) && /mock fail/.test(e.message));
});
test('壊れた JSON', async () => {
  await assert.rejects(runClaude({ ...mockBin, args, stdin: '@@BADJSON', cwd, timeoutMs: 5000 }), (e) => e.kind === 'parse');
});
test('is_error', async () => {
  await assert.rejects(runClaude({ ...mockBin, args, stdin: '@@ISERROR', cwd, timeoutMs: 5000 }), (e) => e.kind === 'is_error');
});
test('起動できない bin は exit', async () => {
  await assert.rejects(runClaude({ bin: { cmd: path.join(cwd, 'no-such-bin'), prefixArgs: [] }, args, stdin: 'Q', cwd, timeoutMs: 5000 }), (e) => e.kind === 'exit');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
async function waitFile(f) {
  for (let i = 0; i < 200; i++) {
    if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') !== '') return Number(fs.readFileSync(f, 'utf8'));
    await sleep(20);
  }
  throw new Error(`${f} ができません`);
}

test('SIGTERM を無視する子も止め、子が終わってから拒否する', async () => {
  const pidFile = path.join(cwd, 'stubborn.pid');
  fs.rmSync(pidFile, { force: true });
  const ac = new AbortController();
  const p = runClaude({ ...mockBin, args, stdin: '@@STUBBORN', cwd, timeoutMs: 20000, signal: ac.signal, killGraceMs: 300 });
  const pid = await waitFile(pidFile);
  ac.abort();
  await assert.rejects(p, (e) => e.kind === 'aborted');
  assert.equal(alive(pid), false, '拒否の時点で子がまだ生きている');
});

test('タイムアウトでも子が終わってから拒否する', async () => {
  const pidFile = path.join(cwd, 'stubborn.pid');
  fs.rmSync(pidFile, { force: true });
  const p = runClaude({ ...mockBin, args, stdin: '@@STUBBORN', cwd, timeoutMs: 1000, killGraceMs: 300 });
  const pid = await waitFile(pidFile);
  await assert.rejects(p, (e) => e.kind === 'timeout');
  assert.equal(alive(pid), false, '拒否の時点で子がまだ生きている');
});

test('POSIX では孫プロセスもまとめて止める', { skip: process.platform === 'win32' }, async () => {
  const pidFile = path.join(cwd, 'grandchild.pid');
  fs.rmSync(pidFile, { force: true });
  const ac = new AbortController();
  const p = runClaude({ ...mockBin, args, stdin: '@@GRANDCHILD', cwd, timeoutMs: 20000, signal: ac.signal, killGraceMs: 300 });
  const pid = await waitFile(pidFile);
  ac.abort();
  await assert.rejects(p, (e) => e.kind === 'aborted');
  // 孫は init に引き取られてから回収されるので、少しだけ待つ
  for (let i = 0; i < 50 && alive(pid); i++) await sleep(20);
  assert.equal(alive(pid), false, '孫が生きている');
});

test('終了コードが 0 以外でも、stdout の JSON の result を伝える', async () => {
  await assert.rejects(runClaude({ ...mockBin, args, stdin: '@@ERRJSON', cwd, timeoutMs: 5000 }),
    (e) => e.kind === 'exit' && /終了コード 1/.test(e.message) && /認証が切れています/.test(e.message));
});
