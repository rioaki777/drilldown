// 文を選んだときの小メニュー（質問／もっと詳しく／用語／図／メモ）。
// 本文の中で選べば新しいスレッド、回答の中で選べば その回答の子スレッドになる。
import { h } from './dom.mjs';

const ACTIONS = [
  ['question', '質問', true],
  ['detail', 'もっと詳しく', false],
  ['term', '用語', false],
  ['diagram', '図', false],
  ['memo', 'メモ', true],
];
const MAX_QUOTE = 4000;

export function createSelectionMenu({ docEl, threadsEl, onAsk }) {
  let current = null; // {quote, parentThreadId, parentTurnId}
  let pendingAction = null;

  const input = h('textarea', { rows: 3, class: 'menu-input' });
  const sendBtn = h('button', { type: 'button', class: 'btn btn-primary', text: '送る' });
  const cancelBtn = h('button', { type: 'button', class: 'btn', text: 'やめる' });
  const form = h('div', { class: 'menu-form', hidden: true }, input, h('div', { class: 'menu-form-buttons' }, cancelBtn, sendBtn));
  const buttons = h('div', { class: 'menu-buttons' });
  const menu = h('div', { class: 'sel-menu', 'data-ui': true, hidden: true, role: 'dialog', 'aria-label': '選んだ文について' }, buttons, form);
  document.body.append(menu);

  for (const [action, label, needsText] of ACTIONS) {
    buttons.append(h('button', {
      type: 'button', class: 'btn', 'data-action': action, text: label,
      onclick: () => {
        if (!current) return;
        if (needsText) {
          pendingAction = action;
          form.hidden = false;
          input.value = '';
          input.placeholder = action === 'memo' ? 'メモを書く' : '質問を書く（Ctrl+Enter で送る）';
          input.focus();
          return;
        }
        submit(action, '');
      },
    }));
  }

  function hide() {
    menu.hidden = true;
    form.hidden = true;
    current = null;
    pendingAction = null;
  }

  function submit(action, question) {
    if (!current) return;
    const body = { quote: current.quote, action, question };
    if (current.parentThreadId) {
      body.parentThreadId = current.parentThreadId;
      body.parentTurnId = current.parentTurnId;
    }
    hide();
    window.getSelection()?.removeAllRanges();
    onAsk(body);
  }

  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text || !pendingAction) return;
    submit(pendingAction, text);
  });
  cancelBtn.addEventListener('click', hide);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendBtn.click(); }
  });

  function contextOf(node) {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!el || el.closest('[data-ui], input, textarea, select, button')) return null;
    const answer = el.closest('.answer');
    if (answer && threadsEl.contains(answer)) return { root: answer, parentThreadId: answer.dataset.thread, parentTurnId: answer.dataset.turn };
    if (docEl.contains(el)) return { root: docEl };
    return null;
  }

  function check() {
    if (!menu.hidden && !form.hidden) return; // 入力中は選び直さない
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return hide();
    const quote = sel.toString().trim();
    if (!quote) return hide();
    const range = sel.getRangeAt(0);
    const a = contextOf(sel.anchorNode);
    const b = contextOf(sel.focusNode);
    if (!a || !b || a.root !== b.root) return hide(); // 本文と回答、別の回答をまたいだ選択は扱わない
    current = { quote: Array.from(quote).slice(0, MAX_QUOTE).join(''), parentThreadId: a.parentThreadId, parentTurnId: a.parentTurnId };
    const rect = range.getBoundingClientRect();
    menu.hidden = false;
    form.hidden = true;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let top = rect.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - mw - 8);
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    return undefined;
  }

  document.addEventListener('mouseup', (e) => {
    if (menu.contains(e.target)) return;
    setTimeout(check, 0);
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') return hide();
    if (menu.contains(e.target)) return undefined;
    if (e.shiftKey || e.key === 'Shift') setTimeout(check, 0);
    return undefined;
  });
  document.addEventListener('mousedown', (e) => {
    if (!menu.contains(e.target) && !form.hidden) hide();
  });
  for (const pane of [docEl.closest('.pane'), threadsEl.closest('.pane')]) {
    pane?.addEventListener('scroll', () => { if (form.hidden) hide(); }, { passive: true });
  }

  return { hide };
}
