// text の中で quote が書かれている場所を {start, end}（元の text の添字・end は含まない）で返す。
// 完全一致が無ければ、空白の連続を 1 つの空白とみなし、Markdown 記号（* _ `）を無視して探す。
const IGNORED = new Set(['*', '_', '`']);
const isSpace = (c) => /\s/.test(c);

function normalize(s) {
  let out = '';
  const map = []; // out の i 文字目が元の何文字目か
  let pendingSpace = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (IGNORED.has(c)) continue;
    if (isSpace(c)) {
      if (pendingSpace < 0) pendingSpace = i;
      continue;
    }
    if (pendingSpace >= 0 && out.length > 0) {
      out += ' ';
      map.push(pendingSpace);
    }
    pendingSpace = -1;
    out += c;
    map.push(i);
  }
  return { out, map };
}

export function findQuoteRange(text, quote) {
  if (typeof text !== 'string' || typeof quote !== 'string' || quote.trim() === '') return null;
  const exact = text.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  const q = normalize(quote).out;
  if (q === '') return null;
  const { out, map } = normalize(text);
  const i = out.indexOf(q);
  if (i < 0) return null;
  return { start: map[i], end: map[i + q.length - 1] + 1 };
}
