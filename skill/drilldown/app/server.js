#!/usr/bin/env node
// drilldown の起動。引数を読み、サーバーを立て、url.txt を書き、ブラウザを開く。
// console の出力は <dir>/server.log に書く。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.js';
import { findLatestSession, resolveSessionCwd } from './lib/paths.js';
import { makeToken } from './lib/security.js';
import { resolveClaudeBin } from './lib/claude.js';
import { createApp, removePidFile } from './lib/app.js';
import { openBrowser } from './lib/open-browser.js';

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
const { dir } = args;
fs.mkdirSync(dir, { recursive: true });

const logFile = path.join(dir, 'server.log');
const log = (level) => (...parts) => {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${parts.map((p) => (p instanceof Error ? p.stack : String(p))).join(' ')}\n`);
  } catch { /* ログが書けなくても続ける */ }
};
console.log = log('info');
console.warn = log('warn');
console.error = log('error');

// 想定外のエラーは server.log に残してから終了コード 1 で終わる
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (err) => {
    console.error(`${ev}:`, err instanceof Error ? err : new Error(String(err)));
    process.exit(1);
  });
}

const homeDir = os.homedir();
const realCwd = (() => {
  try {
    return fs.realpathSync.native(args.cwd);
  } catch {
    return args.cwd;
  }
})();
const mainSessionId = args.session ?? findLatestSession(homeDir, args.cwd) ?? findLatestSession(homeDir, realCwd);
if (!mainSessionId) {
  console.error(`メインのセッションが見つかりません（--cwd: ${args.cwd}）。~/.claude/projects/ の下に、このフォルダのセッションがありません。`);
  process.exit(1);
}
// メインの jsonl が実際にあるフォルダを作業フォルダとして使う（分岐の起動と削除の両方）。
// メインの Claude が cd していたり symlink を通っていたりすると、--cwd とずれることがある。
const cwd = resolveSessionCwd(homeDir, args.cwd, mainSessionId);
if (!cwd) {
  console.error(`メインのセッション ${mainSessionId} の記録（.jsonl）が ~/.claude/projects/ の下に見つかりません（--cwd: ${args.cwd}）。分岐できないので終了します。`);
  process.exit(1);
}
if (cwd !== args.cwd) console.log(`作業フォルダを ${args.cwd} から ${cwd} に読み替えました（メインのセッションの記録がある場所）`);

const sec = Number(process.env.DRILLDOWN_TIMEOUT_SEC);
const timeoutMs = (Number.isFinite(sec) && sec > 0 ? sec : 300) * 1000;
const token = makeToken();
const here = path.dirname(fileURLToPath(import.meta.url));

let app;
try {
  app = await createApp({
    dir, mainSessionId, cwd, token, homeDir, timeoutMs,
    publicDir: path.join(here, 'public'),
    claudeBin: resolveClaudeBin(process.env),
  });
} catch (e) {
  console.error(`起動できませんでした: ${e.message}`);
  process.exit(1);
}

const url = `http://127.0.0.1:${app.port}/?t=${token}`;
fs.writeFileSync(path.join(dir, 'url.txt'), url);
fs.writeFileSync(path.join(dir, 'server.pid'), String(process.pid));
// 想定外のエラーで process.exit(1) したときも server.pid を残さない
process.on('exit', () => { removePidFile(dir); });

openBrowser(url, { onError: (e) => console.warn(`ブラウザを開けませんでした: ${e.message}`) });

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { app.shutdown('signal'); });
