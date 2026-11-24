// Claude Code のセッション jsonl の置き場所を求める。
import fs from 'node:fs';
import path from 'node:path';

// 作業フォルダのパスを、~/.claude/projects 配下のフォルダ名に変える。
// 英数字（a-z A-Z 0-9）以外のすべての文字を - に置き換える（UTF-16 のコード単位ごと。u フラグは付けない）。
// 例: cwd "/Users/me/work/slug_a.b c日本" はフォルダ "-Users-me-work-slug-a-b-c--" になる
// （claude 2.1.331 で実測して確かめた規則）
// （_ . 空白 日 本 がそれぞれ - になる）。この規則はどの OS でも同じ。
// platform は互換のために引数に残してあるが、規則は変えない。
export function projectSlug(cwd, platform = process.platform) { // eslint-disable-line no-unused-vars
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function projectDir(homeDir, cwd, platform = process.platform) {
  return path.join(homeDir, '.claude', 'projects', projectSlug(cwd, platform));
}

export function sessionFile(homeDir, cwd, id, platform = process.platform) {
  return path.join(projectDir(homeDir, cwd, platform), `${id}.jsonl`);
}

// projectDir 内の .jsonl のうち、更新日時が最も新しいものの ID（拡張子なし）。無ければ null。
export function findLatestSession(homeDir, cwd, platform = process.platform) {
  const dir = projectDir(homeDir, cwd, platform);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let best = null;
  let bestTime = -Infinity;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    let st;
    try {
      st = fs.statSync(path.join(dir, name));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.mtimeMs > bestTime) {
      bestTime = st.mtimeMs;
      best = name.slice(0, -'.jsonl'.length);
    }
  }
  return best;
}

const HEAD_LINES = 50;
const HEAD_BYTES = 4 * 1024 * 1024;

// ファイルの先頭 maxLines 行（最大 HEAD_BYTES バイト）を読む。
function readHeadLines(file, maxLines) {
  const fd = fs.openSync(file, 'r');
  try {
    const chunks = [];
    let total = 0;
    let newlines = 0;
    const buf = Buffer.alloc(64 * 1024);
    while (total < HEAD_BYTES && newlines < maxLines) {
      const n = fs.readSync(fd, buf, 0, buf.length, total);
      if (n === 0) break;
      const part = Buffer.from(buf.subarray(0, n));
      chunks.push(part);
      total += n;
      for (const b of part) if (b === 0x0a) newlines += 1;
    }
    return Buffer.concat(chunks).toString('utf8').split('\n').slice(0, maxLines);
  } finally {
    fs.closeSync(fd);
  }
}

// jsonl の先頭 50 行のうち、最初に "cwd"（文字列）を持つ行の cwd。無ければ null。
function cwdFromJsonl(file) {
  let lines;
  try {
    lines = readHeadLines(file, HEAD_LINES);
  } catch {
    return null;
  }
  for (const line of lines) {
    if (!line.includes('"cwd"')) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v.cwd === 'string' && v.cwd !== '') return v.cwd;
    } catch { /* 壊れた行・途中で切れた行は飛ばす */ }
  }
  return null;
}

// メインのセッション <mainId>.jsonl が見つかる作業フォルダを返す。見つからなければ null。
// 1. そのままの cwd  2. cwd の実パス（symlink・/private など）
// 3. ~/.claude/projects/*/<mainId>.jsonl を探し、その先頭 50 行にある "cwd"
// （メインの Claude が cd していて $(pwd) がずれた場合）
export function resolveSessionCwd(homeDir, cwd, mainId, platform = process.platform) {
  const exists = (c) => {
    try {
      return fs.statSync(sessionFile(homeDir, c, mainId, platform)).isFile();
    } catch {
      return false;
    }
  };
  if (exists(cwd)) return cwd;
  let real = null;
  try {
    real = fs.realpathSync.native(cwd);
  } catch { /* 無いフォルダ */ }
  if (real && real !== cwd && exists(real)) return real;

  const root = path.join(homeDir, '.claude', 'projects');
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const name of names) {
    const file = path.join(root, name, `${mainId}.jsonl`);
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const found = cwdFromJsonl(file);
    if (found) return found;
  }
  return null;
}
