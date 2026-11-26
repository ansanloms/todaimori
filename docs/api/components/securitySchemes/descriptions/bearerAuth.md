`Authorization: Bearer <token>` で認証する。role は `user` と `agent` の 2 つで、token が role を決める。

`user` は利用者が動かす client (cli・discord 等) の role で、client ごとに固定の token を 1 つ持つ。サーバは token の SHA-256 ハッシュだけを保存する。`agent` は AI の role で、サーバが実行ごとに一時的な token を発行し、実行が終わると失効させる。agent の token で送った入力は、利用者の発言ではないと AI に伝わる。

リクエストの出どころはサーバが token から判断する。body に出どころは持たせない。

role は操作の `security` の scope の位置に書く。`security` を書かない操作は、どちらの role でも呼べる。`user` を要する操作に agent の token で呼ぶと 403 を返す。Authorization ヘッダが無い場合、Bearer 以外の方式の場合、token が不正または失効している場合は 401 を返す。サーバは認証と role の確認 (401・403) を、ID・body・資源の有無の確認 (400・404) より先に行う。
