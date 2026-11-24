// 本文・回答の描画後の仕上げ：Markdown → HTML、コード抜粋の行番号、mermaid の描画、引用の印。
import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';
import { renderMarkdown } from '../lib/markdown.mjs';
import { findQuoteRange } from '../lib/locate-quote.mjs';
import { splitRange } from '../lib/segments.mjs';
import { h } from './dom.mjs';

// mermaid の元コード（data-src）には `-->` が入るが、DOMPurify は既定で `-->` を含む属性値を消す。
// そこで div.mermaid の data-src だけ、検査の前に URI 符号化（< > を含まない形）にしておき、描くときに戻す。
const ENC = 'u:';
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'data-src' && node.nodeName === 'DIV' && node.classList.contains('mermaid')) {
    data.attrValue = ENC + encodeURIComponent(data.attrValue);
  }
});
const decodeSrc = (s) => {
  if (!s.startsWith(ENC)) return s;
  try { return decodeURIComponent(s.slice(ENC.length)); } catch { return ''; }
};
const sanitize = (html) => DOMPurify.sanitize(html);

let mermaidReady = false;
function mermaidLib() {
  const m = globalThis.mermaid;
  if (!m) return null;
  if (!mermaidReady) {
    m.initialize({ startOnLoad: false, securityLevel: 'strict' });
    mermaidReady = true;
  }
  return m;
}

// コード抜粋：行ごとに <span class="line"> で包む（改行は span の中に残すので textContent は変わらない）。
// 行番号と見出し（パス）は CSS の ::before で出す（選択・引用の文字に混ざらない）。
function decorateCode(root) {
  for (const pre of root.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code || code.dataset.lined) continue;
    code.dataset.lined = '1';
    const text = code.textContent.replace(/\n$/, '');
    code.textContent = '';
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      code.append(h('span', { class: 'line' }, i < lines.length - 1 ? `${line}\n` : line));
    });
    const start = Number(pre.dataset.start);
    if (Number.isFinite(start) && pre.dataset.start !== undefined) {
      pre.classList.add('numbered');
      pre.style.counterReset = `line ${start - 1}`;
    }
  }
}

// mermaid は 1 つずつ順に描く（並べて描くと mermaid の内部状態がぶつかる）
let mermaidQueue = Promise.resolve();
let mermaidSeq = 0;
function renderMermaid(root) {
  const targets = [...root.querySelectorAll('div.mermaid:not([data-drawn])')];
  for (const div of targets) {
    div.dataset.drawn = 'pending';
    mermaidQueue = mermaidQueue.then(async () => {
      const src = decodeSrc(div.dataset.src ?? '');
      const id = `mmd-${++mermaidSeq}`;
      try {
        const m = mermaidLib();
        if (!m) throw new Error('mermaid を読み込めませんでした');
        const { svg } = await m.render(id, src);
        div.innerHTML = svg;
        div.dataset.drawn = 'ok';
      } catch (e) {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        div.textContent = '';
        div.append(
          h('p', { class: 'mermaid-error', text: `図を描けませんでした（${e?.message ?? e}）。元のコードを出します。` }),
          h('pre', {}, h('code', { text: src })),
        );
        div.dataset.drawn = 'error';
      }
    });
  }
  return mermaidQueue;
}

// Markdown を el に描き、仕上げまで行う
export function renderInto(el, md) {
  el.innerHTML = renderMarkdown(md, { marked, sanitize });
  decorateCode(el);
  renderMermaid(el);
}

// 引用の印の対象になるテキストノード（図の中と操作部品の中は除く）
function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('.mermaid, svg, [data-ui], script, style')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const out = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
  return out;
}

// root の中で quote を探して <mark> で包む。attrs は {'data-thread': id} など。見つかれば true。
// 要素をまたぐときはテキストノードごとに包む。見つからなければ何もしない。
export function markQuote(root, quote, attrs) {
  if (!root || typeof quote !== 'string' || quote.trim() === '') return false;
  const nodes = textNodes(root);
  const text = nodes.map((n) => n.data).join('');
  const range = findQuoteRange(text, quote);
  if (!range) return false;
  const segs = splitRange(nodes.map((n) => n.data.length), range.start, range.end);
  let marked = false;
  for (const { index, start, end } of segs) {
    let node = nodes[index];
    if (node.data.slice(start, end).trim() === '') continue; // 要素の間の空白は包まない
    if (end < node.data.length) node.splitText(end);
    if (start > 0) node = node.splitText(start);
    const mark = h('mark', attrs);
    node.parentNode.insertBefore(mark, node);
    mark.append(node);
    marked = true;
  }
  return marked;
}
