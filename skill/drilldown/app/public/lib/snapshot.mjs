// 記録用の 1 枚 HTML を作る。受け取る HTML は画面から DOM を複製して script と操作部品を除いた後のもの。
// ここでは最後の砦として <script> と on*= 属性だけを取り除く。
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const isWs = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';

// 開始タグ（<名前 ... >）の中だけを見て、on* 属性を取り除く。本文や、エスケープされたコード（&lt;...&gt;）は触らない。
// 属性の区切りは空白・/・閉じ引用符のどれでもよい（<svg/onload=x>、<a href="x"onclick=y> も拾う）。
function stripEventAttrs(html) {
  let out = '';
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0 || lt + 1 >= n) break;
    if (!/[A-Za-z]/.test(html[lt + 1])) {
      out += html.slice(i, lt + 1);
      i = lt + 1;
      continue;
    }
    out += html.slice(i, lt);
    let j = lt + 1;
    while (j < n && !isWs(html[j]) && html[j] !== '/' && html[j] !== '>') j++;
    const kept = [];
    let selfClose = false;
    let closed = false;
    while (j < n) {
      let slash = false;
      while (j < n && (isWs(html[j]) || html[j] === '/')) {
        if (html[j] === '/') slash = true;
        j++;
      }
      if (j >= n) break;
      if (html[j] === '>') {
        selfClose = slash;
        closed = true;
        j++;
        break;
      }
      const a = j;
      j++; // 先頭の文字は名前に含める（= で始まる属性などの崩れた形）
      while (j < n && !isWs(html[j]) && html[j] !== '/' && html[j] !== '>' && html[j] !== '=') j++;
      const name = html.slice(a, j);
      let k = j;
      while (k < n && isWs(html[k])) k++;
      if (html[k] === '=') {
        k++;
        while (k < n && isWs(html[k])) k++;
        const q = html[k];
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, k + 1);
          k = close < 0 ? n : close + 1;
        } else {
          while (k < n && !isWs(html[k]) && html[k] !== '>') k++;
        }
        j = k;
      }
      if (!/^on/i.test(name)) kept.push(html.slice(a, j));
    }
    if (!closed) {
      i = n; // 閉じていないタグはブラウザも捨てるので、ここから後ろも出さない
      break;
    }
    out += '<' + html.slice(lt + 1, lt + 1 + tagNameLen(html, lt + 1)) + kept.map((a) => ' ' + a).join('') + (selfClose ? '/' : '') + '>';
    i = j;
  }
  if (i < n) out += html.slice(i);
  return out;
}

function tagNameLen(html, from) {
  let e = from;
  while (e < html.length && !isWs(html[e]) && html[e] !== '/' && html[e] !== '>') e++;
  return e - from;
}

// 最後の砦：<script> と on*= 属性を取り除く（変化しなくなるまで繰り返す）
function stripDanger(html) {
  let s = String(html ?? '');
  for (let prev; prev !== s; ) {
    prev = s;
    s = stripEventAttrs(
      s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<\/?script\b[^>]*>?/gi, ''),
    );
  }
  return s;
}

export function buildSnapshotHtml({ title, css, docHtml, decisionsHtml, threadsHtml, savedAt }) {
  const safeCss = String(css ?? '').replace(/<\/style/gi, '<\\/style');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${safeCss}</style>
</head>
<body>
<section id="snapshot-decisions">
${stripDanger(decisionsHtml)}
</section>
<main id="snapshot-document">
${stripDanger(docHtml)}
</main>
<section id="snapshot-threads">
${stripDanger(threadsHtml)}
</section>
<footer id="snapshot-footer">保存日時：${esc(savedAt)}</footer>
</body>
</html>
`;
}

// スナップショットを作る。作れなかったら html なしと理由を返す（記録は record.md だけで残す）。
export function trySnapshot(build) {
  try {
    return { html: build(), error: null };
  } catch (e) {
    return { html: undefined, error: e?.message ?? String(e) };
  }
}
