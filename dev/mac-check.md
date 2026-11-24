# Mac での確認手順

drilldown は Windows の開発機で作りました。本物の `claude` の動きは Windows（claude 2.1.331）でしか確かめていません。
**Mac の Claude Code で、上から順に試してください。** 違ったところを、各項目の「違ったら伝えること」のとおりに開発者へ知らせてもらえれば直します。

確かめる項目は `docs/design.md` の「12. Mac での確認」。1〜7 がそこに挙げた7項目、8 は実際に `/drilldown` を使う確認、9 は作業フォルダの読み替え、10 はサンドボックスを使っているときの確認です（ここまでは Windows で確かめられていません）。

## 始める前に

- リポジトリの直下（`install.sh` があるところ）で操作します。
- Node.js 18 以上、`claude`、`gh`（8 の PR・issue だけ）が使えること。
- `bash install.sh` でスキルを入れておく（8 で使います。1〜7 は入れなくても進められます）。
- 1〜7 のコマンドは本物の `claude` を呼びます。少額ですが費用がかかります（3・4 で3〜4回、5 で数回）。
- 作ったものは各項目の最後の「後片付け」で消します。**消すのはその項目で作ったものだけです。**

`~` は自分のホームフォルダです。

---

## 1. `${CLAUDE_SESSION_ID}` と `${CLAUDE_SKILL_DIR}` がスキル本文で展開されるか

使い捨てのスキルを作って、本文に何が入るかを見ます。

```bash
mkdir -p ~/.claude/skills/zz-drilldown-probe
cat > ~/.claude/skills/zz-drilldown-probe/SKILL.md <<'EOF'
---
name: zz-drilldown-probe
description: drilldown の確認用。確認が終わったら消す。
disable-model-invocation: true
---

次の2行を、書かれているとおりに、そのまま1文字も変えずに答えてください。
session=${CLAUDE_SESSION_ID}
skilldir=${CLAUDE_SKILL_DIR}
EOF
```

Claude Code を開き直して（または新しく起動して）、`/zz-drilldown-probe` と打つ。

- 期待する結果：`session=` のうしろに UUID（`xxxxxxxx-xxxx-…` の形）、`skilldir=` のうしろに `/Users/…/.claude/skills/zz-drilldown-probe` が出る。`${…}` のままではない。
- UUID が本物かは、別の端末で `ls ~/.claude/projects/*/ | grep <UUID>` で `<UUID>.jsonl` が見つかれば確かめられる。
- 違ったら伝えること：`${CLAUDE_SESSION_ID}` / `${CLAUDE_SKILL_DIR}` のどちらがどう出たか（そのまま `${…}` か、空か、別の値か）。SKILL.md の起動手順（サーバーの `--session` と `app/server.js` のパス）がこの2つに頼っているので、展開されない場合は作り直しが必要。
  - `${CLAUDE_SESSION_ID}` だけ展開されなくても、サーバーは「一番新しい `.jsonl`」を自動で探すので動く。ただし別のセッションを掴むことがあるので、知らせてほしい。
- 後片付け：`rm -rf ~/.claude/skills/zz-drilldown-probe`

Windows での参考結果：未確認（対話実行をしていないため）。

## 2. `~/.claude/projects/<slug>/` の `<slug>` の作り方が合っているか

サーバーは `--cwd` から `<slug>` を計算して、メインのセッションと分岐の `.jsonl` の場所を決めます。計算は「英数字以外の文字をすべて `-` にする」です。

```bash
# いまのフォルダで計算した <slug>
node -e 'console.log(process.argv[1].replace(/[^a-zA-Z0-9]/g, "-"))' "$PWD"

# 実際に claude が作っているフォルダ（このフォルダで Claude Code を使ったことがあるなら出る）
ls ~/.claude/projects/
```

記号・空白・日本語・ドットを含むフォルダでも試す。このフォルダは作ってすぐ消す。

```bash
D="$(mktemp -d "${TMPDIR:-/tmp}/slug_a.b c日本-XXXXXX")" && cd "$D" && pwd -P
node -e 'console.log(process.argv[1].replace(/[^a-zA-Z0-9]/g, "-"))' "$(pwd -P)"
claude -p "ok とだけ答えて" > /dev/null
ls -t ~/.claude/projects/ | head -3
```

