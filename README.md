# drilldown（`/drilldown`）

drilldown は issue・設計書・仕様書・PR などを、選んだ箇所について質問しながら理解するための Claude Code のスキルです。

- Claude が対象を調べて解説を書き、ブラウザの画面に開きます。左に解説、右に選んだ文ごとの質問スレッドが並びます。
- わからない文を選んで質問すると、スレッドごとにメインの会話から分岐した Claude が答えます。解説を書いたメインの会話の文脈を引き継いで答えるので話が食い違いにくく、メインの会話は変わりません。
- 文書に人が決める事項があれば、画面で判断と理由を書き、メインの会話に持ち帰って元の文書に反映できます。
- 終わると、質問と答えの記録が手元に残ります。

対象にできるのは、PR・issue・Confluence のページ・リポジトリ内の文書やコード・差分・Claude の直前の回答です。

## インストール

必要なもの：Node.js 18 以上、Claude Code（`claude` コマンド）。

```bash
bash install.sh
```

`~/.claude/skills/drilldown` に `skill/drilldown/` をコピーします（すでにあれば作り直します。消すのはそのフォルダだけです）。コピーしたら Claude Code を開き直してください。

## 使い方

Claude Code で `/drilldown` と打ちます。

```
/drilldown                          直前の Claude の回答をそのまま開く
/drilldown このPRを理解したい         依頼文から、説明文書を作って開く
/drilldown #128                     PR か issue の番号（PR か issue かは自動で判断）
/drilldown https://github.com/…     PR・issue の URL
/drilldown src/notify/retry.py      ファイル（コードはそのまま、.md は解説を書いて開く）
/drilldown diff                     未コミットの変更
/drilldown diff main                main からの変更
```

対象の種類は PR・issue・Confluence・`.md`・その他のファイル・差分・直前の回答・依頼文のどれかで、スキルが判断します。

流れや構成、数の内訳など、図にしたほうが分かりやすい箇所には、Claude が mermaid の図を自動で入れます。

画面が開いたら、わからない文を選んで質問します。答えの文からさらに子スレッドを作れます。質問は Enter で送り、Shift+Enter で改行します。

本文とスレッドの間の仕切りをドラッグすると、左右の幅を変えられます。ダブルクリックで元の幅に戻ります。

質問は声でも入力できます。文を選んで「質問」を押し、入力欄にカーソルがある状態で、Windows なら Win+H、Mac なら Fn キーを2回押して話します。OS の音声入力を使うので、画面側の設定はいりません。

## 終わり方

理解し終えたら、画面で次のどちらかを押し、Claude Code で「終わった」と伝えます。

- 「閉じる」：記録だけを残して終わる
- 「判断・指摘を持ち帰る」：決めたこと・気づいたことをメインの Claude に返す。Claude が元の文書に反映する（issue や Confluence など外部への書き込みは、案を見せて確認してから）

PR のときは「閉じる」だけです（このスキルはレビュー用ではありません）。

画面を6時間さわらないと、サーバーは自動で終わります。そのとき、テキスト版の記録（`record.md`）を残し、分岐した Claude の会話（分岐のセッション）を消します。**作業フォルダは消えません**。作業フォルダを消すのは、Claude Code で「終わった」と伝えたときの後片付けだけです（6時間で終わったあとでも、「終わった」と伝えれば片付きます）。

## 残るもの・残らないもの

- 残る：`~/.drilldown/records/<日時>-<題名>/` の `record.html` と `record.md`（質問と答えの記録）。自動では消しません。
- 残らない：
  - 分岐した Claude の会話（`~/.claude/projects/` の下の分岐のセッションの `.jsonl`）。サーバーが終わるとき（閉じる・持ち帰る・6時間の放置・`kill`）に消えます。
  - 作業フォルダ（`mktemp -d` で作る一時フォルダ）。Claude Code で「終わった」と伝えたときに消えます。伝えなければ残ります（OS の一時フォルダの掃除に任せるか、`ls -d "${TMPDIR:-/tmp}"/drilldown-*` で探して消してください）。
