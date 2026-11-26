全会話のイベントが 1 本に流れる。会話のイベントは `conversation` を持つ。承認のイベント (`approval.requested`・`approval.resolved`・`approval.rejected`) は `conversation` ではなく `approval` を持つ。client は `type` を確かめてから中身を読む。承認の要求と解決はここに流れる。`approval.requested` は `approval` を持つ。`approval.resolved` は許可されて、`approval.rejected` は許可されずに承認が消えたことを表し、どちらも消える直前の `approval` を持つ。`approval.rejected` は理由 `reason` と、拒否に付けた `comment` も持つ。答えは `POST /approvals/{id}/answer` で送り、取り直しは `GET /approvals` で行う。質問を将来足す場合も、同じ形にする。

イベントの種別は data の `type` で表す。SSE の `event` フィールドは使わない。

会話が実行中かどうかは `conversation` の `status` で分かる。`running` は実行している状態、`idle` は実行していない状態、`waiting` は利用者の答えを待っている状態である。待っている入力があるかどうかは含まない。状態が変わると `conversation.updated` が流れる。会話の設定が変わったときも流れる。

承認を待つ間は `status` が `waiting` になる。許可 (`allow`・`allowAlways`) と `comment` 付きの拒否では実行が続き、`status` は `running` に戻る。`comment` の無い拒否と期限切れではその実行を終え、`status` は `idle` になる。打ち切り (停止・削除・実行の失敗) でも実行は続かない。実行が終わるたびに `status` は `idle` になる。待っている入力があれば、続けて `running` に戻る。`idle` になった時点が応答の区切りである。

AI の応答は、まとまり 1 件ごとに `message.created` で届く。断片では届かない。

実行が失敗すると `failure` が流れる。失敗の後も会話は続き、`status` は `idle` になる。承認を待っている間に失敗した場合、待っている承認は理由 `cancelled` の `approval.rejected` で消える。

切断中のイベントは再送しない。

イベントは追加のみで増える。client は未知の `type` を無視する。
