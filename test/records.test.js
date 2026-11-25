import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeDirName, recordDirFor, renderRecordMd, renderReturnMd, writeRecord } from '../skill/drilldown/app/lib/records.js';

// 作った一時フォルダはテストの最後に消す
const TMP_DIRS = [];
const keep = (d) => { TMP_DIRS.push(d); return d; };
after(() => { for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true }); });

const tmp = () => keep(fs.mkdtempSync(path.join(os.tmpdir(), 'drilldown-records-')));

const decisions = [
  { id: 'd1', title: '再送上限は5回でよいか', quote: '最大5回再送する', context: '上限が無いと詰まる。', options: ['5回', '30分'], source: 'docs/notify.md:42' },
  { id: 'd2', title: '通知の宛先', quote: '宛先は別途', context: '', options: [], source: 'docs/notify.md:50' },
  { id: 'd3', title: 'ログの保存期間', quote: '保存期間は未定', context: '', options: [], source: '' },
];

function makeState() {
  return {
    threads: {
      t1: { id: 't1', parentThreadId: null, parentTurnId: null, quote: '最大5回再送する', sessionId: 's1', carryBack: true, note: '5回の根拠が薄い', decisionIds: ['d1'], turnIds: ['u1', 'u2'], createdAt: '2026-11-24T10:00:00.000Z' },
      t2: { id: 't2', parentThreadId: 't1', parentTurnId: 'u1', quote: '指数バックオフ', sessionId: 's2', carryBack: false, note: '', decisionIds: [], turnIds: ['u3'], createdAt: '2026-11-24T10:05:00.000Z' },
      t3: { id: 't3', parentThreadId: 't2', parentTurnId: 'u3', quote: '待ち時間の上限', sessionId: 's3', carryBack: false, note: '', decisionIds: [], turnIds: ['u4'], createdAt: '2026-11-24T10:06:00.000Z' },
      t4: { id: 't4', parentThreadId: null, parentTurnId: null, quote: 'キュー', sessionId: 's4', carryBack: false, note: '', decisionIds: [], turnIds: ['u5'], createdAt: '2026-11-24T09:00:00.000Z' },
    },
    turns: {
      u1: { id: 'u1', threadId: 't1', action: 'question', question: '5回で足りる理由は？', quote: '', status: 'done', answerMd: '根拠は文書にありません。過去の障害の話も出てきません。三つ目の文です。四つ目の文です。', error: null },
      u2: { id: 'u2', threadId: 't1', action: 'detail', question: '', quote: '', status: 'done', answerMd: '詳しく書くと次のとおりです。\n解説の訂正：「5回」は表では3回になっています\n- 解説の訂正：「5回」は表では3回になっています\n  解説の訂正： 別の訂正', error: null },
      u3: { id: 'u3', threadId: 't2', action: 'term', question: '', quote: '', status: 'done', answerMd: '待ち時間を倍にしていく方式です。', error: null },
      u4: { id: 'u4', threadId: 't3', action: 'question', question: '上限は？', quote: '', status: 'error', answerMd: null, error: '時間切れ' },
      u5: { id: 'u5', threadId: 't4', action: 'memo', question: 'あとで見る', quote: '', status: 'done', answerMd: null, error: null },
    },
    decisions: {
      d1: { status: '決定', judgement: '時間で打ち切る（30分）', reason: '運用で困るため', threadIds: ['t1', 't2'] },
      d2: { status: '保留', judgement: '', reason: '担当に確認する', threadIds: [] },
      d3: { status: '未決', judgement: '', reason: '', threadIds: [] },
    },
    createdSessionIds: ['s1', 's2', 's3', 's4'],
  };
}

const emptyState = () => ({ threads: {}, turns: {}, decisions: { d1: { status: '未決', judgement: '', reason: '', threadIds: [] } }, createdSessionIds: [] });
const args = (over = {}) => ({ title: '通知の設計', recordPath: '/h/.drilldown/records/x', sources: ['docs/notify.md'], state: makeState(), decisions, ...over });

