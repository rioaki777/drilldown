// 記録用に画面の DOM を複製する。入力欄はその時の値の文字に置き換え、[data-ui] を消し、スレッドを全部開く。
import { h } from './dom.mjs';

function freezeFields(live, clone) {
  const sel = 'input, textarea, select';
  const a = [...live.querySelectorAll(sel)];
  const b = [...clone.querySelectorAll(sel)];
  b.forEach((el, i) => {
    const src = a[i];
    if (!src || el.closest('[data-ui]')) return;
    let text;
    if (src.type === 'checkbox') text = src.checked ? '✔' : '';
    else if (src.tagName === 'SELECT') text = src.selectedOptions[0]?.textContent ?? src.value;
    else text = src.value.trim() === '' ? '（未記入）' : src.value;
    el.replaceWith(h('span', { class: `snap-value snap-${src.dataset.field ?? 'value'}`, text }));
  });
}

function cloneSection(live) {
  if (!live) return '';
  const clone = live.cloneNode(true);
  freezeFields(live, clone);
  // 持ち帰らないスレッドの「指摘として持ち帰る」欄は記録に要らない
  [...live.querySelectorAll('.carry')].forEach((c, i) => {
    const checked = c.querySelector('input[type=checkbox]')?.checked;
    if (!checked) clone.querySelectorAll('.carry')[i]?.setAttribute('data-ui', '');
  });
  for (const el of clone.querySelectorAll('[data-ui]')) el.remove();
  for (const el of clone.querySelectorAll('.collapsed')) el.classList.remove('collapsed');
  for (const el of clone.querySelectorAll('details')) el.open = true;
  for (const el of clone.querySelectorAll('[hidden]')) el.removeAttribute('hidden');
  for (const el of clone.querySelectorAll('.thread-quote[data-quote]')) el.textContent = `「${el.dataset.quote}」`;
  return clone.innerHTML;
}

export function collectSnapshotParts({ docEl, decisionsEl, threadsEl }) {
  return {
    docHtml: cloneSection(docEl),
    decisionsHtml: decisionsEl.hidden ? '' : cloneSection(decisionsEl),
    threadsHtml: cloneSection(threadsEl),
  };
}
