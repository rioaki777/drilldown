// DOM を組み立てる小道具。文字は textContent で入れる（HTML として解釈しない）。
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// 最後の呼び出しから ms 待って fn を呼ぶ。flush() ですぐ呼ぶ。
export function debounce(fn, ms) {
  let timer = null;
  let lastArgs = [];
  const d = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...lastArgs); }, ms);
  };
  d.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    fn(...lastArgs);
  };
  return d;
}

export function flash(el) {
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth; // アニメーションをやり直す
  el.classList.add('flash');
}

export const ACTION_LABEL = { question: '質問', detail: 'もっと詳しく', term: '用語', diagram: '図', memo: 'メモ', point: '指摘' };