- 期待する結果：計算した `<slug>` と、`ls` に出たフォルダ名が一致する。Mac の `mktemp -d` は `/var/folders/…` で、実体は `/private/var/folders/…`（`pwd -P` の値）。`<slug>` は**実体のパス**から作られるはず。
- 違ったら伝えること：実際のフォルダ名と、そのときの `pwd -P`。特に、`/private` が付くか付かないか、日本語・空白・ドットが `-` になっているか。
- 後片付け：`cd ~` してから、このプロジェクトフォルダだけを消す。`rm -rf "$D"`、そして `ls -d ~/.claude/projects/*slug-a-b-c*` を実行し、**ちょうど1つだけ**出ることを確かめてから（2つ以上出たら消さずに、どれが今回のものか確かめる）、そのフォルダを `rm -rf ~/.claude/projects/<そのフォルダ名>`。

Windows での参考結果：英数字以外の文字がすべて `-` になった（`…\scratchpad\slug_a.b c日本` が `…-scratchpad-slug-a-b-c--` に）。`\` `:` `_` `.` 空白、日本語の2文字が、どれも1文字につき1つの `-`。

## 3. 分岐してもメインの jsonl が変わらない（と、分岐の session_id が指定どおりになる）

`dev/probe-fork.mjs` が、使い捨てフォルダで使い捨てのメインセッションを自分で作り、分岐の作り方を調べて、**自分が作ったものだけ**を消します（既存のセッションには触りません）。引数はありません。

```bash
node dev/probe-fork.mjs
```

1〜2分かかります（本物の `claude -p` を、通常は3回、(a) が失敗して参考の確認をするときだけ4回呼ぶ）。

- 期待する結果：最後の「結果」に次が出る。
  - `(a) --fork-session --session-id を受け付け、返る session_id が指定どおり` → `OK`
  - `(c) メインの jsonl のサイズ・mtime が前後で同じ` → `OK`
  - 最後に `後片付け: 一時フォルダを削除 / プロジェクトフォルダを削除`
- 違ったら伝えること：「結果」の部分をそのまま全部貼る。(a) が `NG` なら、`--session-id なしの --fork-session` の行（`(a-参考)`）も。(c) が `NG` なら size と mtime の前後の値。
- 後片付け：プローブが自分で消す。「後片付け」の行に「残っています」と出たら、そのパスだけを知らせてほしい。

Windows での参考結果：`--resume <メイン> --fork-session --session-id <新UUID>` は受け付けられ、返る `session_id` は指定した UUID と一致した。メインの jsonl のサイズ・mtime は分岐の前後で変わらなかった。

## 4. 続けて質問したとき（fork なしの `--resume`）に session_id が変わるか

質問のたびに新しい分岐ができるのか、同じ分岐が続くのかで、スレッドの作り方が変わります。3 と同じプローブの `(b)` の行です。

```bash
node dev/probe-fork.mjs   # 3 のときに見ていれば、もう一度走らせなくてよい
```

- 期待する結果：`(b) fork なしの --resume で session_id が変わるか` → `変わらない`（`resume <id>` と `返り <id>` が同じ）。
- 違ったら伝えること：`変わる` と出たとき、その行の全文。`resume` に渡した ID と、返ってきた ID を見比べる。変わる場合は、サーバーが保持している ID を毎回更新する作りに直す必要がある。
- 後片付け：プローブが消す。

Windows での参考結果：`--resume <メイン>`（fork なし）では `session_id` はメインのまま変わらなかった。分岐に対しても同じ振る舞い。

## 5. 起動オプション（permission-mode / disallowedTools / effort）と、MCP・Edit/Write の扱い

分岐した Claude は次のオプションで呼ばれます（`skill/drilldown/app/lib/claude.js` の `buildClaudeArgs`）。
`--permission-mode default --disallowedTools Edit Write NotebookEdit --effort low`、プロンプトは標準入力。

(a) オプションが受け付けられるか

```bash
claude --help | grep -E -- '--(effort|permission-mode|disallowedTools|fork-session|session-id)'
```

(b) Edit/Write が使えないこと（使い捨てフォルダで）

```bash
D="$(mktemp -d "${TMPDIR:-/tmp}/drilldown-eff-XXXXXX")" && cd "$D"
claude -p --permission-mode default --disallowedTools Edit Write NotebookEdit --effort low --output-format json \
  "hello.txt というファイルを作って、中に hi と書いて" < /dev/null | head -c 600; echo
