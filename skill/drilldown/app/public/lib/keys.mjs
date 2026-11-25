// 入力欄の送信キー：Enter で送り、Shift+Enter は改行にする。
// 日本語入力の変換を確定する Enter（isComposing、古いブラウザでは keyCode 229）では送らない。
export function isSendKey(e) {
  if (e.key !== 'Enter' || e.shiftKey) return false;
  if (e.isComposing || e.keyCode === 229) return false;
  return true;
}
