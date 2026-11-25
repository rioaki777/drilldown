import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as markedModule from '../skill/drilldown/app/public/vendor/marked.esm.js';
import { createApi } from '../skill/drilldown/app/public/lib/api.mjs';
import { renderMarkdown } from '../skill/drilldown/app/public/lib/markdown.mjs';
import { findQuoteRange } from '../skill/drilldown/app/public/lib/locate-quote.mjs';
import { buildThreadTree, runningTurnIds } from '../skill/drilldown/app/public/lib/thread-tree.mjs';
import { buildSnapshotHtml, trySnapshot } from '../skill/drilldown/app/public/lib/snapshot.mjs';
import { headingMatchesDecision, sectionEnd } from '../skill/drilldown/app/public/lib/decision-slot.mjs';

const { marked } = markedModule;
const deps = { marked, sanitize: (h) => h };

// ---- renderMarkdown ----
test('ファイル見出しつきフェンス', () => {
  const html = renderMarkdown('~~~~ts src/a.ts:12\nx\n~~~~', deps);
  assert.match(html, /<pre data-path="src\/a.ts" data-start="12"><code class="language-ts">x\n<\/code><\/pre>/);
});
test('``` のフェンスでも同じ', () => {
  assert.match(renderMarkdown('```ts src/a.ts:12\nx\n```', deps), /data-path="src\/a.ts" data-start="12"/);
});
test('diff パスは data-path だけ', () => {
  const html = renderMarkdown('```diff src/a.ts\n-a\n+b\n```', deps);
  assert.match(html, /data-path="src\/a.ts"/);
  assert.doesNotMatch(html, /data-start/);
  assert.match(html, /class="language-diff"/);
});
test('言語だけなら class だけ', () => {
  const html = renderMarkdown('```js\nlet a = 1 < 2;\n```', deps);
  assert.match(html, /<pre><code class="language-js">let a = 1 &lt; 2;\n<\/code><\/pre>/);
});
test('言語なしのフェンス', () => {
  assert.match(renderMarkdown('```\na\n```', deps), /<pre><code>a\n<\/code><\/pre>/);
});
test('属性値はエスケープされる', () => {
  const html = renderMarkdown('```ts a"><img src=x>.ts:3\nx\n```', deps);
  assert.doesNotMatch(html, /<img/);
});
test('mermaid は描画待ちの div', () => {
  const html = renderMarkdown('```mermaid\nflowchart LR\n  A["x"] --> B\n```', deps);
  assert.match(html, /class="mermaid"/);
  assert.match(html, /data-src="flowchart LR\n  A\[&quot;x&quot;\] --&gt; B\n?"/);
  assert.doesNotMatch(html, /<pre/);
});
test('sanitize を通る', () => {
  let called = false;
  renderMarkdown('x', { marked, sanitize: (h) => ((called = true), h) });
  assert.ok(called);
});
test('sanitize の戻り値が使われる', () => {
  assert.equal(renderMarkdown('x', { marked, sanitize: () => 'S' }), 'S');
});
test('marked の全体設定を書き換えない', () => {
  renderMarkdown('```ts a.ts:1\nx\n```', deps);
  assert.equal(marked.parse('```ts a.ts:1\nx\n```'), '<pre><code class="language-ts">x\n</code></pre>\n');
});
test('Marked クラスがあるモジュールが渡されたときも動く', () => {
  const html = renderMarkdown('~~~~ts src/a.ts:12\nx\n~~~~', { marked: markedModule, sanitize: (h) => h });
  assert.match(html, /data-path="src\/a.ts" data-start="12"/);
  assert.equal(markedModule.marked.parse('```ts a.ts:1\nx\n```'), '<pre><code class="language-ts">x\n</code></pre>\n');
});
test('通常の Markdown', () => {
  assert.match(renderMarkdown('# 見出し\n\n- a\n- b', deps), /<h1>見出し<\/h1>[\s\S]*<li>a<\/li>/);
});