ls "$D"
```

(c) MCP（設定で許可済みの Confluence 読み取りなど）が分岐した Claude で使えること：8 のあいだに、子スレッドで「（自分の Confluence の）○○ のページを読んで要点を3行で」と聞いてみる。MCP を使っていなければ、(c) は飛ばしてよい。

- 期待する結果：
  - (a) 5つのオプションがすべて見つかる。
  - (b) `ls "$D"` が空（`hello.txt` ができていない）。返答は「書き込めない」という趣旨。
  - (c) 許可済みの MCP は使えて、ページの内容を答える。「ファイルを作って」と頼んでも作れない。
- 違ったら伝えること：(a) 見つからないオプション名と `claude --version`。(b) `hello.txt` ができた場合、その返答。(c) MCP が使えなかった場合、そのときの返答（「許可されていない」などの文言）。MCP が毎回許可を求めて止まるなら、そう書く。
- メモ：Claude の自動メモリがプロジェクトフォルダに空の `memory/` フォルダを作ることがある。分岐の側は Write/Edit が禁止なのでメモリのファイルは書けない。`memory/` が残っていても気にしなくてよい（ただし中にファイルができていたら知らせてほしい）。
- 後片付け：`cd ~`、`rm -rf "$D"`、そして `ls -d ~/.claude/projects/*drilldown-eff*` を実行し、**ちょうど1つだけ**出ることを確かめてから（2つ以上出たら消さずに、どれが今回のものか確かめる）、そのフォルダを `rm -rf ~/.claude/projects/<そのフォルダ名>`。

Windows での参考結果：`--permission-mode default`、`--disallowedTools Edit Write NotebookEdit`（引数を空白で分けて並べる）、標準入力でのプロンプトは受け付けられた。`--effort` は `--help` に出る。MCP は未確認。

## 6. `open` でブラウザが開く／`nohup` でメインのターンが終わってもサーバーが生きている

SKILL.md の起動手順と同じ形で、サンプルを使って手で起動します。**Claude Code を使ったことのあるフォルダ**で実行してください（そこでの一番新しいセッションを掴むため。なければサーバーは「メインのセッションが見つかりません」で終わる）。

```bash
REPO=<このリポジトリのパス>          # ← ここだけ自分のパスに書き換える
WORK="$(pwd -P)"                      # Claude Code を使ったことのあるフォルダ（いまのフォルダ）
D="$(mktemp -d "${TMPDIR:-/tmp}/drilldown-XXXXXX")" && cp "$REPO"/dev/sample/* "$D"/

# 7 のために、いまの状態を控え、変数を env ファイルに残す（ターミナルを閉じても 7 で読み直せる）
SLUG="$(node -e 'console.log(process.argv[1].replace(/[^a-zA-Z0-9]/g, "-"))' "$WORK")"
ls ~/.claude/projects/"$SLUG"/ > "$D/before-projects.txt"
ls ~/.drilldown/records/ 2>/dev/null > "$D/before-records.txt"
printf 'D=%q\nWORK=%q\nSLUG=%q\n' "$D" "$WORK" "$SLUG" > "${TMPDIR:-/tmp}/drilldown-mac-check.env"

nohup node "$REPO/skill/drilldown/app/server.js" --dir "$D" --cwd "$WORK" > "$D/server.log" 2>&1 &
for i in 1 2 3 4 5 6 7 8 9 10; do [ -s "$D/url.txt" ] && break; sleep 0.5; done
cat "$D/url.txt" 2>/dev/null || tail -n 20 "$D/server.log"
```

そのシェル（ターミナル）を閉じてから、別のターミナルで次を実行する。

```bash
. "${TMPDIR:-/tmp}/drilldown-mac-check.env"
curl -s -o /dev/null -w '%{http_code}\n' "$(cat "$D/url.txt")"
```

- 期待する結果：
  - 起動直後に、既定のブラウザで画面が開き、サンプルの説明文（「通知の再送設計（サンプル）」）が出る。
  - ターミナルを閉じたあとも `200` が返る（サーバーが生きている）。
- 違ったら伝えること：ブラウザが開かない場合は `server.log` の内容。`200` が返らなかった場合、`ps aux | grep server.js` で生きているか。ターミナルを閉じると死ぬなら、そう書く。
- 後片付け：次の 7 に続けて使う。止めるときは、`. "${TMPDIR:-/tmp}/drilldown-mac-check.env"` で変数を読み直してから `kill "$(cat "$D/server.pid")"; rm -rf "$D" "${TMPDIR:-/tmp}/drilldown-mac-check.env"`（`$D` は起動時に作ったフォルダだけ）。

Windows での参考結果：ブラウザは `cmd /c start` で開く作り（Windows は開発用）。Mac の `open` は未確認。

## 7. 一通りの流れのあと、分岐の jsonl が消え、記録が残る

6 で起動した画面を使います。「いまの状態」の控え（`before-projects.txt` と `before-records.txt`）は 6 で取ってあります。新しいターミナルで、6 の変数を読み直します。

```bash
. "${TMPDIR:-/tmp}/drilldown-mac-check.env"   # D（作業フォルダ）・WORK（6 を実行したフォルダ）・SLUG を戻す
cd "$WORK"
echo "$D"; ls "$D"
```

`$D` の中に `url.txt` と `before-projects.txt` があることを確かめてから、画面で次を順にやる。

1. 文を選んで「新しいスレッド」で質問する
2. 同じスレッドでもう一度質問する（続けて質問）
3. 答えの文を選んで、子スレッドを作る
4. 「判断・指摘を持ち帰る」を押し、確認して送る（または「閉じる」）

そのあと、次を実行する。

```bash
sleep 3
ls ~/.claude/projects/"$SLUG"/ | diff - "$D/before-projects.txt" && echo "分岐の jsonl は残っていない"
ls ~/.drilldown/records/ | diff - "$D/before-records.txt"
ls ~/.drilldown/records/ | tail -1
curl -s -o /dev/null -w '%{http_code}\n' "$(cat "$D/url.txt")" || true
```

- 期待する結果：
  - `ls ~/.claude/projects/…` の前後で差がない（分岐の `.jsonl` と同名フォルダが消えている。メインの `.jsonl` は残っている）。ただし、空の `memory/` フォルダが増えることがある。
  - `~/.drilldown/records/` に新しいフォルダが1つ増え、中に `record.md` と `record.html` がある。「判断・指摘を持ち帰る」を押したときは、作業フォルダ（`$D`）に `return.md` もできている。
  - 最後の `curl` はつながらない（サーバーが止まっている。`000` が出る）。
- 違ったら伝えること：分岐の jsonl が残った場合、そのファイル名と、そこに至るまでにやった操作。記録ができなかった場合は `server.log` の内容。
- 後片付け：`rm -rf "$D" "${TMPDIR:-/tmp}/drilldown-mac-check.env"`（サーバーが止まっていれば `kill` は不要）。記録（`~/.drilldown/records/` のフォルダ）は、確認用なら自分で消してよい。

Windows での参考結果：偽の claude を使った自動テスト（`node --test test/`）では、「新しいスレッド→続けて質問→子スレッド→持ち帰る」が通り、メインの jsonl が変わらず、分岐の jsonl が消える。本物の claude でこの流れを通すのは Mac が初めて。

## 8. 実際に `/drilldown` を使う

ここまでの 1〜7 は部品の確認です。最後に、Claude Code の中で本物の `/drilldown` を使います。
Windows では**まだ確かめていないこと**：スキルの本文を、メインの Claude がそのとおりに実行するか／`${CLAUDE_SESSION_ID}`・`${CLAUDE_SKILL_DIR}` が実際の起動で展開されるか／PR・issue・Confluence の読み方／答えの中の mermaid の図／ダークモードの見た目。

`bash install.sh` を済ませ、Claude Code を新しく起動してから次を試す。

### 8-1. サンプルを開く

1. `/drilldown dev/sample/main.md`（リポジトリの直下で）
   - 期待：Claude が `mktemp -d` で作業フォルダを作り、サーバーを起動し、URL と「作業フォルダ：…」を返してターンを終える。ブラウザが開く。
   - `.md` ファイルなので、Claude が解説を書き直して開く。解説の中に mermaid の図が入っていて、画面で図として描かれていること。
   - 起動の確認：`ps aux | grep server.js` で、`--session` のうしろが `${CLAUDE_SESSION_ID}` という文字そのものではなく UUID になっていること。
2. 画面で文を選んで質問する（新しいスレッド）。答えが返る。続けて質問する。答えの文から子スレッドを作る。
3. 答えの中に表や図が出たとき、見た目が崩れていないか。OS をダークモードにして、読みにくいところがないか。
4. Claude に何か答えさせたあと、引数なしの `/drilldown` も一度やる：図が入るなら段落のあいだに差し込まれているだけで、本文の文は変わっていないこと。

### 8-2. 持ち帰って、「終わった」と言う

1. 画面で「判断・指摘を持ち帰る」を押す（決める事項に判断を付け、指摘を1つ書いてから）。確認して送る。
2. Claude Code に戻って「終わった」と伝える。
   - 期待：Claude が `<作業フォルダ>/return.md` を読み、ユーザー本人からのメッセージとして扱う。リポジトリ内のファイルへの反映は、その場で直すか提案する（サンプルは作り話なので、反映してほしくなければそう言う）。
   - 反映が済むか、受け止めたあとで、作業フォルダが消え（`ls -d "${TMPDIR:-/tmp}"/drilldown-*` に残らない）、サーバーが止まり、記録の場所（`~/.drilldown/records/…`）を伝えてくる。
   - 「閉じる」を押したときは、`return.md` なしで、記録の場所を一言伝えるだけで片付く。
3. `ls ~/.claude/projects/<slug>/` に、分岐の jsonl が残っていないこと。メインの `.jsonl` は残っていること。

### 8-3. PR を1つ

自分のリポジトリで、小さめの PR を1つ選び（なければ `gh pr list`）、`/drilldown #<番号>` または `/drilldown このPRを理解したい` と打つ。

- 期待：`gh` で PR を読んだ解説が開く。**良し悪しの評価や指摘が書かれていない**。画面に「判断・指摘を持ち帰る」が出ず、「閉じる」だけ。
- 閉じたあと「終わった」→ 記録の場所だけが伝えられ、片付く。

### 8-4. issue を1つ

`/drilldown #<issue の番号>` と打つ（PR か issue か分からない番号のとき、Claude が先に `gh pr view` で確かめる）。

- 期待：`gh issue view` で本文とコメントを読んだ解説が開く。持ち帰ると、本文の修正案かコメントの文面が**そのまま見せられ、確認してから**書く（確認なしで `gh issue edit` / `gh issue comment` を打たない）。試すときは、確認の場面で「やめておく」と答えてよい。

### 8-5. （あれば）Confluence

`/drilldown <Confluence の URL>`：使っている連携（MCP など）でページが読めて、解説が開く。読めなければ、読めないと伝えて終わること。

- 違ったら伝えること：どの手順の何番で、Claude が何を返したか（画面に出た文言をそのまま）。特に、Claude がスキルの手順から外れたとき（`<DIR>` を作らない、サーバーを起動しない、`return.md` を読まずに片付ける、PR で評価を書く、確認なしに外部へ書く）は、そのときのやりとり全体。
- 後片付け：`ls -d "${TMPDIR:-/tmp}"/drilldown-*` に作業フォルダが残っていたら、`server.pid` を確かめて `kill` し、**そのフォルダだけ**を `rm -rf`。

Windows での参考結果：なし（未確認）。

## 9. `--cwd` がメインのセッションの場所とずれていても、正しいフォルダを使うか

メインの Claude が途中で `cd` していたり、symlink のフォルダから起動していたりすると、`$(pwd -P)` が `~/.claude/projects/<slug>/` の `<slug>` と合わないことがあります。サーバーは起動時に、次の順でメインの `<セッションID>.jsonl` を探し、見つかったフォルダを作業フォルダにします（`resolveSessionCwd`）。
1. `--cwd` のまま　2. `--cwd` の実パス　3. `~/.claude/projects/*/<セッションID>.jsonl` を探し、その先頭 50 行にある `"cwd"` の値。
どれでも見つからなければ、`server.log` に「メインのセッション … の記録（.jsonl）が … 見つかりません」と書いて終わります。

Claude Code の中で、リポジトリの直下から始めて次を順にやる。
1. 「`cd dev` してから `pwd` を見せて」と頼む（メインの Claude の Bash の作業フォルダを `dev` に移す）。
2. `/drilldown sample/main.md` で開き、質問を1つする。
3. 別の端末で `cat "$(ls -dt "${TMPDIR:-/tmp}"/drilldown-* | head -1)/server.log"`。

- 期待する結果：答えが返る。`server.log` に「作業フォルダを …/dev から …（リポジトリの直下）に読み替えました」が出る（ずれなかったときは出ない）。閉じたあと、分岐の jsonl が `~/.claude/projects/<リポジトリの slug>/` に残っていない。
- 違ったら伝えること：`server.log` の全文と、そのときの `pwd -P`、`ls ~/.claude/projects/`。特に、`.jsonl` の先頭の行に `"cwd"` が無かった場合は、`head -c 2000 ~/.claude/projects/<slug>/<セッションID>.jsonl` の結果（中身に機密があれば `"cwd"` の周りだけ）。
- 後片付け：8 と同じ。

Windows での参考結果：単体テスト（`test/paths.test.js`）だけ。本物のセッションでは未確認。

## 10. Claude Code の Bash のサンドボックスを有効にしているとき

サンドボックス（`/sandbox`）を使っていなければ飛ばしてよい。使っている場合、サーバーと分岐した Claude（`claude`） がその中で動くため、`~/.claude`・`~/.drilldown` への読み書きや、ネットワーク（API 通信、`127.0.0.1` の待ち受け）が止められるおそれがあります。

1. サンドボックスを有効にしたまま、8-1 と同じく `/drilldown dev/sample/main.md` で開き、質問を1つして、「閉じる」→「終わった」。
2. 別の端末で `cat "$(ls -dt "${TMPDIR:-/tmp}"/drilldown-* | head -1)/server.log"`（片付けの前に）。

- 期待する結果：8-1・8-2 と同じに動く（URL が出る、答えが返る、`~/.drilldown/records/` に記録ができる、分岐の jsonl が消える）。
- 違ったら伝えること：どこで止まったか（URL が出ない／答えがエラー／記録ができない）、`server.log` の全文、画面に出たエラーの文言、サンドボックスの設定（許可しているパスやホスト）。
- 後片付け：8 と同じ。

Windows での参考結果：なし（未確認）。

---

## 結果の記入欄

| # | 項目 | 結果（OK / NG / 飛ばした） | メモ |
| --- | --- | --- | --- |
| 1 | `${CLAUDE_SESSION_ID}` / `${CLAUDE_SKILL_DIR}` の展開 | | |
| 2 | `<slug>` の作り方 | | |
| 3 | 分岐してもメインの jsonl が変わらない | | |
| 4 | fork なしの `--resume` で session_id が変わるか | | |
| 5 | 起動オプション・MCP・Edit/Write 禁止 | | |
| 6 | `open` と `nohup` | | |
| 7 | 流れのあとの jsonl 削除と記録 | | |
| 8 | 実際の `/drilldown`（サンプル・PR・issue） | | |
| 9 | `--cwd` がずれたときの読み替え | | |
| 10 | サンドボックスを有効にしたとき | | |
