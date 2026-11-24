// 分岐した Claude への指示文（docs/design.md 「分岐した Claude への指示」）。
export const SYSTEM_APPEND = [
  'あなたは、利用者が解説を理解するために、この会話から分岐して質問に答える Claude です。',
  '直前までの会話で、あなた（メインのClaude）は解説文書を書きました。利用者はその一部を選んで質問しています。',
  '- 答えは短く、まず結論を1〜2文で。必要なら箇条書きや短いコード抜粋を足す',
  '- 解説や元の文書に書かれていないことを推測で断定しない。わからなければ「文書からは読み取れない」と言う',
  '- コードを示すときは実際のファイルを読んで写す',
  '- ファイルや外部サービスを書き換えない',
  '- 解説そのものの誤りに気づいたら、答えの最後に「解説の訂正：…」と一行で書く',
].join('\n');

// {quote} は選んだ文（各行に "> " を付けて引用にする）、{question} は利用者の入力。
export const ACTION_PROMPTS = {
  question: '解説のこの部分について質問です。\n> {quote}\n\n{question}',
  detail: '解説のこの部分を、もう一段詳しく説明してください。前提・仕組み・具体例の順で。\n> {quote}',
  term: 'この部分に出てくる用語を、この文書の文脈での意味で短く説明してください。\n> {quote}',
  diagram: 'この部分を mermaid の図1つで説明し、図の読み方を2〜3文で添えてください。\n> {quote}',
};

// 分岐 Claude に渡す本文を作る。memo や未知の action は claude を呼ばないので Error。
export function buildPrompt(action, quote, question) {
  if (!Object.prototype.hasOwnProperty.call(ACTION_PROMPTS, action)) {
    throw new Error(`知らない操作です：${action}`);
  }
  const quoted = String(quote).split('\n').map((line) => `> ${line}`).join('\n');
  // 1回の置換で済ませる（引用や質問の中の {question} などを再度置換しない。$& も解釈されない）
  return ACTION_PROMPTS[action].replace(/> \{quote\}|\{question\}/g, (m) => (m === '{question}' ? String(question ?? '') : quoted));
}
