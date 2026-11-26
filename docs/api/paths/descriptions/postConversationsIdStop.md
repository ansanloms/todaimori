その会話の実行を中断し、待っている入力をすべて捨てる。文脈は残す。待っている承認は打ち切り、理由 `cancelled` の `approval.rejected` を流す。実行を止めると `conversation.idle` が流れる。

何も実行していなくても 204 を返す。