test('危ない文字は置き換え', () => assert.equal(safeDirName('a/b:c?'), 'a_b_c_'));
test('制御文字と引用符なども置き換え', () => assert.equal(safeDirName('a\tb"c<d>e|f\\g*h'), 'a_b_c_d_e_f_g_h'));
test('前後の空白と . を除く', () => assert.equal(safeDirName(' ..abc. '), 'abc'));
test('空の題名', () => {
  assert.equal(safeDirName('  '), '無題');
  assert.equal(safeDirName('...'), '無題');
  assert.equal(safeDirName(''), '無題');
});
test('40 文字で切る', () => {
  assert.equal(Array.from(safeDirName('あ'.repeat(50))).length, 40);
  assert.equal(safeDirName(`${'a'.repeat(39)} bcd`), 'a'.repeat(39));
});

test('recordDirFor はローカル時刻を 0 埋めし、作らない', () => {
  const home = tmp();
  const dir = recordDirFor(home, new Date(2026, 0, 5, 3, 7), '題');
  assert.equal(dir, path.join(home, '.drilldown', 'records', '2026-01-05-0307-題'));
  assert.ok(!fs.existsSync(path.join(home, '.drilldown')));
});
test('同じ分は -2, -3', () => {
  const home = tmp();
  const now = new Date(2026, 10, 24, 14, 30);
  const first = recordDirFor(home, now, 't');
  fs.mkdirSync(first, { recursive: true });
  assert.match(recordDirFor(home, now, 't'), /-t-2$/);
  fs.mkdirSync(recordDirFor(home, now, 't'));
  assert.match(recordDirFor(home, now, 't'), /-t-3$/);
});

