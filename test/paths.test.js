import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectSlug, projectDir, sessionFile, findLatestSession, resolveSessionCwd } from '../skill/drilldown/app/lib/paths.js';

// 作った一時フォルダはテストの最後に消す
const TMP_DIRS = [];
const keep = (d) => { TMP_DIRS.push(d); return d; };
after(() => { for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true }); });

function tmp() {
  return keep(fs.mkdtempSync(path.join(os.tmpdir(), 'drilldown-paths-')));
}

test('mac の slug', () => assert.equal(projectSlug('/Users/a/my.proj', 'darwin'), '-Users-a-my-proj'));
test('windows の slug', () => assert.equal(projectSlug('D:\\clientapp\\x', 'win32'), 'D--clientapp-x'));
test('windows では / も - になる', () => assert.equal(projectSlug('C:/Users/a', 'win32'), 'C--Users-a'));
test('英数字以外はすべて - になる（_ . 空白 日本語）', () => {
  assert.equal(projectSlug('slug_a.b c日本', 'win32'), 'slug-a-b-c--');
  assert.equal(projectSlug('/a/b:c\\d', 'linux'), '-a-b-c-d');
});
test('プラットフォームで規則は変わらない', () => {
  const p = 'C:\\Users\\a b/c_d';
  assert.equal(projectSlug(p, 'win32'), projectSlug(p, 'darwin'));
});

test('projectDir は <home>/.claude/projects/<slug>', () => {
  assert.equal(projectDir('/h', '/Users/a/p', 'darwin'), path.join('/h', '.claude', 'projects', '-Users-a-p'));
});

test('sessionFile は <projectDir>/<id>.jsonl', () => {
  assert.equal(sessionFile('/h', '/Users/a/p', 'abc', 'darwin'), path.join('/h', '.claude', 'projects', '-Users-a-p', 'abc.jsonl'));
});

test('最新セッション', () => {
  const home = tmp();
  const cwd = '/Users/a/p';
  const dir = projectDir(home, cwd, 'darwin');
  fs.mkdirSync(dir, { recursive: true });
  const a = path.join(dir, 'a.jsonl');
  const b = path.join(dir, 'b.jsonl');
  fs.writeFileSync(a, '{}\n');
  fs.writeFileSync(b, '{}\n');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'x');
  fs.utimesSync(a, new Date(1000000), new Date(1000000));
  fs.utimesSync(b, new Date(2000000), new Date(2000000));
  fs.utimesSync(path.join(dir, 'c.txt'), new Date(3000000), new Date(3000000));
  assert.equal(findLatestSession(home, cwd, 'darwin'), 'b');
});

test('projects フォルダが無ければ null', () => {
  assert.equal(findLatestSession(tmp(), '/Users/a/p'), null);
});

test('jsonl が1つも無ければ null', () => {
  const home = tmp();
  fs.mkdirSync(projectDir(home, '/x', 'darwin'), { recursive: true });
  assert.equal(findLatestSession(home, '/x', 'darwin'), null);
});

// resolveSessionCwd：メインの jsonl が見つかる作業フォルダを決める
const MAIN_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const writeMain = (home, cwd, lines) => {
  const f = sessionFile(home, cwd, MAIN_ID);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return f;
};

test('resolveSessionCwd：そのままの cwd で見つかればそれを返す', () => {
  const home = tmp();
  writeMain(home, '/Users/a/p', [{ type: 'user', cwd: '/elsewhere' }]);
  assert.equal(resolveSessionCwd(home, '/Users/a/p', MAIN_ID), '/Users/a/p');
});

test('resolveSessionCwd：実パスで見つかれば実パスを返す（symlink）', (t) => {
  const home = tmp();
  const real = fs.realpathSync.native(tmp());
  const link = path.join(tmp(), 'link');
  try {
    fs.symlinkSync(real, link, 'junction');
  } catch {
    t.skip('symlink を作れない環境');
    return;
  }
  writeMain(home, real, [{ type: 'user' }]);
  assert.equal(resolveSessionCwd(home, link, MAIN_ID), real);
});

test('resolveSessionCwd：projects を探し、jsonl の cwd を使う', () => {
  const home = tmp();
  // 先頭の行には cwd が無く、後の行にある
  writeMain(home, '/Users/a/real proj', [{ type: 'summary' }, { type: 'user', cwd: '/Users/a/real proj' }, { type: 'user', cwd: '/Users/a/other' }]);
  assert.equal(resolveSessionCwd(home, '/Users/a/real proj/sub', MAIN_ID), '/Users/a/real proj');
});

test('resolveSessionCwd：壊れた行は飛ばす', () => {
  const home = tmp();
  const f = sessionFile(home, '/p', MAIN_ID);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `{壊れ\n${JSON.stringify({ cwd: 42 })}\n${JSON.stringify({ cwd: '/p' })}\n`);
  assert.equal(resolveSessionCwd(home, '/q', MAIN_ID), '/p');
});

test('resolveSessionCwd：先頭50行に cwd が無ければ null', () => {
  const home = tmp();
  const lines = Array.from({ length: 50 }, () => ({ type: 'x' }));
  writeMain(home, '/p', [...lines, { cwd: '/p' }]);
  assert.equal(resolveSessionCwd(home, '/q', MAIN_ID), null);
});

test('resolveSessionCwd：どこにも無ければ null', () => {
  const home = tmp();
  assert.equal(resolveSessionCwd(home, '/q', MAIN_ID), null);
  fs.mkdirSync(path.join(home, '.claude', 'projects', '-x'), { recursive: true });
  assert.equal(resolveSessionCwd(home, '/q', MAIN_ID), null);
});
