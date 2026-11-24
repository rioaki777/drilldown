// 本物の claude で「分岐の作り方」を確かめるプローブ（Task 3 Step 1 / Task 12 の mac-check 用）。
//   node dev/probe-fork.mjs
// 使い捨てのフォルダで使い捨てのメインセッションを自分で作り、次の3点を調べて、最後に作ったものを全部消す。
//   (a) --resume <main> --fork-session --session-id <新UUID> が受け付けられ、返る session_id が新 UUID と一致するか
//   (b) 続けて --resume <fork>（fork なし）で session_id が変わるか
//   (c) メインの jsonl のサイズ・mtime が前後で変わらないか
// 他のセッションには触らない（消すのは、使い捨てフォルダに対応するプロジェクトフォルダの中だけ）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildClaudeArgs, resolveClaudeBin, runClaude } from '../skill/drilldown/app/lib/claude.js';
import { projectDir } from '../skill/drilldown/app/lib/paths.js';

const TIMEOUT_MS = 180_000;
const bin = resolveClaudeBin();

const tmpRoot = fs.realpathSync(os.tmpdir());
const work = fs.mkdtempSync(path.join(tmpRoot, 'drilldown-probe-'));
const pdir = projectDir(os.homedir(), work);

const rows = [];
const row = (item, result, note = '') => rows.push([item, result, note]);

function statOf(file) {
  const st = fs.statSync(file);
  return { size: st.size, mtimeMs: st.mtimeMs };
}

async function call(args, prompt) {
  const r = await runClaude({ bin, args, stdin: prompt, cwd: work, timeoutMs: TIMEOUT_MS });
  return r;
}

function cleanup() {
  // 使い捨てフォルダ専用のプロジェクトフォルダの中だけを消す
  const safe = path.basename(pdir).includes('drilldown-probe-') && pdir.startsWith(path.join(os.homedir(), '.claude', 'projects'));
  // このフォルダは使い捨て専用なので、中身（jsonl、同名フォルダ、claude が作る memory など）ごと消してよい
  if (safe) fs.rmSync(pdir, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
}

try {
  // メインの使い捨てセッションを作る
  const main = await call(['-p', '--output-format', 'json'], 'ok とだけ答えて');
  const mainFile = path.join(pdir, `${main.sessionId}.jsonl`);
  console.log(`使い捨てのフォルダ: ${work}`);
  console.log(`メインのセッション: ${main.sessionId}（jsonl ${fs.existsSync(mainFile) ? 'あり' : 'なし'}）`);
  const before = statOf(mainFile);

  // (a) --fork-session --session-id
  const newId = crypto.randomUUID();
  let forkId = null;
  try {
    const a = await call(buildClaudeArgs({ resumeId: main.sessionId, fork: true, newSessionId: newId }), 'もう一度 ok とだけ答えて');
    const same = a.sessionId === newId;
    row('(a) --fork-session --session-id を受け付け、返る session_id が指定どおり', same ? 'OK' : 'NG', `指定 ${newId} / 返り ${a.sessionId}`);
    forkId = a.sessionId;
  } catch (e) {
    row('(a) --fork-session --session-id を受け付け、返る session_id が指定どおり', 'NG', `${e.kind}: ${e.message.split('\n').join(' ').slice(0, 200)}`);
    // 参考：--session-id なしの fork は使えるか
    try {
      const a2 = await call(buildClaudeArgs({ resumeId: main.sessionId, fork: true }), 'もう一度 ok とだけ答えて');
      row('(a-参考) --session-id なしの --fork-session', a2.sessionId !== main.sessionId ? 'OK' : 'NG', `返り ${a2.sessionId}`);
      forkId = a2.sessionId;
    } catch (e2) {
      row('(a-参考) --session-id なしの --fork-session', 'NG', `${e2.kind}: ${e2.message.split('\n').join(' ').slice(0, 200)}`);
    }
  }

  // (b) fork したセッションを fork なしで続ける
  if (forkId) {
    try {
      const b = await call(buildClaudeArgs({ resumeId: forkId, fork: false }), 'さらに ok とだけ答えて');
      const changed = b.sessionId !== forkId;
      row('(b) fork なしの --resume で session_id が変わるか', changed ? '変わる' : '変わらない', `resume ${forkId} / 返り ${b.sessionId}`);
    } catch (e) {
      row('(b) fork なしの --resume で session_id が変わるか', 'エラー', `${e.kind}: ${e.message.split('\n').join(' ').slice(0, 200)}`);
    }
  } else {
    row('(b) fork なしの --resume で session_id が変わるか', '未実施', '分岐が作れなかった');
  }

  // (c) メインの jsonl が変わっていないか
  const after = statOf(mainFile);
  const unchanged = after.size === before.size && after.mtimeMs === before.mtimeMs;
  row('(c) メインの jsonl のサイズ・mtime が前後で同じ', unchanged ? 'OK' : 'NG',
    `size ${before.size} -> ${after.size} / mtime ${new Date(before.mtimeMs).toISOString()} -> ${new Date(after.mtimeMs).toISOString()}`);

  console.log('\n結果');
  for (const [item, result, note] of rows) console.log(`- ${item}\n    結果: ${result}\n    ${note}`);
} finally {
  cleanup();
  console.log(`\n後片付け: ${fs.existsSync(work) ? '一時フォルダが残っています' : '一時フォルダを削除'} / ${fs.existsSync(pdir) ? `プロジェクトフォルダが残っています（${pdir}）` : 'プロジェクトフォルダを削除'}`);
}