test('writeRecord はフォルダを作り record.md と record.html を書く', () => {
  const home = tmp();
  const dir = writeRecord({ homeDir: home, now: new Date(2026, 10, 24, 14, 30), title: 't', snapshotHtml: '<p>x</p>', recordMd: '# md' });
  assert.equal(fs.readFileSync(path.join(dir, 'record.md'), 'utf8'), '# md');
  assert.equal(fs.readFileSync(path.join(dir, 'record.html'), 'utf8'), '<p>x</p>');
});
test('snapshotHtml が null なら record.html は作らない', () => {
  const home = tmp();
  const dir = writeRecord({ homeDir: home, now: new Date(2026, 10, 24, 14, 30), title: 't', snapshotHtml: null, recordMd: '# md' });
  assert.ok(fs.existsSync(path.join(dir, 'record.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'record.html')));
});

test('持ち帰り：決定と未決', () => {
  const md = renderReturnMd(args());
  assert.match(md, /^# drilldown から持ち帰り：通知の設計$/m);
  assert.match(md, /^記録：\/h\/\.drilldown\/records\/x\/record\.html$/m);
  assert.match(md, /^元の文書：docs\/notify\.md$/m);
  assert.match(md, /^### d1 再送上限は5回でよいか — 決定$/m);
  assert.match(md, /^- 判断：時間で打ち切る（30分）$/m);
  assert.match(md, /^- 理由：運用で困るため$/m);
  assert.match(md, /^### d2 通知の宛先 — 保留$/m);
  assert.match(md, /^- 理由：担当に確認する$/m);
  assert.match(md, /^### d3 ログの保存期間 — 未決$/m);
  assert.ok(md.indexOf('### d1') < md.indexOf('### d2') && md.indexOf('### d2') < md.indexOf('### d3'));
});
test('未決の項には判断も理由も付かない', () => {
  const md = renderReturnMd(args());
  const d3 = md.slice(md.indexOf('### d3'), md.indexOf('## 指摘'));
  assert.equal(d3.trim(), '### d3 ログの保存期間 — 未決');
});
test('判断材料：回答の冒頭 3 文まで、ラベルは動作から', () => {
  const md = renderReturnMd(args());
  assert.match(md, /^ {2}- Q 5回で足りる理由は？ → A 根拠は文書にありません。過去の障害の話も出てきません。三つ目の文です。$/m);
  assert.ok(!md.includes('四つ目'));
  assert.match(md, /^ {2}- Q もっと詳しく → A 詳しく書くと次のとおりです。/m);
  assert.match(md, /^ {2}- Q 用語 → A 待ち時間を倍にしていく方式です。$/m);
});
test('判断材料は 200 文字まで', () => {
  const s = makeState();
  s.turns.u1.answerMd = 'あ'.repeat(500);
  const md = renderReturnMd(args({ state: s }));
  const line = md.split('\n').find((l) => l.includes('Q 5回で足りる理由は？'));
  const answer = line.split('→ A ')[1];
  assert.equal(Array.from(answer).length, 200);
  assert.ok(answer.endsWith('…'));
});
test('エラーの回は判断材料に載せない', () => {
  const s = makeState();
  s.decisions.d1.threadIds = ['t3'];
  assert.ok(!renderReturnMd(args({ state: s })).includes('判断材料にしたやりとり'));
});
test('指摘：carryBack のスレッドだけ、要旨は最初の回答の最初の文', () => {
  const md = renderReturnMd(args());
  assert.match(md, /^## 指摘（スレッドから）$/m);
  assert.match(md, /^- 「最大5回再送する」について：5回の根拠が薄い（やりとりの要旨：根拠は文書にありません。）$/m);
  assert.ok(!md.includes('「指数バックオフ」について'));
});
test('解説の訂正を拾う（重複は一度だけ）', () => {
  const md = renderReturnMd(args());
  assert.match(md, /^## 解説の訂正（分岐した Claude が指摘したもの）$/m);
  const section = md.slice(md.indexOf('## 解説の訂正'));
  assert.equal((section.match(/「5回」は表では3回になっています/g) ?? []).length, 1);
  assert.match(section, /^- 別の訂正$/m);
});
test('何も無ければ返すことなし', () => {
  const md = renderReturnMd(args({ state: emptyState() }));
  assert.match(md, /メインの会話に返すことはありません/);
  assert.equal(md, '# drilldown から持ち帰り：通知の設計\n\n記録：/h/.drilldown/records/x/record.html\n元の文書：docs/notify.md\n\nメインの会話に返すことはありません\n');
});
test('未決だけなら返すことなし', () => {
  const s = emptyState();
  assert.match(renderReturnMd(args({ state: s, decisions: [decisions[0]].map((d) => ({ ...d, id: 'd1' })) })), /メインの会話に返すことはありません/);
});
test('carryBack だけでも返す', () => {
  const s = makeState();
  s.decisions = {};
  s.turns.u2.answerMd = 'なし';
  s.turns.u1.answerMd = 'なし';
  const md = renderReturnMd(args({ state: s }));
  assert.ok(!md.includes('メインの会話に返すことはありません'));
  assert.match(md, /### d1 .* — 未決/);
  assert.match(md, /^- 「最大5回再送する」について：/m);
});
test('hasHtml が false なら記録は record.md を指す', () => {
  assert.match(renderReturnMd(args({ recordPath: '/r', hasHtml: false })), /^記録：\/r\/record\.md$/m);
  assert.match(renderReturnMd(args({ recordPath: '/r/', hasHtml: true })), /^記録：\/r\/record\.html$/m);
  assert.match(renderReturnMd(args({ recordPath: '/r' })), /^記録：\/r\/record\.html$/m);
});
test('判断材料のメモは「メモ：<text>」で載る', () => {
  const s = makeState();
  s.decisions.d1.threadIds = ['t4'];
  const md = renderReturnMd(args({ state: s }));
  assert.match(md, /^ {2}- メモ：あとで見る$/m);
  assert.ok(!md.includes('Q あとで見る'));
});

test('質問のない指摘（回のないスレッド）は要旨なしで載る', () => {
  const s = makeState();
  s.threads.t9 = { id: 't9', parentThreadId: null, parentTurnId: null, quote: 'ジョブ基盤', sessionId: null, carryBack: true, note: '名前を統一してほしい', decisionIds: [], turnIds: [], createdAt: '2026-11-24T11:00:00.000Z' };
  const md = renderReturnMd(args({ state: s }));
  assert.match(md, /^- 「ジョブ基盤」について：名前を統一してほしい$/m);
  const rec = renderRecordMd({ title: 't', sources: [], mainMd: 'x', state: s, decisions });
  assert.match(rec, /^- 「ジョブ基盤」（メインの会話に持ち帰る）\n {2}持ち帰りメモ：名前を統一してほしい$/m);
});

test('record.md：題名・元の文書・決める事項・スレッド・解説の順', () => {
  const md = renderRecordMd({ title: '通知の設計', sources: ['docs/notify.md', 'issue #3'], mainMd: '# 解説本文\n本文です。', state: makeState(), decisions });
  const order = ['# 通知の設計', '## 元の文書', '## 決める事項と判断', '## スレッド', '## 解説'].map((h) => md.indexOf(h));
  assert.ok(order.every((n) => n >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(md, /^- docs\/notify\.md$/m);
  assert.match(md, /^- issue #3$/m);
  assert.match(md, /^### d1 再送上限は5回でよいか — 決定$/m);
  assert.match(md, /^- 選択肢：5回 \/ 30分$/m);
  assert.match(md, /^### d3 ログの保存期間 — 未決$/m);
  assert.ok(md.endsWith('本文です。\n'));
});
test('record.md：スレッドは createdAt 順で、子は 2 文字ずつ字下げ', () => {
  const md = renderRecordMd({ title: 't', sources: [], mainMd: 'x', state: makeState(), decisions });
  const lines = md.split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));
  const t4 = at(/^- 「キュー」/);
  const t1 = at(/^- 「最大5回再送する」/);
  const t2 = at(/^ {2}- 「指数バックオフ」/);
  const t3 = at(/^ {4}- 「待ち時間の上限」/);
  assert.ok(t4 >= 0 && t1 > t4 && t2 > t1 && t3 > t2);
});
test('record.md：Q と A、ラベル、エラー、メモ', () => {
  const md = renderRecordMd({ title: 't', sources: [], mainMd: 'x', state: makeState(), decisions });
  assert.match(md, /^ {2}Q 5回で足りる理由は？$/m);
  assert.match(md, /^ {2}A 根拠は文書にありません。/m);
  assert.match(md, /^ {2}Q もっと詳しく$/m);
  assert.match(md, /^ {4}Q 用語$/m);
  assert.match(md, /^ {6}Q 上限は？$/m);
  assert.match(md, /^ {6}A （エラー：時間切れ）$/m);
  assert.match(md, /^ {2}メモ：あとで見る$/m);
  assert.match(md, /^ {2}A 詳しく書くと次のとおりです。\n {4}解説の訂正：/m);
});
test('record.md：何も無くても書ける', () => {
  const md = renderRecordMd({ title: 't', sources: [], mainMd: '', state: { threads: {}, turns: {}, decisions: {}, createdSessionIds: [] }, decisions: [] });
  assert.match(md, /^# t$/m);
  assert.match(md, /^## スレッド$/m);
});

test('見出しの題名は1行にする（改行を空白に）', () => {
  const decs = [{ id: 'd1', title: '再送\n上限', options: [] }];
  const st = { threads: {}, turns: {}, decisions: { d1: { status: '決定', judgement: 'x', reason: 'y', threadIds: [] } } };
  const rec = renderRecordMd({ title: '題\n# 偽の見出し', sources: [], mainMd: '', state: st, decisions: decs });
  assert.ok(rec.startsWith('# 題 # 偽の見出し\n'));
  assert.ok(rec.includes('### d1 再送 上限 — 決定\n'));
  assert.ok(!/^# 偽の見出し/m.test(rec));
  const ret = renderReturnMd({ title: '題\r\n二行目', recordPath: '/r', sources: [], state: st, decisions: decs });
  assert.ok(ret.startsWith('# drilldown から持ち帰り：題 二行目\n'));
  assert.ok(ret.includes('### d1 再送 上限 — 決定\n'));
});

test('records フォルダは 0o700 で作る', { skip: process.platform === 'win32' }, () => {
  const home = tmp();
  writeRecord({ homeDir: home, now: new Date(), title: 't', snapshotHtml: null, recordMd: 'x' });
  assert.equal(fs.statSync(path.join(home, '.drilldown', 'records')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(home, '.drilldown')).mode & 0o777, 0o700);
});
