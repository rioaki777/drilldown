import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../skill/drilldown/app/lib/store.js';

// 作った一時フォルダはテストの最後に消す
const TMP_DIRS = [];
const keep = (d) => { TMP_DIRS.push(d); return d; };
after(() => { for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true }); });

const tmp = () => keep(fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-')));

test('新規は初期状態で warnings 空', () => {
  const s = createStore(tmp());
  assert.deepEqual(s.state, { version: 1, nextId: 1, threads: {}, turns: {}, decisions: {}, createdSessionIds: [] });
  assert.deepEqual(s.warnings, []);
});

test('保存して新しい store で読み直すと同じ', () => {
  const dir = tmp();
  const a = createStore(dir);
  const t = a.newId('t');
  a.state.threads[t] = { id: t, parentThreadId: null, parentTurnId: null, quote: 'q', sessionId: null, carryBack: false, note: '', decisionIds: [], turnIds: [], createdAt: '2026-01-01T00:00:00.000Z' };
  a.state.createdSessionIds.push('sess-1');
  a.save();
  assert.ok(!fs.existsSync(path.join(dir, 'state.json.tmp')));
  const b = createStore(dir);
  assert.deepEqual(b.state, a.state);
});

test('save は 2 スペースの整形 JSON', () => {
  const dir = tmp();
  createStore(dir).save();
  const text = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
  assert.match(text, /^\{\n  "version": 1,/);
});

test('running の turn は error になる', () => {
  const dir = tmp();
  const a = createStore(dir);
  const base = { threadId: 't1', action: 'ask', question: 'x', answerMd: null, error: null, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: null };
  a.state.turns.u1 = { id: 'u1', status: 'running', ...base };
  a.state.turns.u2 = { id: 'u2', status: 'done', ...base, answerMd: 'ok', finishedAt: '2026-01-01T00:00:01.000Z' };
  a.save();
  const b = createStore(dir);
  assert.equal(b.state.turns.u1.status, 'error');
  assert.equal(b.state.turns.u1.error, 'サーバーが再起動しました');
  assert.match(b.state.turns.u1.finishedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.equal(b.state.turns.u2.status, 'done');
  assert.equal(b.state.turns.u2.answerMd, 'ok');
});

test('newId は単調増加で t と u が共通カウンタ', () => {
  const s = createStore(tmp());
  assert.deepEqual([s.newId('t'), s.newId('u'), s.newId('t')], ['t1', 'u2', 't3']);
});

test('nextId は保存をまたいで続く', () => {
  const dir = tmp();
  const a = createStore(dir);
  a.newId('t');
  a.newId('u');
  a.save();
  assert.equal(createStore(dir).newId('t'), 't3');
});

test('initDecisions は既存の判断を上書きしない', () => {
  const s = createStore(tmp());
  s.initDecisions([{ id: 'd1' }, { id: 'd2' }]);
  assert.deepEqual(s.state.decisions.d1, { status: '未決', judgement: '', reason: '', threadIds: [] });
  s.state.decisions.d1 = { status: '決定', judgement: 'A', reason: 'r', threadIds: ['t1'] };
  s.initDecisions([{ id: 'd1' }, { id: 'd3' }]);
  assert.deepEqual(s.state.decisions.d1, { status: '決定', judgement: 'A', reason: 'r', threadIds: ['t1'] });
  assert.deepEqual(Object.keys(s.state.decisions), ['d1', 'd2', 'd3']);
});

test('壊れた state.json は退避して新規開始、warnings に記録', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'state.json'), '{not json');
  const s = createStore(dir);
  assert.equal(s.state.nextId, 1);
  assert.equal(s.warnings.length, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'state.json')));
  const broken = fs.readdirSync(dir).filter((f) => f.startsWith('state.json.broken-'));
  assert.equal(broken.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, broken[0]), 'utf8'), '{not json');
});
