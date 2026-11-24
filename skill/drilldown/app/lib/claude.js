// claude -p を子プロセスとして呼び出す。
import { spawn } from 'node:child_process';
import { SYSTEM_APPEND } from './prompts.js';

export class ClaudeError extends Error {
  // kind: 'timeout' | 'exit' | 'parse' | 'aborted' | 'is_error'
  constructor(kind, message) {
    super(message);
    this.name = 'ClaudeError';
    this.kind = kind;
  }
}

// プロンプトは引数に入れず stdin で渡す（長さと引用符の問題を避ける）。
export function buildClaudeArgs({ resumeId, fork, newSessionId, effort }) {
  return [
    '-p', '--resume', resumeId,
    ...(fork ? ['--fork-session'] : []),
    ...(newSessionId ? ['--session-id', newSessionId] : []),
    '--output-format', 'json',
    '--append-system-prompt', SYSTEM_APPEND,
    '--permission-mode', 'default',
    '--disallowedTools', 'Edit', 'Write', 'NotebookEdit',
    ...(effort ? ['--effort', 'low'] : []),
  ];
}

export function resolveClaudeBin(env = process.env) {
  const bin = env.DRILLDOWN_CLAUDE_BIN;
  if (!bin) return { cmd: 'claude', prefixArgs: [] };
  if (bin.endsWith('.js')) return { cmd: process.execPath, prefixArgs: [bin] };
  return { cmd: bin, prefixArgs: [] };
}

const STDERR_TAIL = 300;
const RESULT_TAIL = 500;
const KILL_GRACE_MS = 3000;
const IS_WIN = process.platform === 'win32';

function tail(text, n) {
  const t = text.trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

// 終了コードが 0 以外でも、stdout に claude の JSON（is_error / result）があれば、その result を返す。
function resultFromStdout(stdout) {
  try {
    const json = JSON.parse(stdout);
    if (json && typeof json === 'object' && typeof json.result === 'string' && json.result.trim() !== '') {
      return tail(json.result, RESULT_TAIL);
    }
  } catch { /* JSON でなければ使わない */ }
  return '';
}

// 子に sig を送る。POSIX では子をプロセスグループの長として起動しているので（detached）、
// グループごと送り、claude が起こした孫（MCP サーバーやツールのコマンド）もまとめて止める。
// Windows では子だけ（child.kill）。
function killTree(child, sig) {
  try {
    if (!IS_WIN && child.pid) process.kill(-child.pid, sig);
    else child.kill(sig);
  } catch {
    try { child.kill(sig); } catch { /* すでに終わっている */ }
  }
}

// bin は resolveClaudeBin() の戻り値 {cmd, prefixArgs}（文字列でもよい）。
// 中断・タイムアウトのときは、子が本当に終わるのを待ってから拒否する
// （SIGTERM → killGraceMs 待つ → SIGKILL → また killGraceMs まで待つ）。
export function runClaude({ bin, args, stdin, cwd, timeoutMs, signal, killGraceMs = KILL_GRACE_MS }) {
  const { cmd, prefixArgs } = typeof bin === 'string' ? { cmd: bin, prefixArgs: [] } : bin;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ClaudeError('aborted', '処理が中断されました。'));
      return;
    }
    let child;
    try {
      child = spawn(cmd, [...prefixArgs, ...args], {
        cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN,
      });
    } catch (e) {
      reject(new ClaudeError('exit', `claude を起動できませんでした：${e.message}`));
      return;
    }

    let settled = false;
    let stopping = false;
    let exited = false;
    let stdout = '';
    let stderr = '';
    let timer = null;
    const exitWaiters = [];
    const markExited = () => {
      exited = true;
      for (const w of exitWaiters.splice(0)) w();
    };
    // 子が終わるか ms たつまで待つ。終わっていれば true
    const waitExit = (ms) => new Promise((res) => {
      if (exited) {
        res(true);
        return;
      }
      const t = setTimeout(() => res(exited), ms);
      exitWaiters.push(() => { clearTimeout(t); res(true); });
    });
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const stop = async (error) => {
      if (settled || stopping) return;
      stopping = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (!exited) {
        killTree(child, 'SIGTERM');
        if (!(await waitExit(killGraceMs))) {
          killTree(child, 'SIGKILL');
          await waitExit(killGraceMs);
        }
      }
      finish(reject, error);
    };
    const onAbort = () => { stop(new ClaudeError('aborted', '処理が中断されました。')); };

    timer = setTimeout(() => {
      stop(new ClaudeError('timeout', `claude の応答が ${Math.round(timeoutMs / 1000)} 秒以内に終わらなかったため、タイムアウトしました。`));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.on('error', () => { /* 子が先に終わった場合の EPIPE は close 側で扱う */ });
    child.on('error', (e) => {
      markExited();
      if (stopping) return;
      finish(reject, new ClaudeError('exit', `claude を起動できませんでした：${e.message}`));
    });
    child.on('exit', markExited);
    child.on('close', (code) => {
      markExited();
      if (settled || stopping) return;
      if (code !== 0) {
        const detail = [resultFromStdout(stdout), tail(stderr, STDERR_TAIL)].filter((x) => x).join('\n');
        finish(reject, new ClaudeError('exit', `claude が終了コード ${code} で終了しました。${detail ? `\n${detail}` : ''}`));
        return;
      }
      let json;
      try {
        json = JSON.parse(stdout);
      } catch {
        finish(reject, new ClaudeError('parse', 'claude の出力を JSON として読めませんでした。'));
        return;
      }
      if (!json || typeof json !== 'object') {
        finish(reject, new ClaudeError('parse', 'claude の出力の形が想定と違います。'));
        return;
      }
      if (json.is_error) {
        const detail = typeof json.result === 'string' && json.result ? `：${json.result}` : '';
        finish(reject, new ClaudeError('is_error', `claude がエラーを返しました${detail}`));
        return;
      }
      if (typeof json.result !== 'string' || typeof json.session_id !== 'string' || !json.session_id) {
        finish(reject, new ClaudeError('parse', 'claude の出力に result か session_id がありません。'));
        return;
      }
      finish(resolve, { result: json.result, sessionId: json.session_id });
    });

    child.stdin.end(stdin ?? '');
  });
}
