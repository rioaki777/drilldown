// 文字列を並べた節（テキストノード）の長さの列と、つないだ文字列上の範囲 [start, end) から、
// 節ごとの部分範囲 {index, start, end}（節の中の位置）を返す。印を付けるときに節ごとに包むため。
export function splitRange(lengths, start, end) {
  const out = [];
  let pos = 0;
  lengths.forEach((len, index) => {
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + len);
    if (s < e) out.push({ index, start: s - pos, end: e - pos });
    pos += len;
  });
  return out;
}