- 消しきれないもの：分岐した Claude が `~/.claude/projects/` の外に書くもの（`~/.claude/todos/`、`~/.claude/file-history/`、シェルのスナップショットなど、Claude Code が自分で管理するもの）は消しません。中身はセッションごとの小さなファイルです。
- 変わらない：メインの会話。分岐は別セッションとして作られ、メインのセッションには触りません。

## 費用の目安

分岐した Claude はメインの会話を引き継いで答えます。**新しいスレッドの最初の質問では、メインの文脈を丸ごと読む**ので、会話が長いほど費用がかかります。同じスレッドで続けて質問するぶんは、その分岐の文脈を使います。分岐した Claude は `--effort low` で動かします。

## 安全のための仕組み

- 画面のサーバーは `127.0.0.1`（自分のマシンの中）だけで待ち受ける
- `/api` はすべて、起動のたびに作るランダムな合言葉をヘッダ（`X-Drilldown-Token`）で付けないと受け付けない（URL の `?t=` では `/api` に入れない）
- `Host` ヘッダを確認し、想定外のホスト名からのアクセスは断る
- 画面には CSP などの安全ヘッダを付け、取り込んだ文書は無害化してから表示する
- 分岐した Claude は手元のファイルを書き換える Edit/Write/NotebookEdit だけ禁止。利用者の設定で許可済みの道具（MCP・gh・Bash の許可パターンなど）はそのまま使える（書き込める許可があれば書き込める）。確認なしモードは引き継がない（`--permission-mode default`）
- 後片付けで消すのは、**このサーバーが作った分岐のセッションだけ**。メインのセッションは消さない・書き換えない

### Claude Code のサンドボックスを使っているとき

Claude Code の Bash のサンドボックス（`/sandbox`）を有効にしていると、スキルが Bash で起動するサーバーと、そこから呼ぶ分岐した Claude（`claude`）もサンドボックスの中で動きます。その場合、`~/.claude`（セッションの読み書き）、`~/.drilldown`（記録）、ネットワーク（分岐した Claude の API 通信、`127.0.0.1` の待ち受け）が止められて、起動しない・答えが返らない・記録が書けない、ということがあります。そうなったら `<作業フォルダ>/server.log` を見て、サンドボックスの許可を足すか、このスキルを使うあいだだけサンドボックスを外してください（Mac では未確認。`dev/mac-check.md` の 10）。

## 環境変数

| 名前 | 意味 | 既定 |
| --- | --- | --- |
| `DRILLDOWN_CLAUDE_BIN` | 分岐した Claude として呼ぶ `claude` の場所（`.js` なら Node で実行する。テストの偽 claude 用） | `claude`（PATH から） |
| `DRILLDOWN_TIMEOUT_SEC` | 分岐した Claude への1回の質問の時間切れ（秒） | `300` |

## 開発とテスト

```bash
node --test test/
```

Node の標準機能だけで動き、本物の `claude` は呼びません（`dev/mock-claude.js` の偽の claude を使う）。本物の `claude` での確認は次のとおりです。

- `node dev/probe-fork.mjs`：使い捨てのセッションで、分岐の作り方（`--fork-session --session-id`、続けて質問したときの `session_id`、メインの jsonl が変わらないこと）を確かめ、自分が作ったものだけを消す
- `dev/mac-check.md`：Mac で順に試す確認手順（1〜7 が部品の確認、8 が実際の `/drilldown`、9 が作業フォルダの読み替え、10 がサンドボックス）。これまでの確認は Windows（claude 2.1.331）のもので、Mac は未確認です
- `dev/fetch-vendor.sh`：画面用ライブラリ（marked・DOMPurify・mermaid）を取り直す

## 設計書

目的・設計の判断・サーバーの仕組みは `docs/design.md` にあります。

## ライセンス

MIT ライセンスです（[LICENSE](LICENSE)）。同梱している marked・mermaid は MIT、DOMPurify は Apache License 2.0 と MPL 2.0 のデュアルライセンスで、それぞれのライセンス文は `skill/drilldown/app/public/vendor/` にあります。
