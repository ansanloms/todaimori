import assert from "node:assert/strict";
import { hash } from "node:crypto";
import { describe, mock, test } from "node:test";
import { Hono } from "hono";
import { createTokenRegistry, parseUserTokens } from "../auth/tokens.ts";
import { errorWith } from "../test-helpers.ts";
import { assertValidSecurity, authorize, parseAllowedRoles } from "./auth.ts";
import { contract } from "./contract.ts";
import { parseDefinition } from "./definition.ts";
import { handleError, send } from "./reply.ts";
import type { AppEnv } from "./reply.ts";

const USER_TOKEN = "user-token";
const registry = createTokenRegistry(
  parseUserTokens(`cli=${hash("sha256", USER_TOKEN, "hex")}`),
);

function operation(security: unknown): unknown {
  return {
    responses: {
      "200": { description: "ok" },
      "400": { description: "bad" },
      "401": { description: "unauthorized" },
    },
    ...(security === undefined ? {} : { security }),
  };
}

function createTestApp(security: unknown): Hono<AppEnv> {
  const definition = parseDefinition({
    info: { version: "1.0.0" },
    security: [{ bearerAuth: ["user"] }],
    paths: {
      "/connection": { get: operation(security) },
      "/open": { get: operation([]) },
    },
    components: {},
  });
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use("*", contract(definition, { authorize: authorize(registry) }));
  app.get("/connection", (c) =>
    c.json({ source: c.get("principal")?.source ?? null }, 200),
  );
  app.get("/open", (c) =>
    send<{ "200": unknown }>(c, { status: "200", body: {} }),
  );
  return app;
}

async function get(
  path: string,
  authorization?: string,
  security?: unknown,
): Promise<Response> {
  return await createTestApp(security).request(path, {
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

describe("authorize", () => {
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

  test("認証なし (security が空) の route は token 無しで通ること", async () => {
    const res = await get("/open");
    assert.deepStrictEqual(res.status, 200);
  });

  test("operation の security が root の security より優先されること", async () => {
    const res = await get("/connection", undefined, []);
    assert.deepStrictEqual(res.status, 200);
  });

  test("ロールが security に無い呼び出し元は 403 と insufficient_scope を返すこと", async () => {
    const callback = authorize({
      resolve: () => ({ role: "admin", source: "x" }) as never,
    });
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      const res = await callback(c, [{ bearerAuth: ["user"] }]);
      if (res !== undefined) {
        return res;
      }
      await next();
    });
    const res = await app.request("/", {
      headers: { authorization: "Bearer x" },
    });
    assert.deepStrictEqual(res.status, 403);
    assert.deepStrictEqual(
      res.headers.get("www-authenticate"),
      'Bearer error="insufficient_scope"',
    );
    await assertProblem(res, 403);
  });

  test("不正な security は例外を投げ、500 になること", async () => {
    const spy = mock.method(console, "error", () => {});
    try {
      const res = await get("/connection", `Bearer ${USER_TOKEN}`, [
        { bearerAuth: ["admin"] },
      ]);
      assert.deepStrictEqual(res.status, 500);
    } finally {
      spy.mock.restore();
    }
  });
});

describe("parseAllowedRoles", () => {
  test("空配列は認証なしとして undefined になること", () => {
    assert.deepStrictEqual(parseAllowedRoles([]), undefined);
  });

  test("1 ロールの要件はそのロールの集合になること", () => {
    assert.deepStrictEqual(
      parseAllowedRoles([{ bearerAuth: ["user"] }]),
      new Set(["user"]),
    );
  });

  test("security が配列でないと例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles(undefined),
      errorWith(Error, "security が無い"),
    );
  });

  test("要素がオブジェクトでないと例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles(["bearerAuth"]),
      errorWith(Error, "オブジェクトでない"),
    );
  });

  test("未知のロールは例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles([{ bearerAuth: ["admin"] }]),
      errorWith(Error, "未知のロール"),
    );
  });

  test("空のロール配列は例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles([{ bearerAuth: [] }]),
      errorWith(Error, "ロールが空"),
    );
  });

  test("bearerAuth 以外のスキームは例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles([{ apiKey: [] }]),
      errorWith(Error, "未対応の security scheme"),
    );
  });

  test("空の要件 {} は例外を投げること", () => {
    assert.throws(() => parseAllowedRoles([{}]), errorWith(Error, "要素が空"));
  });

  test("1 つの要件に複数のロールを書くと例外を投げること", () => {
    assert.throws(
      () => parseAllowedRoles([{ bearerAuth: ["user", "user"] }]),
      errorWith(Error, "複数のロール"),
    );
  });
});

describe("assertValidSecurity", () => {
  function definitionWith(
    security: unknown,
  ): ReturnType<typeof parseDefinition> {
    return parseDefinition({
      info: { version: "1.0.0" },
      paths: { "/connection": { get: operation(security) } },
      components: {},
    });
  }

  test("不正な security を持つ operation があると、operation を添えた例外を投げること", () => {
    for (const security of [
      [{ bearerAuth: ["admin"] }],
      [{ apiKey: [] }],
      [{}],
    ]) {
      assert.throws(
        () => assertValidSecurity(definitionWith(security)),
        errorWith(Error, "GET /connection: "),
      );
    }
  });

  test("有効な security は通ること", () => {
    assertValidSecurity(definitionWith([{ bearerAuth: ["user"] }]));
    assertValidSecurity(definitionWith([]));
  });
});
