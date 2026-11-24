# todaimori

## 構成

- `docs/api`: API 定義である。独立した npm package で、workspace の外にある。
- `packages/server` (`@todaimori/server`): REST + SSE の server である。
- `packages/client/discord` (`@todaimori/discord-client`): discord の client である。

## 開発

`.node-version` の Node が要る。

- `npm ci`: 依存を入れる。
- `npm run check`: 型検査をする。
- `npm run lint`: oxlint と oxfmt の検査をする。
- `npm run fix`: oxlint の自動修正と oxfmt の整形をする。
- `npm test`: テストを実行する。
