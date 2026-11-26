定期実行の定義を登録する。ID は client が決める。既にある ID を指した場合は、body の内容で置き換える。`PUT /conversations/{id}` と違い、既存の内容を変える。置き換えた時点で動いている実行は、置き換える前の内容のまま続く。置き換えた内容は、次の発火から効く。

動かすものは `type` で決まる。`command` と `prompt` は会話を持たない。出力と失敗は API に流れず、server のログに残る。`GET /events` には何も流れない。承認や質問が出た場合は、答える人が居ないので、承認は `comment` の無い拒否として、質問は期限切れと同じように扱い、どちらもその実行を終える。

`conversation.input` は、`conversationId` の会話へ入力を待ち行列に積む。出力は `GET /events` の `message.created` で届く。会話が無ければ、発火時に server が作る。登録の時点では会話の存在を確かめない。

`prompt` は `settings` の `model` と `effort` で実行する。`settings` を省いて登録した場合は、server の既定値が入る。`settings` を書くときは、`model` と `effort` の両方が要る。`conversation.input` は、届け先の会話の `settings` で動く。`settings` は `type` が `prompt` のときだけ書ける。

時刻が来たとき、同じ定義の前回の実行がまだ終わっていなければ、その回を飛ばす。`conversation.input` で、その会話が別の入力を処理している場合は、待ち行列で待つ。

`once` が `true` の定義は、実行を始めた時点で消える。飛ばした回は実行に数えない。

`type` と `conversationId` の組み合わせが誤っている場合と、`type` が `prompt` 以外で `settings` を指定した場合と、`settings` の未知の項目や server が受け付けない値の場合と、`schedule` の書式が誤っている場合は 400 を返す。
