// bundle 済みの定義 (openapi.gen.json) と生成型を hono につなぐ薄い層。
import { readFileSync } from "node:fs";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Principal, TokenRegistry } from "../auth/tokens.ts";
import type { ResponseError } from "./generated/index.ts";

/** 認証を通った route の hono の Env。`secured` が `principal` を入れる。 */
export type AuthEnv = { Variables: { principal: Principal } };

type Doc = {
  info: { version: string };
  paths: Record<string, unknown>;
  security?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDoc(value: unknown): value is Doc {
  return (
    isRecord(value) &&
    isRecord(value.info) &&
    typeof value.info.version === "string" &&
    isRecord(value.paths) &&
    (value.security === undefined || Array.isArray(value.security))
  );
}

function loadDoc(): Doc {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL("./openapi.gen.json", import.meta.url), "utf8"),
  );
  if (!isDoc(parsed)) {
    throw new Error("openapi.gen.json: info.version と paths が無い");
  }
  return parsed;
}

const doc = loadDoc();

/** API 定義の版 (`info.version`)。 */
export const apiVersion: string = doc.info.version;

function findOperation(operationId: string): Record<string, unknown> {
  for (const item of Object.values(doc.paths)) {
    if (!isRecord(item)) {
      continue;
    }
    for (const op of Object.values(item)) {
      if (isRecord(op) && op.operationId === operationId) {
        return op;
      }
    }
  }
  throw new Error(`${operationId}: operation が無い`);
}

const ROLES: readonly string[] = ["user"];

/**
 * 有効な `security` の値から、呼べるロールの集合を引く。認証なし (空配列) は `undefined`。
 * `security` の要素は OR で、1 つの要素は `bearerAuth` のロールをちょうど 1 つ持つ。
 * 複数のロールを許すときは要素を分ける。
 * 空の要素・複数のロールを持つ要素・未知のロール・`bearerAuth` 以外のスキームは例外を投げる。
 */
export function parseAllowedRoles(
  operationId: string,
  security: unknown,
): Set<string> | undefined {
  if (!Array.isArray(security)) {
    throw new Error(`${operationId}: security が無い`);
  }
  if (security.length === 0) {
    return undefined;
  }
  const roles = new Set<string>();
  for (const requirement of security) {
    if (!isRecord(requirement)) {
      throw new Error(`${operationId}: security の要素がオブジェクトでない`);
    }
    const entries = Object.entries(requirement);
    if (entries.length === 0) {
      throw new Error(`${operationId}: security の要素が空`);
    }
    for (const [scheme, names] of entries) {
      if (scheme !== "bearerAuth") {
        throw new Error(`${operationId}: 未対応の security scheme: ${scheme}`);
      }
      if (!Array.isArray(names) || names.length === 0) {
        throw new Error(`${operationId}: bearerAuth のロールが空`);
      }
      if (names.length > 1) {
        throw new Error(
          `${operationId}: 1 つの security の要素に複数のロールがある`,
        );
      }
      const [name] = names;
      if (typeof name !== "string" || !ROLES.includes(name)) {
        throw new Error(`${operationId}: 未知のロール: ${String(name)}`);
      }
      roles.add(name);
    }
  }
  return roles;
}

/** operation の有効な `security` (operation のもの、無ければトップレベルのもの) から、呼べるロールの集合を引く。 */
function findAllowedRoles(operationId: string): Set<string> | undefined {
  const op = findOperation(operationId);
  return parseAllowedRoles(operationId, op.security ?? doc.security);
}

/** RFC 9457 の problem を `application/problem+json` で返す。 */
export function problem(
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  headers: Record<string, string> = {},
): Response {
  const body: ResponseError = { type: "about:blank", title, status };
  return c.json(body, status, {
    ...headers,
    "Content-Type": "application/problem+json",
  });
}

/**
 * hono の onError に渡す関数。hono 自身が投げる HTTPException も problem で返す。
 * それ以外の例外は 500 にし、例外を `console.error` に出す。
 */
export function handleError(err: Error, c: Context): Response {
  if (err instanceof HTTPException) {
    return problem(c, err.status as ContentfulStatusCode, err.message);
  }
  console.error(err);
  return problem(c, 500, "Internal Server Error");
}

const REALM = "todaimori";
const BEARER = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i;

/**
 * operationId の `security` を定義どおりに検査する hono のミドルウェア。
 * 認証なし (`security: []`) なら何もしない。
 * それ以外は Bearer token を `registry` で引き、ロールが `security` に無ければ 403 を返す。
 * 通ったら `c.get("principal")` で呼び出し元を読める。
 */
export function secured(
  registry: TokenRegistry,
  operationId: string,
): MiddlewareHandler<AuthEnv> {
  const roles = findAllowedRoles(operationId);
  if (roles === undefined) {
    return async (_c, next) => {
      await next();
    };
  }
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (header === undefined) {
      return problem(c, 401, "Unauthorized", {
        "WWW-Authenticate": `Bearer realm="${REALM}"`,
      });
    }
    const match = BEARER.exec(header);
    if (match === null) {
      return problem(c, 400, "Bad Request", {
        "WWW-Authenticate": 'Bearer error="invalid_request"',
      });
    }
    const principal = registry.resolve(match[1] ?? "");
    if (principal === undefined) {
      return problem(c, 401, "Unauthorized", {
        "WWW-Authenticate": 'Bearer error="invalid_token"',
      });
    }
    if (!roles.has(principal.role)) {
      return problem(c, 403, "Forbidden", {
        "WWW-Authenticate": 'Bearer error="insufficient_scope"',
      });
    }
    c.set("principal", principal);
    await next();
  };
}
