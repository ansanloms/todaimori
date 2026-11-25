import assert from "node:assert/strict";
import { hash } from "node:crypto";
import { describe, mock, test } from "node:test";
import { Hono } from "hono";
import { createTokenRegistry, parseUserTokens } from "../auth/tokens.ts";
import { errorWith } from "../test-helpers.ts";
import {
  apiVersion,
  handleError,
  parseAllowedRoles,
  secured,
} from "./openapi.ts";
import type { AuthEnv } from "./openapi.ts";

const USER_TOKEN = "user-token";
const registry = createTokenRegistry(
  parseUserTokens(`cli=${hash("sha256", USER_TOKEN, "hex")}`),
);

function createTestApp(): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.onError(handleError);
  app.get("/connection", secured(registry, "getConnection"), (c) =>
    c.json({ source: c.get("principal").source }, 200),
  );
  app.get("/boom", () => {
    throw new Error("boom");
  });
  return app;
}

async function get(path: string, authorization?: string): Promise<Response> {
  return await createTestApp().request(path, {
    headers: authorization === undefined ? {} : { authorization },
  });
}

async function assertProblem(res: Response, status: number): Promise<void> {
  assert.match(
    res.headers.get("content-type") ?? "",
    /^application\/problem\+json/,
  );
  const body: unknown = await res.json();
  assert.ok(typeof body === "object" && body !== null);
  assert.ok("type" in body && body.type === "about:blank");
  assert.ok("title" in body && typeof body.title === "string");
  assert.ok("status" in body && body.status === status);
}

describe("apiVersion", () => {
  test("定義の info.version が入っていること", () => {
    assert.ok(apiVersion !== "");
  });
});

describe("handleError", () => {
  test("HTTPException 以外の例外は problem の 500 になり、例外を出力すること", async () => {
    const spy = mock.method(console, "error", () => {});
    try {
      const res = await get("/boom");
      assert.deepStrictEqual(res.status, 500);
      await assertProblem(res, 500);
      assert.deepStrictEqual(spy.mock.callCount(), 1);
    } finally {
      spy.mock.restore();
    }
  });
});

describe("secured", () => {
  test("Authorization ヘッダが無いと 401 と WWW-Authenticate を返すこと", async () => {
    const res = await get("/connection");
    assert.deepStrictEqual(res.status, 401);
    assert.deepStrictEqual(
      res.headers.get("www-authenticate"),
      'Bearer realm="todaimori"',
    );
    await assertProblem(res, 401);
  });

  test("形式が不正な Authorization ヘッダは 400 と invalid_request を返すこと", async () => {
    const res = await get("/connection", "Basic abc");
    assert.deepStrictEqual(res.status, 400);
    assert.deepStrictEqual(
      res.headers.get("www-authenticate"),
      'Bearer error="invalid_request"',
    );
    await assertProblem(res, 400);
  });

  test("scheme は大文字小文字を区別しないこと", async () => {
    for (const scheme of ["bearer", "BEARER"]) {
      const res = await get("/connection", `${scheme} ${USER_TOKEN}`);
      assert.deepStrictEqual(res.status, 200);
    }
  });

  test("未知の token は 401 と invalid_token を返すこと", async () => {
    const res = await get("/connection", "Bearer unknown");
    assert.deepStrictEqual(res.status, 401);
    assert.deepStrictEqual(
      res.headers.get("www-authenticate"),
      'Bearer error="invalid_token"',
    );
    await assertProblem(res, 401);
  });

  test("user の token は通り、出所を c.get(principal) で読めること", async () => {
    const res = await get("/connection", `Bearer ${USER_TOKEN}`);
    assert.deepStrictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { source: "client:cli" });
  });

  test("存在しない operationId は例外を投げること", () => {
    assert.throws(
      () => secured(registry, "noSuchOperation"),
      errorWith(Error, "operation が無い"),
    );
  });
});

describe("parseAllowedRoles", () => {
  test("空配列は認証なしとして undefined になること", () => {
    assert.deepStrictEqual(parseAllowedRoles("op", []), undefined);
  });

  test("1 ロールの要件はそのロールの集合になること", () => {
    assert.deepStrictEqual(
      parseAllowedRoles("op", [{ bearerAuth: ["user"] }]),
      new Set(["user"]),
    );
  });

  test("security が配列でないと例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles("op", undefined),
      errorWith(Error, "security が無い"),
    );
  });

  test("要素がオブジェクトでないと例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles("op", ["bearerAuth"]),
      errorWith(Error, "オブジェクトでない"),
    );
  });

  test("未知のロールは例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles("op", [{ bearerAuth: ["admin"] }]),
      errorWith(Error, "未知のロール"),
    );
  });

  test("空のロール配列は例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles("op", [{ bearerAuth: [] }]),
      errorWith(Error, "ロールが空"),
    );
  });

  test("bearerAuth 以外のスキームは例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles("op", [{ apiKey: [] }]),
      errorWith(Error, "未対応の security scheme"),
    );
  });

  test("空の要件 {} は例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles("op", [{}]),
      errorWith(Error, "要素が空"),
    );
  });

  test("1 つの要件に複数のロールを書くと例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles("op", [{ bearerAuth: ["user", "user"] }]),
      errorWith(Error, "複数のロール"),
    );
  });
});
