// 定義の `security` を検査する。token の照合は `auth/tokens.ts` の registry に任せる。
import type { Context } from "hono";
import type { TokenRegistry } from "../auth/tokens.ts";
import type { Authorize } from "./contract.ts";
import type { Definition } from "./definition.ts";
import { problem } from "./reply.ts";
import type { AppEnv } from "./reply.ts";

const REALM = "todaimori";
const BEARER = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i;
const ROLES: readonly string[] = ["user"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 有効な `security` の値から、呼べるロールの集合を引く。認証なし (空配列) は `undefined`。
 * `security` の要素は OR で、1 つの要素は `bearerAuth` のロールをちょうど 1 つ持つ。
 * 複数のロールを許すときは要素を分ける。
 * 空の要素・複数のロールを持つ要素・未知のロール・`bearerAuth` 以外のスキームは例外を投げる。
 */
export function parseAllowedRoles(security: unknown): Set<string> | undefined {
  if (!Array.isArray(security)) {
    throw new Error("security が無い");
  }
  if (security.length === 0) {
    return undefined;
  }
  const roles = new Set<string>();
  for (const requirement of security) {
    if (!isRecord(requirement)) {
      throw new Error("security の要素がオブジェクトでない");
    }
    const entries = Object.entries(requirement);
    if (entries.length === 0) {
      throw new Error("security の要素が空");
    }
    for (const [scheme, names] of entries) {
      if (scheme !== "bearerAuth") {
        throw new Error(`未対応の security scheme: ${scheme}`);
      }
      if (!Array.isArray(names) || names.length === 0) {
        throw new Error("bearerAuth のロールが空");
      }
      if (names.length > 1) {
        throw new Error("1 つの security の要素に複数のロールがある");
      }
      const [name] = names;
      if (typeof name !== "string" || !ROLES.includes(name)) {
        throw new Error(`未知のロール: ${String(name)}`);
      }
      roles.add(name);
    }
  }
  return roles;
}

/** 定義の全 operation の `security` を検査する。不正なら、operation を添えた例外を投げる。 */
export function assertValidSecurity(definition: Definition): void {
  for (const [key, op] of definition.operations) {
    try {
      parseAllowedRoles(op.security);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`${key}: ${reason}`, { cause: err });
    }
  }
}

/**
 * `contract` に渡す認証のコールバックを作る。
 * Bearer token を `registry` で引き、ロールが `security` に無ければ 403 を返す。
 * 通ったら `c.get("principal")` で呼び出し元を読める。
 * `security` の解析結果は `security` の配列ごとに持ち、リクエストごとにやり直さない。
 */
export function authorize(registry: TokenRegistry): Authorize {
  const parsed = new WeakMap<object, Set<string> | undefined>();
  const rolesOf = (security: readonly unknown[]): Set<string> | undefined => {
    if (!parsed.has(security)) {
      parsed.set(security, parseAllowedRoles(security));
    }
    return parsed.get(security);
  };

  return (c: Context<AppEnv>, security) => {
    const roles = rolesOf(security);
    if (roles === undefined) {
      return undefined;
    }
    const header = c.req.header("Authorization");
    if (header === undefined) {
      return problem(c, 401, "Unauthorized", undefined, {
        "WWW-Authenticate": `Bearer realm="${REALM}"`,
      });
    }
    const match = BEARER.exec(header);
    if (match === null) {
      return problem(c, 400, "Bad Request", undefined, {
        "WWW-Authenticate": 'Bearer error="invalid_request"',
      });
    }
    const principal = registry.resolve(match[1] ?? "");
    if (principal === undefined) {
      return problem(c, 401, "Unauthorized", undefined, {
        "WWW-Authenticate": 'Bearer error="invalid_token"',
      });
    }
    if (!roles.has(principal.role)) {
      return problem(c, 403, "Forbidden", undefined, {
        "WWW-Authenticate": 'Bearer error="insufficient_scope"',
      });
    }
    c.set("principal", principal);
    return undefined;
  };
}
