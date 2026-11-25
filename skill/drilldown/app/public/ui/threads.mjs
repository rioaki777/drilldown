// 右側のスレッド欄。buildThreadTree の木を描く。子は親の中に入れて字下げする。
import { buildThreadTree } from '../lib/thread-tree.mjs';
import { isSendKey } from '../lib/keys.mjs';
import { h, debounce, flash, ACTION_LABEL } from './dom.mjs';
import { renderInto, markQuote } from './content.mjs';

export const shortQuote = (q, n = 60) => {
  const chars = Array.from(String(q ?? '').replace(/\s+/g, ' ').trim());
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : chars.join('');
};

const elapsedSec = (startedAt) => {
  const t = Date.parse(startedAt);
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 1000)) : 0;
};

export function createThreads({ container, kind, decisions, state, actions }) {
  const collapsed = new Set();
  const noteSavers = new Map();
  const list = h('div', { class: 'thread-list' });
  const empty = h('p', { class: 'muted empty', 'data-ui': true, text: '左の文を選ぶと、ここに質問のスレッドができます。' });
  container.textContent = '';
  container.append(h('h2', { class: 'pane-title', text: 'スレッド' }), empty, list);

  const decisionTitle = (id) => decisions.find((d) => d.id === id)?.title ?? id;

  function renderTurn(turn) {
    const el = h('div', { class: `turn turn-${turn.status}`, 'data-turn-id': turn.id });
    const q = h('div', { class: 'turn-q' }, h('span', { class: 'turn-badge', text: turn.action === 'memo' ? 'メモ' : 'Q' }));
    const label = turn.action === 'question' || turn.action === 'memo' ? turn.question : ACTION_LABEL[turn.action] ?? turn.action;
    q.append(h('span', { class: 'turn-question', text: label }));
    el.append(q);
    if (turn.action === 'memo') return el;
    if (turn.status === 'running') {
      el.append(h('p', { class: 'thinking' }, '考え中…（',
        h('span', { class: 'elapsed', 'data-started': turn.startedAt, text: String(elapsedSec(turn.startedAt)) }), '秒）'));
    } else if (turn.status === 'error') {
      el.append(h('div', { class: 'turn-error' },
        h('p', { class: 'error-text', text: `回答を得られませんでした：${turn.error ?? '理由不明'}` }),
        h('button', { type: 'button', class: 'btn', 'data-ui': true, text: 'もう一度', onclick: () => actions.retry(turn) })));
    } else {
      const answer = h('div', { class: 'answer', 'data-thread': turn.threadId, 'data-turn': turn.id });
      el.append(h('div', { class: 'turn-a' }, h('span', { class: 'turn-badge', text: 'A' }), answer));
      renderInto(answer, turn.answerMd ?? '');
    }
    return el;
  }

  // 子スレッドの引用に、親の回答の中で印を付ける
  function markChildren(turnId) {
    const answer = list.querySelector(`.answer[data-turn="${CSS.escape(turnId)}"]`);
    if (!answer) return;
    for (const th of Object.values(state.threads)) {
      if (th.parentTurnId === turnId) markQuote(answer, th.quote, { 'data-thread': th.id });
    }
  }

  function noteSaver(threadId) {
    if (!noteSavers.has(threadId)) {
      noteSavers.set(threadId, debounce(() => {
        const th = state.threads[threadId];
        actions.setCarry(threadId, { carryBack: !!th.carryBack, note: th.note ?? '' });
      }, 500));
    }
    return noteSavers.get(threadId);
  }

  function renderTools(th) {
    const tools = h('div', { class: 'thread-tools' });
    // 決める事項にひもづける（ひもづいた事項の名前は記録にも残す。外す×と選ぶ欄は操作部品）
    const linked = h('div', { class: 'thread-decisions' });
    for (const did of th.decisionIds ?? []) {
      linked.append(h('span', { class: 'decision-chip' }, `決める事項 ${did} ${decisionTitle(did)}`,
        h('button', { type: 'button', class: 'chip-x', 'data-ui': true, title: 'ひもづけを外す', text: '×',
          onclick: () => actions.linkDecision(th.id, did, false) })));
    }
    tools.append(linked);
    const free = decisions.filter((d) => !(th.decisionIds ?? []).includes(d.id));
    if (free.length > 0) {
      const sel = h('select', { class: 'link-select', 'data-ui': true, 'aria-label': '決める事項にひもづける' },
        h('option', { value: '', text: '決める事項にひもづける…' }),
        free.map((d) => h('option', { value: d.id, text: `${d.id} ${d.title ?? ''}` })));
      sel.addEventListener('change', () => { if (sel.value) actions.linkDecision(th.id, sel.value, true); });
      tools.append(sel);
    }
    // 指摘として持ち帰る（PR のときは出さない）
    if (kind !== 'pr') {
      const check = h('input', { type: 'checkbox', 'data-field': 'carryBack' });
      check.checked = !!th.carryBack;
      const note = h('textarea', { rows: 2, 'data-field': 'note', 'data-draft': `note:${th.id}`, placeholder: '指摘のメモ（何を直してほしいか）' });
      note.value = th.note ?? '';
      note.hidden = !th.carryBack;
      check.addEventListener('change', () => {
        th.carryBack = check.checked;
        note.hidden = !check.checked;
        noteSaver(th.id).flush();
        actions.setCarry(th.id, { carryBack: th.carryBack, note: th.note ?? '' });
      });
      note.addEventListener('input', () => { th.note = note.value; noteSaver(th.id)(); });
      tools.append(h('div', { class: 'carry' }, h('label', { class: 'carry-label' }, check, ' 指摘として持ち帰る'), note));
    }
    return tools;
  }

  function renderFollowup(th) {
    const input = h('textarea', { rows: 2, 'data-draft': `follow:${th.id}`, placeholder: '続けて質問する（Enter で送る・Shift+Enter で改行）' });
    const send = () => {
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      actions.ask({ threadId: th.id, action: 'question', question: q });
    };
    input.addEventListener('keydown', (e) => {
      if (isSendKey(e)) { e.preventDefault(); send(); }
    });
    return h('div', { class: 'followup', 'data-ui': true }, input,
      h('button', { type: 'button', class: 'btn', text: '続けて質問', onclick: send }));
  }

  function renderNode(node, depth) {
    const th = node.thread;
    const sec = h('section', { class: 'thread', 'data-thread-id': th.id, 'data-depth': depth });
    if (collapsed.has(th.id)) sec.classList.add('collapsed');
    const toggle = h('button', { type: 'button', class: 'toggle', 'data-ui': true, 'aria-label': '折りたたむ／開く' });
    toggle.addEventListener('click', () => {
      sec.classList.toggle('collapsed');
      if (sec.classList.contains('collapsed')) collapsed.add(th.id);
      else collapsed.delete(th.id);
    });
    const quote = h('button', { type: 'button', class: 'thread-quote', 'data-quote': th.quote, title: `${th.quote}\n（クリックで該当箇所へ）`,
      text: `「${shortQuote(th.quote)}」`, onclick: () => actions.gotoQuote(th.id) });
    const count = h('span', { class: 'thread-count', text: `${node.turns.length}件` });
    sec.append(h('header', { class: 'thread-head' }, toggle, quote, count));
    const body = h('div', { class: 'thread-body' });
    const turns = h('div', { class: 'turns' }, node.turns.map(renderTurn));
    body.append(turns, renderFollowup(th), renderTools(th));
    if (node.children.length > 0) body.append(h('div', { class: 'children' }, node.children.map((c) => renderNode(c, depth + 1))));
    sec.append(body);
    return sec;
  }

  function render() {
    // 書きかけの入力とフォーカスを保つ
    const drafts = new Map();
    for (const el of list.querySelectorAll('[data-draft]')) drafts.set(el.dataset.draft, el.value);
    const activeEl = document.activeElement;
    const active = list.contains(activeEl) ? activeEl.dataset?.draft : undefined;
    const sel = active ? [activeEl.selectionStart, activeEl.selectionEnd] : null;
    const tree = buildThreadTree(state);
    list.textContent = '';
    list.append(...tree.map((n) => renderNode(n, 0)));
    empty.hidden = tree.length > 0;
    for (const el of list.querySelectorAll('[data-draft]')) {
      if (drafts.has(el.dataset.draft)) el.value = drafts.get(el.dataset.draft);
      if (active && el.dataset.draft === active) {
        el.focus();
        if (sel) el.setSelectionRange(sel[0], sel[1]);
      }
    }
    for (const turn of Object.values(state.turns)) markChildren(turn.id);
  }

  return {
    render,
    flush: () => { for (const s of noteSavers.values()) s.flush(); },
    updateTurn(turn) {
      const old = list.querySelector(`.turn[data-turn-id="${CSS.escape(turn.id)}"]`);
      if (!old) return render();
      old.replaceWith(renderTurn(turn));
      markChildren(turn.id);
      return undefined;
    },
    tick() {
      for (const el of list.querySelectorAll('.elapsed[data-started]')) el.textContent = String(elapsedSec(el.dataset.started));
    },
    focus(threadId) {
      const sec = list.querySelector(`.thread[data-thread-id="${CSS.escape(threadId)}"]`);
      if (!sec) return;
      for (let p = sec; p; p = p.parentElement?.closest('.thread')) {
        p.classList.remove('collapsed');
        collapsed.delete(p.dataset.threadId);
      }
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      flash(sec.querySelector('.thread-head'));
    },
  };
}
