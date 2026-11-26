質問に答える。答えは 2 種類ある。`reply` は質問に答える。`decline` は答えるのを断る。

`reply` では `answers` を付ける。`answers` は質問の `questions` と同じ順序・同じ個数で並べ、各項目に選んだ `labels` か自由入力の `text` を入れる。`multiSelect` が `true` の質問は、複数の `labels` と、`labels` と `text` の併用を受け付ける。`false` の質問は、`labels` を 1 つだけか `text` だけを受け付ける。`reply` に `comment` を付けると、400 を返す。

`decline` は回答の拒否として AI に渡り、AI は作業を続ける。`comment` を付けると理由として AI に渡る。`decline` に `answers` を付けると、400 を返す。

答えはどの client からでも送れる。先に届いた答えで確定する。確定すると質問は消え、`reply` なら `answers` を持つ `question.resolved`、`decline` なら理由 `declined` の `question.rejected` が流れる。`comment` を付けていれば `question.rejected` にも載る。後から届いた答えには、質問が既に無いので 404 を返す。期限が過ぎた質問と打ち切られた質問も消えているので、404 を返す。

期限が過ぎるまで答えが無いと、実行を終える。理由 `expired` の `question.rejected` が流れる。

質問を待つ間に `POST /conversations/{id}/inputs` で送った入力は、待たせておき、質問が片付いた後に動かす。`decline` と期限切れでも片付いたものとして扱う。停止 (`POST /conversations/{id}/stop`) と削除では、質問と一緒に破棄する。
