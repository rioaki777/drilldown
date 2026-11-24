// 左上の「決める事項」欄。入力はその場で state.decisions に写し、保存は onChange に任せる。
import { h, flash } from './dom.mjs';

const STATUSES = ['未決', '決定', '保留'];

export function createDecisions({ container, decisions, state, onChange, onGotoQuote, onGotoThread, threadLabel }) {
  const items = new Map(); // id -> {el, links, error}
  const ds = (id) => state.decisions[id] ?? (state.decisions[id] = { status: '未決', judgement: '', reason: '', threadIds: [] });

  const summary = h('summary', { class: 'decisions-summary' });
  const list = h('div', { class: 'decisions-list' });
  const details = h('details', { class: 'decisions', open: true }, summary, list);

  function refreshSummary() {
    const open = decisions.filter((d) => ds(d.id).status === '未決').length;
    summary.textContent = `決める事項（${decisions.length}件・未決${open}）`;
  }

  function refreshLinks(id) {
    const item = items.get(id);
    if (!item) return;
    item.links.textContent = '';
    const ids = ds(id).threadIds ?? [];
    if (ids.length === 0) {
      item.links.append(h('span', { class: 'muted', text: 'ひもづいたスレッドはありません' }));
      return;
    }
    for (const tid of ids) {
      item.links.append(h('button', {
        type: 'button', class: 'link-chip', 'data-goto-thread': tid, text: `「${threadLabel(tid)}」`,
        onclick: () => onGotoThread(tid),
      }));
    }
  }

  for (const d of decisions) {
    const cur = ds(d.id);
    const status = h('select', { class: 'field-status', 'data-field': 'status', 'aria-label': '状態' },
      STATUSES.map((s) => h('option', { value: s, text: s, selected: s === cur.status })));
    const judgement = h('textarea', { rows: 2, 'data-field': 'judgement', placeholder: '判断（何に決めたか）' });
    judgement.value = cur.judgement ?? '';
    const reason = h('textarea', { rows: 2, 'data-field': 'reason', placeholder: '理由' });
    reason.value = cur.reason ?? '';
    const links = h('div', { class: 'decision-links' });
    const error = h('p', { class: 'error-text', 'data-ui': true, hidden: true });

    const update = () => {
      const s = ds(d.id);
      s.status = status.value;
      s.judgement = judgement.value;
      s.reason = reason.value;
      el.dataset.status = s.status;
      refreshSummary();
      onChange(d.id);
    };
    status.addEventListener('change', update);
    judgement.addEventListener('input', update);
    reason.addEventListener('input', update);

    const head = h('div', { class: 'decision-head' },
      h('span', { class: 'decision-id', text: d.id }),
      h('span', { class: 'decision-title', text: d.title ?? '' }),
      status);
    const quote = d.quote
      ? h('button', { type: 'button', class: 'decision-quote', title: '本文の該当箇所へ', text: `「${d.quote}」`, onclick: () => onGotoQuote(d.id) })
      : null;
    const el = h('article', { class: 'decision', 'data-decision-id': d.id, 'data-status': cur.status },
      head,
      quote,
      d.context ? h('p', { class: 'decision-context', text: d.context }) : null,
      (d.options ?? []).length > 0 ? h('p', { class: 'decision-options', text: `選択肢：${d.options.join(' / ')}` }) : null,
      h('label', { class: 'field' }, h('span', { text: '判断' }), judgement),
      h('label', { class: 'field' }, h('span', { text: '理由' }), reason),
      h('div', { class: 'decision-linked' }, h('span', { class: 'label', text: 'ひもづいたスレッド：' }), links),
      error);
    items.set(d.id, { el, links, error });
    list.append(el);
    refreshLinks(d.id);
  }
  refreshSummary();
  container.textContent = '';
  if (decisions.length > 0) container.append(details);
  container.hidden = decisions.length === 0;

  return {
    refreshLinks,
    refreshAllLinks: () => decisions.forEach((d) => refreshLinks(d.id)),
    showError(id, message) {
      const item = items.get(id);
      if (!item) return;
      item.error.hidden = !message;
      item.error.textContent = message ? `保存できませんでした：${message}` : '';
    },
    focus(id) {
      const item = items.get(id);
      if (!item) return;
      details.open = true;
      item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flash(item.el);
    },
  };
}
