全会話のイベントが 1 本に流れる。会話のイベント (`conversation.running`・`conversation.waiting`・`conversation.idle`・`conversation.updated`・`message.created`・`failure`) は `conversation` を持つ。承認のイベント (`approval.requested`・`approval.resolved`・`approval.rejected`) は `approval` を持ち、質問のイベント (`question.requested`・`question.resolved`・`question.rejected`) は `question` を持つ。どの会話のものかは `approval.conversation`・`question.conversation` で分かる。これは流した時点の会話の内容で、会話の最新の設定は `conversation.updated` で追う。client は `type` を確かめてから中身を読む。承認の要求と解決はここに流れる。`approval.requested` は `approval` を持つ。`approval.resolved` は許可されて、`approval.rejected` は許可されずに承認が消えたことを表し、どちらも消える直前の `approval` を持つ。`approval.rejected` は理由 `reason` と、拒否に付けた `comment` も持つ。答えは `POST /approvals/{id}/answer` で送り、取り直しは `GET /approvals` で行う。質問の要求と解決もここに流れる。`question.requested` は `question` を持つ。`question.resolved` は答えが出て、`question.rejected` は答えが出ずに質問が消えたことを表し、どちらも消える直前の `question` を持つ。`question.resolved` は確定した答え `answers` も持つ。`question.rejected` は理由 `reason` と、断るときに付けた `comment` も持つ。答えは `POST /questions/{id}/answer` で送り、取り直しは `GET /questions` で行う。

イベントの種別は data の `type` で表す。SSE の `event` フィールドは使わない。

会話の実行の状態は、専用のイベントで伝える。実行を始めた、または再開すると `conversation.running`、利用者の答えを待つと `conversation.waiting`、実行を終えると `conversation.idle` が流れる。待っている入力があるかどうかは含まない。`conversation.updated` は会話の設定が変わったときだけ流れ、状態が変わっても流れない。

承認を待つ間は `conversation.waiting` が流れる。許可 (`allow`・`allowAlways`) と `comment` 付きの拒否では実行が続き、`conversation.running` が流れる。`comment` の無い拒否と期限切れではその実行を終え、`conversation.idle` が流れる。質問を待つ間も `conversation.waiting` が流れる。`reply` と `decline` では実行が続き、`conversation.running` が流れる。期限切れではその実行を終え、`conversation.idle` が流れる。打ち切りでも実行は続かない。停止 (`POST /conversations/{id}/stop`) と実行の失敗では `conversation.idle` が流れる。削除では流れない。消した後に、その会話のイベントは流れない。実行が終わるたびに `conversation.idle` が流れ、待っている入力があれば、続けて `conversation.running` が流れる。`conversation.idle` が流れた時点が応答の区切りである。

AI の応答は、まとまり 1 件ごとに `message.created` で届く。断片では届かない。

実行が失敗すると `failure` が流れる。失敗の後も会話は続き、`conversation.idle` が流れる。承認を待っている間に失敗した場合、待っている承認は理由 `cancelled` の `approval.rejected` で、待っている質問は理由 `cancelled` の `question.rejected` で消える。

切断中のイベントは再送しない。接続した直後に、その時点の状態を流す。実行中の会話には `conversation.running`、承認や質問を待つ会話には `conversation.waiting`、待っている承認には `approval.requested`、待っている質問には `question.requested` を流す。流れなかった会話は idle とみなす。

イベントは追加のみで増える。client は未知の `type` を無視する。

認証は他の操作と同じく Authorization ヘッダだけで行う。token を query や cookie で渡す経路は無い。
