// 終了時に書く記録（record.md）と、メインの Claude に返す文（return.md）を作る。
import fs from 'node:fs';
import path from 'node:path';

const ACTION_LABEL = { detail: 'もっと詳しく', term: '用語', diagram: '図', memo: 'メモ' };
const NO_RETURN = 'メインの会話に返すことはありません';

// フォルダ名に使えるように題名を整える。
export function safeDirName(title) {
  let s = String(title ?? '').replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '_');
  const trim = (x) => x.replace(/^[\s.]+|[\s.]+$/g, '');
  s = Array.from(trim(s)).slice(0, 40).join('');
  s = trim(s);
  return s === '' ? '無題' : s;
}

const pad = (n) => String(n).padStart(2, '0');

// <home>/.drilldown/records/YYYY-MM-DD-HHMM-<題名>（ローカル時刻）。既にあれば -2, -3…。フォルダは作らない。
export function recordDirFor(homeDir, now, title) {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const base = path.join(homeDir, '.drilldown', 'records', `${stamp}-${safeDirName(title)}`);
  let candidate = base;
  for (let n = 2; fs.existsSync(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

export function writeRecord({ homeDir, now, title, snapshotHtml, recordMd }) {
  const dir = recordDirFor(homeDir, now, title);
  // 記録には文書と質問の中身が入るので、作るときは本人だけが読めるようにする（既にあるフォルダの権限は変えない）
  fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'record.md'), recordMd);
  if (snapshotHtml !== null && snapshotHtml !== undefined) fs.writeFileSync(path.join(dir, 'record.html'), snapshotHtml);
  return dir;
}

// ---- 共通の小道具 ----

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function turnLabel(turn) {
  const q = oneLine(turn.question);
  if (q) return q;
  return ACTION_LABEL[turn.action] ?? '質問';
}

// 。または改行で区切った文（先頭から n 個）。区切りの 。 は文に残す。
function sentences(text, n) {
  const pieces = String(text ?? '')
    .split(/(?<=。)|\r?\n+/)
    .map((p) => p.trim())
    .filter((p) => p !== '' && !p.startsWith('```'));
  return pieces.slice(0, n);
}

function joinSentences(list) {
  let out = '';
  for (const s of list) out += out === '' || out.endsWith('。') ? s : ` ${s}`;
  return out;
}

function summary(answerMd, n, max) {
  const s = Array.from(joinSentences(sentences(answerMd, n)));
  return s.length > max ? `${s.slice(0, max - 1).join('')}…` : s.join('');
}

function decisionState(state, id) {
  return state.decisions?.[id] ?? { status: '未決', judgement: '', reason: '', threadIds: [] };
}

function doneTurns(state, threadId) {
  const th = state.threads?.[threadId];
  if (!th) return [];
  return (th.turnIds ?? []).map((id) => state.turns?.[id]).filter((t) => t && t.status === 'done');
}

// ---- return.md ----

function collectCorrections(state) {
  const seen = new Set();
  const out = [];
  for (const turn of Object.values(state.turns ?? {})) {
    if (typeof turn.answerMd !== 'string') continue;
    for (const line of turn.answerMd.split(/\r?\n/)) {
      const m = /^\s*(?:[-*・+]\s*)?解説の訂正[：:]\s*(.*?)\s*$/.exec(line);
      if (!m || m[1] === '' || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

function exchangeLine(turn) {
  if (turn.action === 'memo') return `メモ：${oneLine(turn.question)}`;
  return `Q ${turnLabel(turn)} → A ${summary(turn.answerMd, 3, 200)}`;
}

// recordPath は記録フォルダ。hasHtml が false（record.html を作らなかった）なら record.md を指す。
export function renderReturnMd({ title, recordPath, hasHtml = true, sources, state, decisions }) {
  const decList = Array.isArray(decisions) ? decisions : [];
  const judged = decList.filter((d) => {
    const s = decisionState(state, d.id).status;
    return s === '決定' || s === '保留';
  });
  const carried = Object.values(state.threads ?? {}).filter((t) => t.carryBack === true);
  const corrections = collectCorrections(state);

  const recordFile = `${String(recordPath ?? '').replace(/[\\/]+$/, '')}/${hasHtml === false ? 'record.md' : 'record.html'}`;
  const src = (sources ?? []).length > 0 ? sources.join('、') : '（なし）';
  const lines = [`# drilldown から持ち帰り：${oneLine(title)}`, '', `記録：${recordFile}`, `元の文書：${src}`, ''];

  if (judged.length === 0 && carried.length === 0 && corrections.length === 0) {
    lines.push(NO_RETURN);
    return `${lines.join('\n')}\n`;
  }

  if (decList.length > 0) {
    lines.push('## 決める事項の判断');
    for (const d of decList) {
      const ds = decisionState(state, d.id);
      lines.push(`### ${oneLine(d.id)} ${oneLine(d.title)} — ${ds.status}`);
      if (ds.status === '決定') {
        lines.push(`- 判断：${oneLine(ds.judgement)}`, `- 理由：${oneLine(ds.reason)}`);
        const exchanges = (ds.threadIds ?? []).flatMap((tid) => doneTurns(state, tid));
        if (exchanges.length > 0) {
          lines.push('- 判断材料にしたやりとり：');
          for (const t of exchanges) lines.push(`  - ${exchangeLine(t)}`);
        }
      } else if (ds.status === '保留') {
        lines.push(`- 理由：${oneLine(ds.reason)}`);
      }
      lines.push('');
    }
  }

  if (carried.length > 0) {
    lines.push('## 指摘（スレッドから）');
    for (const t of carried) {
      const first = doneTurns(state, t.id).find((u) => typeof u.answerMd === 'string' && u.answerMd.trim() !== '');
      const gist = first ? `（やりとりの要旨：${sentences(first.answerMd, 1)[0] ?? ''}）` : '';
      lines.push(`- 「${oneLine(t.quote)}」について：${oneLine(t.note)}${gist}`);
    }
    lines.push('');
  }

  if (corrections.length > 0) {
    lines.push('## 解説の訂正（分岐した Claude が指摘したもの）');
    for (const c of corrections) lines.push(`- ${c}`);
    lines.push('');
  }

  while (lines[lines.length - 1] === '') lines.pop();
  return `${lines.join('\n')}\n`;
}

// ---- record.md ----

function indentBlock(text, prefix) {
  return String(text).split(/\r?\n/).map((l) => (l === '' ? '' : prefix + l)).join('\n');
}

function renderTurn(turn, indent) {
  const inner = `${indent}  `;
  if (turn.action === 'memo') return [`${inner}メモ：${oneLine(turn.question)}`];
  const out = [`${inner}Q ${turnLabel(turn)}`];
  if (turn.status === 'error') {
    out.push(`${inner}A （エラー：${oneLine(turn.error)}）`);
  } else if (turn.status === 'done') {
    const body = String(turn.answerMd ?? '').replace(/\s+$/, '');
    out.push(`${inner}A ${indentBlock(body, `${inner}  `).replace(/^\s+/, '')}`);
  } else {
    out.push(`${inner}A （回答待ちのまま終了）`);
  }
  return out;
}

function renderThread(state, thread, depth, childrenOf, out, seen) {
  seen.add(thread.id);
  const indent = '  '.repeat(depth);
  const flag = thread.carryBack ? '（メインの会話に持ち帰る）' : '';
  out.push(`${indent}- 「${oneLine(thread.quote)}」${flag}`);
  const decIds = (thread.decisionIds ?? []).filter(Boolean);
  if (decIds.length > 0) out.push(`${indent}  関係する決める事項：${decIds.join('、')}`);
  if (oneLine(thread.note) !== '') out.push(`${indent}  持ち帰りメモ：${oneLine(thread.note)}`);
  for (const id of thread.turnIds ?? []) {
    const turn = state.turns?.[id];
    if (turn) out.push(...renderTurn(turn, indent));
  }
  for (const child of childrenOf.get(thread.id) ?? []) {
    if (!seen.has(child.id)) renderThread(state, child, depth + 1, childrenOf, out, seen);
  }
}

export function renderRecordMd({ title, sources, mainMd, state, decisions }) {
  const lines = [`# ${oneLine(title)}`, '', '## 元の文書'];
  if ((sources ?? []).length === 0) lines.push('- （なし）');
  for (const s of sources ?? []) lines.push(`- ${s}`);
  lines.push('');

  lines.push('## 決める事項と判断');
  const decList = Array.isArray(decisions) ? decisions : [];
  if (decList.length === 0) lines.push('（決める事項はありません）');
  for (const d of decList) {
    const ds = decisionState(state, d.id);
    lines.push(`### ${oneLine(d.id)} ${oneLine(d.title)} — ${ds.status}`);
    if (d.quote) lines.push(`- 該当箇所：「${oneLine(d.quote)}」`);
    if (d.context) lines.push(`- 背景：${oneLine(d.context)}`);
    if ((d.options ?? []).length > 0) lines.push(`- 選択肢：${d.options.join(' / ')}`);
    if (d.source) lines.push(`- 出どころ：${d.source}`);
    if (ds.status === '決定') lines.push(`- 判断：${oneLine(ds.judgement)}`, `- 理由：${oneLine(ds.reason)}`);
    else if (ds.status === '保留') lines.push(`- 理由：${oneLine(ds.reason)}`);
    const tids = (ds.threadIds ?? []).filter((tid) => state.threads?.[tid]);
    if (tids.length > 0) lines.push(`- 判断材料のスレッド：${tids.map((tid) => `「${oneLine(state.threads[tid].quote)}」`).join('、')}`);
    lines.push('');
  }

  lines.push('## スレッド');
  const all = Object.values(state.threads ?? {});
  const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  const ordered = all.map((t, i) => [t, i]).sort((a, b) => byCreated(a[0], b[0]) || a[1] - b[1]).map(([t]) => t);
  const childrenOf = new Map();
  const roots = [];
  for (const t of ordered) {
    if (t.parentThreadId && state.threads[t.parentThreadId]) {
      if (!childrenOf.has(t.parentThreadId)) childrenOf.set(t.parentThreadId, []);
      childrenOf.get(t.parentThreadId).push(t);
    } else {
      roots.push(t);
    }
  }
  if (all.length === 0) lines.push('（スレッドはありません）');
  const seen = new Set();
  for (const r of roots) renderThread(state, r, 0, childrenOf, lines, seen);
  for (const t of ordered) if (!seen.has(t.id)) renderThread(state, t, 0, childrenOf, lines, seen); // 親が輪になっている場合の保険
  lines.push('');

  lines.push('## 解説', '', String(mainMd ?? '').replace(/\s+$/, ''));
  return `${lines.join('\n')}\n`;
}
