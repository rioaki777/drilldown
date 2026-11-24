// Markdown -> HTML。marked と sanitize（DOMPurify.sanitize など）は呼び出し側から渡す
// （ブラウザでは vendor/ のもの、テストでは恒等関数）。marked の全体設定は書き換えない。
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// 言語行「言語 パス:開始行」「diff パス」「言語」を分解する
export function parseInfo(info) {
  const m = String(info ?? '').trim().match(/^(\S*)\s*(.*)$/s);
  const lang = m[1];
  const rest = m[2].trim();
  if (!rest) return { lang };
  if (lang === 'diff') return { lang, path: rest };
  const mm = rest.match(/^(.*\S):(\d+)$/s);
  return mm ? { lang, path: mm[1], start: mm[2] } : { lang, path: rest };
}

function renderCode(token) {
  const text = token.text ?? '';
  const { lang, path, start } = parseInfo(token.lang);
  if (lang === 'mermaid') return `<div class="mermaid" data-src="${escapeHtml(text)}"></div>\n`;
  let attrs = '';
  if (path !== undefined) attrs += ` data-path="${escapeHtml(path)}"`;
  if (start !== undefined) attrs += ` data-start="${escapeHtml(start)}"`;
  const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
  return `<pre${attrs}><code${cls}>${escapeHtml(text)}\n</code></pre>\n`;
}

function parseWithLocalMarked(marked, md) {
  if (typeof marked.Marked === 'function') {
    return new marked.Marked({ renderer: { code: renderCode } }).parse(md);
  }
  // 関数だけの marked（vendor の `marked`）：既定値の複製と新しい Renderer を使うので全体設定は変わらない
  const options = { ...marked.getDefaults() };
  const renderer = new marked.Renderer();
  renderer.code = renderCode;
  options.renderer = renderer;
  return new marked.Parser(options).parse(marked.lexer(md, options));
}

export function renderMarkdown(md, { marked, sanitize }) {
  return sanitize(parseWithLocalMarked(marked, String(md ?? '')));
}