// ---- findQuoteRange ----
test('完全一致', () => assert.deepEqual(findQuoteRange('abc def', 'def'), { start: 4, end: 7 }));
test('太字と改行をまたいでも見つかる', () => {
  const text = '回数は最大**5回**\n再送する。';
  const r = findQuoteRange(text, '最大5回 再送する');
  assert.ok(r);
  assert.equal(text.slice(r.start, r.end), '最大**5回**\n再送する');
});
test('空白の連続・改行は 1 つとみなす', () => {
  const text = 'a  b\n\n  c d';
  const r = findQuoteRange(text, 'b c');
  assert.equal(text.slice(r.start, r.end), 'b\n\n  c');
});
test('引用側の記号も無視する', () => {
  const text = 'use `foo_bar` now';
  const r = findQuoteRange(text, '**foobar** now');
  assert.equal(text.slice(r.start, r.end), 'foo_bar` now');
});
test('範囲は元の text の位置（終端は含まない）', () => {
  const text = '**x** y';
  assert.deepEqual(findQuoteRange(text, 'x y'), { start: 2, end: 7 });
});
test('無ければ null', () => assert.equal(findQuoteRange('abc', 'zzz'), null));
test('空の引用は null', () => {
  assert.equal(findQuoteRange('abc', ''), null);
  assert.equal(findQuoteRange('abc', '  \n'), null);
  assert.equal(findQuoteRange('abc', '**'), null);
});

// ---- buildThreadTree ----
const mkState = () => ({
  threads: {
    t3: { id: 't3', parentThreadId: 't1', createdAt: '2026-01-01T00:00:03Z', turnIds: ['u3'] },
    t2: { id: 't2', parentThreadId: 't1', createdAt: '2026-01-01T00:00:02Z', turnIds: ['u2b', 'u2a', 'gone'] },
    t1: { id: 't1', parentThreadId: null, createdAt: '2026-01-01T00:00:01Z', turnIds: ['u1'] },
    t9: { id: 't9', parentThreadId: 'missing', createdAt: '2026-01-01T00:00:09Z', turnIds: [] },
  },
  turns: {
    u1: { id: 'u1', threadId: 't1' },
    u2a: { id: 'u2a', threadId: 't2' },
    u2b: { id: 'u2b', threadId: 't2' },
    u3: { id: 'u3', threadId: 't3' },
  },
});
test('子は親の下', () => {
  const t = buildThreadTree(mkState());
  assert.equal(t[0].thread.id, 't1');
  assert.equal(t[0].children[0].thread.id, 't2');
  assert.equal(t[0].children[1].thread.id, 't3');
});
test('親が見つからないスレッドは根になる', () => {
  const t = buildThreadTree(mkState());
  assert.deepEqual(t.map((n) => n.thread.id), ['t1', 't9']);
});
test('回は turnIds の順（無い ID は飛ばす）', () => {
  const t = buildThreadTree(mkState());
  assert.deepEqual(t[0].children[0].turns.map((x) => x.id), ['u2b', 'u2a']);
});
test('配列の state でも動く・空でも動く', () => {
  const s = mkState();
  const arr = { threads: Object.values(s.threads), turns: Object.values(s.turns) };
  assert.equal(buildThreadTree(arr).length, 2);
  assert.deepEqual(buildThreadTree({}), []);
});
test('循環があっても落ちない', () => {
  const s = {
    threads: {
      a: { id: 'a', parentThreadId: 'b', createdAt: 1, turnIds: [] },
      b: { id: 'b', parentThreadId: 'a', createdAt: 2, turnIds: [] },
    },
    turns: {},
  };
  const flat = (ns) => ns.flatMap((n) => [n.thread.id, ...flat(n.children)]);
  assert.deepEqual(flat(buildThreadTree(s)).sort(), ['a', 'b']);
});

