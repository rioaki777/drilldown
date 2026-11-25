// 画面（B 案）：左に解説と「決める事項」（本文の節の直下か、本文の下）、右に選んだ文ごとの質問スレッド。
import { createApi } from './lib/api.mjs';
import { buildSnapshotHtml, trySnapshot } from './lib/snapshot.mjs';
import { runningTurnIds } from './lib/thread-tree.mjs';
import { flash, debounce } from './ui/dom.mjs';
import { renderInto, markQuote } from './ui/content.mjs';
import { createDecisions } from './ui/decisions.mjs';
import { createThreads } from './ui/threads.mjs';
import { createSelectionMenu } from './ui/selection.mjs';
import { collectSnapshotParts } from './ui/snapshot-dom.mjs';

const TOKEN_KEY = 'drilldown-token';
const KIND_LABEL = { pr: 'PR', issue: 'issue', doc: '文書', answer: '回答', file: 'ファイル', diff: '差分' };
const POLL_MS = 1500;
const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'), title: $('doc-title'), kind: $('doc-kind'), close: $('btn-close'), ret: $('btn-return'),
  decisions: $('decisions'), doc: $('doc'), threads: $('threads'), notice: $('notice'), toast: $('toast'),
};

// ---- 合言葉：?t= を sessionStorage に移して URL から消す ----
function readToken() {
  const url = new URL(window.location.href);
  const t = url.searchParams.get('t');
  if (t) {
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* 保存できなくてもこの表示では使える */ }
    url.searchParams.delete('t');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    return t;
  }
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function showNotice(title, message) {
  els.app.hidden = true;
  els.notice.hidden = false;
  els.notice.textContent = '';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  const p = document.createElement('p');
  p.textContent = message;
  els.notice.append(h2, p);
}

const NO_TOKEN = '合言葉が見つかりません。作業フォルダの url.txt に書かれた URL（末尾に ?t=… の合言葉が付いたもの）を、そのままブラウザで開いてください。';

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 6000);
}

