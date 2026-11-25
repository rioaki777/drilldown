// 本文とスレッドの幅の割合（本文の側、0〜1）。どちらの欄も最小の幅を下回らないように収める。
export const DEFAULT_SPLIT = 0.6;

export function clampSplit(ratio, total, minLeft, minRight) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || !(total > 0)) return DEFAULT_SPLIT;
  const lo = minLeft / total;
  const hi = 1 - minRight / total;
  if (lo > hi) return DEFAULT_SPLIT; // 画面が狭すぎて両方の最小を満たせない
  return Math.min(Math.max(r, lo), hi);
}
