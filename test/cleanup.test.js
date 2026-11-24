import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deleteSessions } from '../skill/drilldown/app/lib/cleanup.js';
import { projectDir, sessionFile } from '../skill/drilldown/app/lib/paths.js';

// 作った一時フォルダはテストの最後に消す
const TMP_DIRS = [];
const keep = (d) => { TMP_DIRS.push(d); return d; };
after(() => { for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true }); });

const CWD = '/Users/a/proj';
const MAIN = 'aaaaaaaa-1111-2222-3333-444444444444';
const FORK = 'bbbbbbbb-1111-2222-3333-444444444444';
const FORK2 = 'cccccccc-1111-2222-3333-444444444444';

function setup() {
  const home = keep(fs.mkdtempSync(path.join(os.tmpdir(), 'drilldown-cleanup-')));
  fs.mkdirSync(projectDir(home, CWD, 'darwin'), { recursive: true });
  return home;
}
const make = (home, id) => {
  const f = sessionFile(home, CWD, id, 'darwin');
  fs.writeFileSync(f, '{}\n');
  return f;
};

test('メインは消さない', () => {
  const home = setup();
  const m = make(home, MAIN);
  const f = make(home, FORK);
  const removed = deleteSessions({ homeDir: home, cwd: CWD, ids: [MAIN, FORK], mainSessionId: MAIN, platform: 'darwin' });
  assert.ok(fs.existsSync(m));
  assert.ok(!fs.existsSync(f));
  assert.deepEqual(removed, [f]);
});

test('../ を含む ID は無視', () => {
  const home = setup();
  const victim = path.join(home, '.claude', 'projects', 'x.jsonl');
  fs.writeFileSync(victim, '{}');
  assert.deepEqual(deleteSessions({ homeDir: home, cwd: CWD, ids: ['../x', '../../x', 'a/b', ''], mainSessionId: MAIN, platform: 'darwin' }), []);
  assert.ok(fs.existsSync(victim));
});

test('形式に合わない ID（短い・16進でない・長すぎる）は無視', () => {
  const home = setup();
  for (const id of ['abc', 'zzzzzzzz', 'a'.repeat(65), 123, null]) {
    assert.deepEqual(deleteSessions({ homeDir: home, cwd: CWD, ids: [id], mainSessionId: MAIN, platform: 'darwin' }), []);
  }
});

test('同名ディレクトリも消す', () => {
  const home = setup();
  const f = make(home, FORK);
  const d = f.slice(0, -'.jsonl'.length);
  fs.mkdirSync(path.join(d, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(d, 'subagents', 'x.jsonl'), '{}');
  const removed = deleteSessions({ homeDir: home, cwd: CWD, ids: [FORK], mainSessionId: MAIN, platform: 'darwin' });
  assert.deepEqual(removed, [f, d]);
  assert.ok(!fs.existsSync(d));
});

test('同名ディレクトリだけが残っていても消す', () => {
  const home = setup();
  const d = sessionFile(home, CWD, FORK, 'darwin').slice(0, -'.jsonl'.length);
  fs.mkdirSync(d);
  assert.deepEqual(deleteSessions({ homeDir: home, cwd: CWD, ids: [FORK], mainSessionId: MAIN, platform: 'darwin' }), [d]);
});

test('無い ID は黙って飛ばす。メインと同名のディレクトリにも触れない', () => {
  const home = setup();
  const md = sessionFile(home, CWD, MAIN, 'darwin').slice(0, -'.jsonl'.length);
  fs.mkdirSync(md);
  const f2 = make(home, FORK2);
  const removed = deleteSessions({ homeDir: home, cwd: CWD, ids: [FORK, MAIN, FORK2, FORK2], mainSessionId: MAIN, platform: 'darwin' });
  assert.deepEqual(removed, [f2]);
  assert.ok(fs.existsSync(md));
});

test('mainSessionId が無ければ投げて何も消さない', () => {
  const home = setup();
  const f = make(home, FORK);
  for (const bad of [undefined, null, '', '  ', 5]) {
    assert.throws(() => deleteSessions({ homeDir: home, cwd: CWD, ids: [FORK], mainSessionId: bad, platform: 'darwin' }), /メインのセッション ID/);
  }
  assert.ok(fs.existsSync(f));
});

test('ids が無くても落ちない', () => {
  const home = setup();
  assert.deepEqual(deleteSessions({ homeDir: home, cwd: CWD, ids: undefined, mainSessionId: MAIN, platform: 'darwin' }), []);
});
