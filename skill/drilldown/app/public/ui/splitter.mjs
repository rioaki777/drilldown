// 本文とスレッドの間の仕切り。ドラッグか矢印キーで幅を変え、ダブルクリックで元に戻す。
// 割合はブラウザに覚えておき、次に開いたときも同じ幅にする。
import { clampSplit, DEFAULT_SPLIT } from '../lib/split.mjs';

const KEY = 'drilldown-split';
const MIN_LEFT = 280;
const MIN_RIGHT = 280;
const STEP = 0.02;

export function createSplitter({ layout, handle }) {
  let ratio = DEFAULT_SPLIT; // いま使っている割合
  let wanted = DEFAULT_SPLIT; // 利用者が選んだ割合（画面が狭くて収まらないときも覚えておく）
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (saved > 0 && saved < 1) wanted = saved;
  } catch { /* 覚えられなくても既定の幅で使える */ }

  const width = () => layout.getBoundingClientRect().width - handle.offsetWidth;
  function apply(r, save) {
    ratio = clampSplit(r, width(), MIN_LEFT, MIN_RIGHT);
    if (save) wanted = ratio;
    layout.style.setProperty('--split-left', `${ratio}fr`);
    layout.style.setProperty('--split-right', `${1 - ratio}fr`);
    handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    if (save) {
      try { localStorage.setItem(KEY, String(ratio)); } catch { /* 無視 */ }
    }
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const left = layout.getBoundingClientRect().left;
    const move = (ev) => apply((ev.clientX - left - handle.offsetWidth / 2) / width(), false);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      apply(ratio, true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') apply(ratio - STEP, true);
    else if (e.key === 'ArrowRight') apply(ratio + STEP, true);
    else return;
    e.preventDefault();
  });
  handle.addEventListener('dblclick', () => apply(DEFAULT_SPLIT, true));
  window.addEventListener('resize', () => apply(wanted, false));

  apply(wanted, false);
}
