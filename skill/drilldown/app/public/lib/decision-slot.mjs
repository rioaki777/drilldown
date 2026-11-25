// 本文の見出しのうち、決める事項に対応するもの（`### d1 <題名>` など）を見分ける。
// 見出しが「d1」で始まる（d10 とは区別する）か、見出しの文字が題名と同じなら対応するとみなす。
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function headingMatchesDecision(text, decision) {
  const t = norm(text);
  const id = norm(decision?.id);
  if (id && t.startsWith(id) && !/^[0-9A-Za-z_-]/.test(t.slice(id.length))) return true;
  const title = norm(decision?.title);
  return title !== '' && t === title;
}

// 見出しの並び（levels[i] は h1〜h6 の数字。見出しでない要素は 0）で、i 番目の見出しの節が
// どこで終わるかを返す（次の同じか上の階層の見出しの位置。なければ levels.length）。
export function sectionEnd(levels, i) {
  for (let j = i + 1; j < levels.length; j++) {
    if (levels[j] > 0 && levels[j] <= levels[i]) return j;
  }
  return levels.length;
}
