#!/usr/bin/env node
// テスト用の偽の claude。`claude -p --resume <id> [--fork-session] [--session-id <id>] ...` の
// 引数を読み、stdin を読み、セッションの jsonl に1行追記して、claude の JSON 出力と同じ形を返す。
//   stdin に @@SLOW を含む → 3 秒待つ / @@FAIL → 終了コード 1 / @@BADJSON → 壊れた JSON / @@ISERROR → is_error:true
//   @@ERRJSON → is_error の JSON を出して終了コード 1
//   @@STUBBORN → SIGTERM を無視して 30 秒待つ（pid を <cwd>/stubborn.pid に書く）
//   @@GRANDCHILD → 孫プロセスを作って 30 秒待つ（孫の pid を <cwd>/grandchild.pid に書く）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { projectDir } from '../skill/drilldown/app/lib/paths.js';
import { ACTION_PROMPTS } from '../skill/drilldown/app/lib/prompts.js';

// 判定語：ACTION_PROMPTS の冒頭の文に対応させる（プロンプト文言を変えたらここも合わせる）。
const WORDS = { question: '質問', detail: '詳しく', term: '用語', diagram: 'mermaid' };

function judge(stdin) {
  for (const [action, template] of Object.entries(ACTION_PROMPTS)) {
    const head = template.split('\n')[0];
    if (stdin.startsWith(head)) return WORDS[action];
  }
  return '不明';
}

function quoteHead(stdin) {
  const lines = stdin.split('\n').filter((l) => l.startsWith('> ')).map((l) => l.slice(2));
  return lines.join('\n').slice(0, 20);
}

function parse(argv) {
  const get = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return { resume: get('--resume'), fork: argv.includes('--fork-session'), sessionId: get('--session-id') };
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const { resume, fork, sessionId } = parse(process.argv.slice(2));
const stdin = await readStdin();

if (stdin.includes('@@SLOW')) await new Promise((r) => setTimeout(r, 3000));
if (stdin.includes('@@STUBBORN')) {
  process.on('SIGTERM', () => { /* 無視する */ });
  fs.writeFileSync(path.join(process.cwd(), 'stubborn.pid'), String(process.pid));
  await new Promise((r) => setTimeout(r, 30000));
}
if (stdin.includes('@@GRANDCHILD')) {
  const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(process.cwd(), 'grandchild.pid'), String(g.pid));
  await new Promise((r) => setTimeout(r, 30000));
}
if (stdin.includes('@@ERRJSON')) {
  process.stdout.write(`${JSON.stringify({ type: 'result', is_error: true, result: '（偽）認証が切れています' })}
`);
  process.exit(1);
}
if (stdin.includes('@@FAIL')) {
  process.stderr.write('mock fail: 偽の claude が失敗しました\n');
  process.exit(1);
}

const id = sessionId || (fork ? crypto.randomUUID() : resume);
const answer = `（偽）${judge(stdin)}：${quoteHead(stdin)}`;

const dir = projectDir(os.homedir(), process.cwd());
fs.mkdirSync(dir, { recursive: true });
fs.appendFileSync(path.join(dir, `${id}.jsonl`), `${JSON.stringify({ type: 'assistant', message: answer })}\n`);

if (stdin.includes('@@BADJSON')) {
  process.stdout.write('{"type":"result", 壊れた');
} else {
  const isError = stdin.includes('@@ISERROR');
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: isError,
    result: isError ? '（偽）エラーです' : answer,
    session_id: id,
  })}\n`);
}