async function main() {
  const token = readToken();
  if (!token) return showNotice('開けませんでした', NO_TOKEN);
  const api = createApi(token);

  let doc;
  let state;
  try {
    [doc, state] = await Promise.all([api.getDoc(), api.getState()]);
  } catch (e) {
    if (/合言葉/.test(e.message)) return showNotice('開けませんでした', `合言葉が違います。${NO_TOKEN}`);
    return showNotice('開けませんでした', `サーバーに接続できません（${e.message}）。サーバーがもう終わっている場合は、Claude Code でもう一度始めてください。`);
  }
  state.threads ??= {};
  state.turns ??= {};
  state.decisions ??= {};
  const decisions = Array.isArray(doc.decisions) ? doc.decisions : [];
  const isPr = doc.kind === 'pr';
  let finished = false;

  document.title = doc.title;
  els.title.textContent = doc.title;
  els.kind.textContent = KIND_LABEL[doc.kind] ?? doc.kind;
  if (isPr) els.ret.remove();

  // 保存中の要求（終わる前に待つ）
  const inflight = new Set();
  const track = (p) => {
    inflight.add(p);
    p.finally(() => inflight.delete(p));
    return p;
  };

  // ---- 本文 ----
  renderInto(els.doc, doc.mainMd);
  for (const d of decisions) if (d.quote) markQuote(els.doc, d.quote, { 'data-decision': d.id });
  for (const th of Object.values(state.threads)) {
    if (!th.parentThreadId) markQuote(els.doc, th.quote, { 'data-thread': th.id });
  }

  // ---- 決める事項 ----
  const decisionSavers = new Map();
  const putDecision = (id) => {
    const s = state.decisions[id];
    return track(api.putDecision(id, { status: s.status, judgement: s.judgement ?? '', reason: s.reason ?? '', threadIds: s.threadIds ?? [] })
      .then((dec) => {
        s.threadIds = dec.threadIds;
        decisionsUi.showError(id, '');
        return dec;
      })
      .catch((e) => {
        decisionsUi.showError(id, e.message);
        throw e;
      }));
  };
  const saverFor = (id) => {
    if (!decisionSavers.has(id)) decisionSavers.set(id, debounce(() => { putDecision(id).catch(() => {}); }, 500));
    return decisionSavers.get(id);
  };
  const threadLabel = (tid) => {
    const q = String(state.threads[tid]?.quote ?? tid).replace(/\s+/g, ' ');
    return Array.from(q).length > 30 ? `${Array.from(q).slice(0, 29).join('')}…` : q;
  };
  const decisionsUi = createDecisions({
    container: els.decisions, docEl: els.doc, decisions, state,
    onChange: (id) => saverFor(id)(),
    onGotoQuote: (id) => gotoMarks(els.doc.querySelectorAll(`mark[data-decision="${CSS.escape(id)}"]`)),
    onGotoThread: (tid) => threadsUi.focus(tid),
    threadLabel,
  });

  // ---- スレッド ----
  async function refreshThreads() {
    const fresh = await api.getState();
    state.threads = fresh.threads ?? {};
    state.turns = fresh.turns ?? {};
  }

  const polling = new Set();
  async function poll(turnId) {
    if (polling.has(turnId)) return;
    polling.add(turnId);
    try {
      while (!finished) {
        await new Promise((r) => { setTimeout(r, POLL_MS); });
        if (finished) break;
        let turn;
        try {
          turn = await api.getTurn(turnId);
        } catch {
          continue; // 一時的な失敗は次の回で取り直す
        }
        state.turns[turnId] = turn;
        if (turn.status !== 'running') {
          threadsUi.updateTurn(turn);
          break;
        }
      }
    } finally {
      polling.delete(turnId);
    }
  }

  async function ask(body) {
    if (finished) return;
    let res;
    try {
      res = await api.ask(body);
      await refreshThreads();
    } catch (e) {
      toast(`送れませんでした：${e.message}`);
      return;
    }
    const isNew = !body.threadId;
    if (isNew && !body.parentThreadId) markQuote(els.doc, body.quote, { 'data-thread': res.threadId });
    threadsUi.render();
    decisionsUi.refreshAllLinks();
    if (isNew) threadsUi.focus(res.threadId);
    // 新しい回だけでなく、取り直した state で回答待ちの回すべてを見張る（poll は重複しない）
    pollRunning();
  }

  function pollRunning() {
    for (const id of runningTurnIds(state)) poll(id);
  }

  async function linkDecision(threadId, decisionId, on) {
    const s = state.decisions[decisionId];
    if (!s) return;
    const before = s.threadIds ?? [];
    s.threadIds = on ? [...new Set([...before, threadId])] : before.filter((t) => t !== threadId);
    saverFor(decisionId).flush();
    try {
      await putDecision(decisionId);
    } catch (e) {
      s.threadIds = before;
      toast(`ひもづけできませんでした：${e.message}`);
    }
    for (const th of Object.values(state.threads)) {
      const has = (th.decisionIds ?? []).includes(decisionId);
      const want = s.threadIds.includes(th.id);
      if (want && !has) th.decisionIds = [...(th.decisionIds ?? []), decisionId];
      else if (!want && has) th.decisionIds = th.decisionIds.filter((d) => d !== decisionId);
    }
    threadsUi.render();
    decisionsUi.refreshLinks(decisionId);
  }

  function setCarry(threadId, body) {
    return track(api.putThread(threadId, body)).catch((e) => toast(`保存できませんでした：${e.message}`));
  }

  function gotoMarks(marks) {
    const list = [...marks];
    if (list.length === 0) {
      toast('該当する箇所に印を付けられませんでした（文が見つかりません）');
      return;
    }
    list[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    list.forEach(flash);
  }

  const threadsUi = createThreads({
    container: els.threads, kind: doc.kind, decisions, state,
    actions: {
      ask,
      retry: (turn) => ask({ threadId: turn.threadId, action: turn.action, question: turn.question, quote: turn.quote }),
      linkDecision,
      setCarry,
      gotoQuote: (tid) => gotoMarks(document.querySelectorAll(`#doc mark[data-thread="${CSS.escape(tid)}"], #threads mark[data-thread="${CSS.escape(tid)}"]`)),
    },
  });
  threadsUi.render();
  decisionsUi.refreshAllLinks();
  pollRunning();
  setInterval(() => threadsUi.tick(), 1000);

  // 印のクリック：本文 → スレッド・決める事項、回答の中の印 → 子スレッド
  const onMarkClick = (e) => {
    if (!window.getSelection()?.isCollapsed) return;
    const mark = e.target.closest?.('mark[data-thread], mark[data-decision]');
    if (!mark) return;
    if (mark.dataset.thread) threadsUi.focus(mark.dataset.thread);
    else decisionsUi.focus(mark.dataset.decision);
  };
  els.doc.addEventListener('click', onMarkClick);
  els.threads.addEventListener('click', (e) => { if (e.target.closest?.('.answer')) onMarkClick(e); });

  const menu = createSelectionMenu({ docEl: els.doc, threadsEl: els.threads, onAsk: ask, allowPoint: !isPr });

  // ---- 終わる ----
  async function finish(mode) {
    if (finished) return;
    const buttons = [els.close, els.ret].filter((b) => b && b.isConnected);
    buttons.forEach((b) => { b.disabled = true; });
    menu.hide();
    try {
      for (const s of decisionSavers.values()) s.flush();
      threadsUi.flush();
      await Promise.allSettled([...inflight]);
      let css = '';
      try {
        const r = await fetch('style.css');
        if (r.ok) css = await r.text();
      } catch { /* CSS なしでも記録は書く */ }
      // 画面の保存（record.html）が作れなくても、record.md だけで終われるようにする
      const snap = trySnapshot(() => {
        const parts = collectSnapshotParts({ docEl: els.doc, decisionsEl: els.decisions, threadsEl: els.threads });
        return buildSnapshotHtml({ title: doc.title, css, ...parts, savedAt: new Date().toLocaleString('ja-JP') });
      });
      let res;
      if (snap.html === undefined) {
        res = await api.finish({ mode });
      } else {
        try {
          res = await api.finish({ mode, snapshotHtml: snap.html });
        } catch (e) {
          // 画面が大きすぎてサーバーが受け取れないときも、record.md だけで終わる
          if (!/大きすぎ/.test(e.message)) throw e;
          snap.error = e.message;
          res = await api.finish({ mode });
        }
      }
      finished = true;
      try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* 無視 */ }
      const noHtml = snap.error ? `画面の保存（record.html）は作れなかったため、record.md だけを残しました（${snap.error}）。` : '';
      showNotice('閉じました', `閉じました。${noHtml}Claude Code に戻って『終わった』と伝えてください（記録：${res.recordDir}）`);
    } catch (e) {
      buttons.forEach((b) => { b.disabled = false; });
      toast(`終われませんでした：${e.message}`);
    }
  }
  els.close.addEventListener('click', () => finish('close'));
  if (!isPr) els.ret.addEventListener('click', () => finish('return'));
  // 準備が済むまでは押せない（読み込み中に押しても何も起きないのを防ぐ）
  els.close.disabled = false;
  if (!isPr) els.ret.disabled = false;
  return undefined;
}

main().catch((e) => showNotice('表示できませんでした', `画面の準備中にエラーが起きました：${e?.message ?? e}`));
