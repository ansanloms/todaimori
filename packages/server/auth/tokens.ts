import { hash, timingSafeEqual } from "node:crypto";

/** 呼び出し元。`source` は依頼の出所。 */
export type Principal = { role: "user"; source: string };

/** 利用者の token 1 件。`hash` は token の SHA-256 (小文字の hex)。 */
export type UserToken = { name: string; hash: string };

/** token の照合を持つ表。 */
export type TokenRegistry = {
  /** token から呼び出し元を引く。未知の token は `undefined`。 */
  resolve(token: string): Principal | undefined;
};

const SHA256_HEX = /^[0-9a-f]{64}$/i;

function sha256Hex(token: string): string {
  return hash("sha256", token, "hex");
}

/**
 * `TODAIMORI_USER_TOKENS` の値 (`名前=SHA-256 の hex` のカンマ区切り) を読む。
 * 未設定・空・書式不正 (名前が空、hex が 64 桁でない、名前の重複、ハッシュの重複) は例外を投げる。
 * 項目に token そのものが書かれている可能性があるので、message に項目の内容は入れず、位置 (1 始まり) だけを出す。
 */
export function parseUserTokens(value: string | undefined): UserToken[] {
  if (value === undefined || value.trim() === "") {
    throw new Error("TODAIMORI_USER_TOKENS が未設定または空");
  }
  const tokens: UserToken[] = [];
  const names = new Set<string>();
  const hashes = new Set<string>();
  for (const [index, entry] of value.split(",").entries()) {
    const position = index + 1;
    const item = entry.trim();
    const sep = item.lastIndexOf("=");
    const name = item.slice(0, Math.max(sep, 0)).trim();
    const digest = item
      .slice(sep + 1)
      .trim()
      .toLowerCase();
    if (sep < 0 || name === "") {
      throw new Error(
        `TODAIMORI_USER_TOKENS: ${position} 番目の項目が 名前=ハッシュ の形でない`,
      );
    }
    if (!SHA256_HEX.test(digest)) {
      throw new Error(
        `TODAIMORI_USER_TOKENS: ${position} 番目の項目のハッシュが 64 桁の hex でない`,
      );
    }
    if (names.has(name)) {
      throw new Error(
        `TODAIMORI_USER_TOKENS: ${position} 番目の項目の名前が重複している`,
      );
    }
    if (hashes.has(digest)) {
      throw new Error(
        `TODAIMORI_USER_TOKENS: ${position} 番目の項目のハッシュが重複している`,
      );
    }
    names.add(name);
    hashes.add(digest);
    tokens.push({ name, hash: digest });
  }
  return tokens;
}

/** 利用者の token の表を持つ registry を作る。 */
export function createTokenRegistry(userTokens: UserToken[]): TokenRegistry {
  return {
    resolve(token) {
      const given = Buffer.from(sha256Hex(token), "hex");
      let found: Principal | undefined;
      for (const user of userTokens) {
        if (timingSafeEqual(Buffer.from(user.hash, "hex"), given)) {
          found = { role: "user", source: `client:${user.name}` };
        }
      }
      return found;
    },
  };
}