// ---- buildSnapshotHtml ----
const snapArgs = {
  title: 'T <&>', css: 'body{color:red}', docHtml: '<p>a</p>', decisionsHtml: '<ul>D</ul>', threadsHtml: '<div>TH</div>', savedAt: '2026-11-24 10:00',
};
test('スナップショットに script が残らない', () => {
  const h = buildSnapshotHtml({ ...snapArgs, docHtml: '<script>x</script><p>a</p><SCRIPT src=x></SCRIPT>' });
  assert.doesNotMatch(h, /<script/i);
  assert.match(h, /<p>a<\/p>/);
});
test('on* 属性が残らない', () => {
  const h = buildSnapshotHtml({ ...snapArgs, docHtml: '<img src="data:x" onerror="alert(1)"><a href="#" onclick=\'x()\'>l</a><b ONCLICK=y>z</b>' });
  assert.doesNotMatch(h, /\son\w+\s*=/i);
  assert.match(h, /<img src="data:x"/);
});
test('完全な HTML 文書・順序・エスケープ', () => {
  const h = buildSnapshotHtml(snapArgs);
  assert.match(h, /^<!doctype html>/i);
  assert.match(h, /<meta charset="utf-8">/);
  assert.match(h, /<title>T &lt;&amp;&gt;<\/title>/);
  assert.match(h, /<style>body\{color:red\}<\/style>/);
  assert.match(h, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"/);
  const order = ['<p>a</p>', '<ul>D</ul>', '<div>TH</div>', '2026-11-24 10:00'].map((s) => h.indexOf(s));
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});
test('CSS の style 終了タグで抜け出せない', () => {
  const h = buildSnapshotHtml({ ...snapArgs, css: 'a{}</style><p id="x">' });
  assert.equal(h.match(/<\/style/gi).length, 1);
});
test('savedAt はエスケープされる', () => {
  assert.doesNotMatch(buildSnapshotHtml({ ...snapArgs, savedAt: '<b>x</b>' }), /<b>x<\/b>/);
});

const snapDoc = (docHtml) => buildSnapshotHtml({ ...snapArgs, docHtml });
const docPart = (h) => h.split('<main id="snapshot-document">\n')[1].split('\n</main>')[0];
test('本文の once = 1 や エスケープされた onClick は変わらない', () => {
  const src = '<p><code>&lt;button onClick={fn}&gt;</code> and once = 1</p><pre><code>if (onload = 2) {}</code></pre>';
  assert.equal(docPart(snapDoc(src)), src);
});
test('本物のタグの on* だけ落ちる・閉じタグは残る', () => {
  const h = docPart(snapDoc('<p>once = 1 <button onClick={fn} class="b">x</button></p>'));
  assert.equal(h, '<p>once = 1 <button class="b">x</button></p>');
});
test('区切りが / や閉じ引用符でも on* は落ちる', () => {
  assert.equal(docPart(snapDoc('<svg/onload=alert(1)>')), '<svg>');
  assert.equal(docPart(snapDoc('<a href="x"onclick=y>l</a>')), '<a href="x">l</a>');
  assert.equal(docPart(snapDoc('<img src=x onerror="a">')), '<img src=x>');
  assert.equal(docPart(snapDoc('<img src="a" ONERROR = \'a>b\' alt=z/>')), '<img src="a" alt=z/>');
  assert.equal(docPart(snapDoc('<br/>')), '<br/>');
  assert.doesNotMatch(snapDoc('<div\nonmouseover=x>a</div>'), /onmouseover/);
});
test('値の中の on は属性ではない・閉じていないタグは捨てる', () => {
  assert.equal(docPart(snapDoc('<a title="x onclick=y" href=u>l</a>')), '<a title="x onclick=y" href=u>l</a>');
  assert.doesNotMatch(snapDoc('<p>a</p><img src=x onerror=a'), /onerror/);
});
test('mermaid の ~~~ フェンスも data-src に入る', () => {
  const html = renderMarkdown('~~~mermaid\ngraph TD\n  A-->B\n~~~', deps);
  assert.match(html, /class="mermaid" data-src="graph TD\n  A--&gt;B\n?"/);
});
test('data-src の <script> はエスケープされる', () => {
  const html = renderMarkdown('~~~mermaid\n<script>alert(1)</script>\n~~~', deps);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /data-src="&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

// ---- createApi ----
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 200, body: {} };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => {
        if (r.bad) throw new Error('bad json');
        return r.body;
      },
    };
  };
  fn.calls = calls;
  return fn;
}
test('api は合言葉を付ける', async () => {
  const f = fakeFetch([{ status: 200, body: { title: 'x' } }]);
  const api = createApi('TOK', f);
  assert.deepEqual(await api.getDoc(), { title: 'x' });
  assert.equal(f.calls[0].url, '/api/doc');
  assert.equal(f.calls[0].init.headers['X-Drilldown-Token'], 'TOK');
});
test('api の各メソッドの URL・メソッド・本文', async () => {
  const f = fakeFetch([]);
  const api = createApi('TOK', f);
  await api.getState();
  await api.ask({ action: 'explain' });
  await api.getTurn('a/b c');
  await api.putDecision('d 1', { status: '決定' });
  await api.putThread('t/1', { note: 'n' });
  await api.finish({ mode: 'close', snapshotHtml: '<p>' });
  const got = f.calls.map((c) => `${c.init.method ?? 'GET'} ${c.url}`);
  assert.deepEqual(got, [
    'GET /api/state', 'POST /api/ask', 'GET /api/turn/a%2Fb%20c', 'PUT /api/decision/d%201', 'PUT /api/thread/t%2F1', 'POST /api/finish',
  ]);
  assert.equal(f.calls[1].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { action: 'explain' });
  assert.deepEqual(JSON.parse(f.calls[5].init.body), { mode: 'close', snapshotHtml: '<p>' });
  for (const c of f.calls) assert.equal(c.init.headers['X-Drilldown-Token'], 'TOK');
});
test('2xx 以外は本文の error で Error', async () => {
  const api = createApi('T', fakeFetch([{ status: 400, body: { error: '決められません' } }]));
  await assert.rejects(api.ask({}), { message: '決められません' });
});
test('本文が JSON でない失敗は状態コード入りの日本語エラー', async () => {
  const api = createApi('T', fakeFetch([{ status: 502, bad: true }]));
  await assert.rejects(api.getDoc(), /502/);
});
test('通信自体の失敗は日本語エラー', async () => {
  const api = createApi('T', async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(api.getDoc(), /通信/);
});

// ---- 考え中のまま残さない ----
test('runningTurnIds は running の回だけ', () => {
  const state = { turns: { a: { id: 'a', status: 'running' }, b: { id: 'b', status: 'done' }, c: { id: 'c', status: 'running' }, d: null } };
  assert.deepEqual(runningTurnIds(state).sort(), ['a', 'c']);
  assert.deepEqual(runningTurnIds({}), []);
  assert.deepEqual(runningTurnIds(null), []);
});

// ---- スナップショットが作れなくても終われる ----
test('trySnapshot は成功なら html', () => {
  assert.deepEqual(trySnapshot(() => '<p>x</p>'), { html: '<p>x</p>', error: null });
});
test('trySnapshot は例外なら html なしと理由', () => {
  const r = trySnapshot(() => { throw new Error('大きすぎる'); });
  assert.equal(r.html, undefined);
  assert.equal(r.error, '大きすぎる');
});

// ---- 決める事項の入力欄を置く節 ----
test('見出しが事項の id で始まれば対応する', () => {
  const d = { id: 'd1', title: '再送上限は5回でよいか' };
  assert.ok(headingMatchesDecision('d1 再送上限は5回でよいか', d));
  assert.ok(headingMatchesDecision('  d1　別の書き方 ', d));
  assert.ok(headingMatchesDecision('d1', d));
  assert.ok(headingMatchesDecision('d1：再送上限', d));
});
test('d1 と d10 は区別する', () => {
  assert.equal(headingMatchesDecision('d10 ほか', { id: 'd1', title: 'x' }), false);
  assert.equal(headingMatchesDecision('d1a', { id: 'd1', title: 'x' }), false);
});
test('id がなくても題名と同じ見出しなら対応する', () => {
  assert.ok(headingMatchesDecision('再送上限は5回でよいか', { id: 'd1', title: '再送上限は5回でよいか' }));
  assert.equal(headingMatchesDecision('決める事項', { id: 'd1', title: '' }), false);
  assert.equal(headingMatchesDecision('再送の間隔', { id: 'd1', title: '再送上限は5回でよいか' }), false);
});
test('節の終わりは次の同じか上の階層の見出し', () => {
  // h2 決める事項, h3 d1, p, p, h3 d2, p, h2 読むときの注意, p
  const levels = [2, 3, 0, 0, 3, 0, 2, 0];
  assert.equal(sectionEnd(levels, 1), 4);
  assert.equal(sectionEnd(levels, 4), 6);
  assert.equal(sectionEnd(levels, 0), 6);
  assert.equal(sectionEnd(levels, 6), 8);
  assert.equal(sectionEnd([3, 4, 0], 0), 3);
});

