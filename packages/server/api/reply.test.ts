import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { Hono } from "hono";
import type {
  GetConnectionResponses,
  ResponseError,
} from "./generated/types/index.ts";
import { handleError, problem, requirePrincipal, send } from "./reply.ts";
import type { AppEnv } from "./reply.ts";

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

describe("send", () => {
  test("2xx は application/json、それ以外は application/problem+json で返すこと", async () => {
    const app = new Hono();
    app.get("/ok", (c) =>
      send<GetConnectionResponses>(c, {
        status: "200",
        body: { apiVersion: "1", role: "user" },
      }),
    );
    app.get("/ng", (c) =>
      send<GetConnectionResponses>(c, {
        status: "401",
        body: { type: "about:blank", title: "Unauthorized", status: 401 },
      }),
    );
    const ok = await app.request("/ok");
    assert.deepStrictEqual(ok.status, 200);
    assert.match(ok.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepStrictEqual(await ok.json(), { apiVersion: "1", role: "user" });
    const ng = await app.request("/ng");
    assert.deepStrictEqual(ng.status, 401);
    await assertProblem(ng, 401);
  });

  test("定義に無い status と、その status の型に合わない body が型エラーになること", () => {
    const app = new Hono();
    app.get("/type-check", (c) => {
      // @ts-expect-error 定義に無い status
      send<GetConnectionResponses>(c, { status: "404", body: {} });
      // @ts-expect-error status 200 の型に合わない body
      send<GetConnectionResponses>(c, { status: "200", body: { nope: 1 } });
      const error: ResponseError = {
        type: "about:blank",
        title: "x",
        status: 200,
      };
      // @ts-expect-error status 200 の body に problem は渡せない
      send<GetConnectionResponses>(c, { status: "200", body: error });
      return c.body(null);
    });
  });
});

describe("requirePrincipal", () => {
  test("principal が無いと例外を投げ、あれば返すこと", async () => {
    const app = new Hono<AppEnv>();
    let thrown: unknown;
    app.get("/none", (c) => {
      try {
        requirePrincipal(c);
      } catch (err) {
        thrown = err;
      }
      return c.body(null);
    });
    app.get("/some", (c) => {
      c.set("principal", { role: "user", source: "x" } as never);
      return c.json({ role: requirePrincipal(c).role });
    });
    await app.request("/none");
    assert.ok(thrown instanceof Error);
    assert.match(thrown.message, /principal が無い/);
    const res = await app.request("/some");
    assert.deepStrictEqual(await res.json(), { role: "user" });
  });
});

describe("problem", () => {
  test("detail と追加のヘッダを含めて problem を返すこと", async () => {
    const app = new Hono();
    app.get("/", (c) => problem(c, 400, "Bad Request", "理由", { "X-A": "b" }));
    const res = await app.request("/");
    assert.deepStrictEqual(res.status, 400);
    assert.deepStrictEqual(res.headers.get("x-a"), "b");
    assert.deepStrictEqual(await res.json(), {
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: "理由",
    });
  });
});

describe("handleError", () => {
  test("HTTPException 以外の例外は problem の 500 になり、例外を出力すること", async () => {
    const spy = mock.method(console, "error", () => {});
    try {
      const app = new Hono();
      app.onError(handleError);
      app.get("/boom", () => {
        throw new Error("boom");
      });
      const res = await app.request("/boom");
      assert.deepStrictEqual(res.status, 500);
      await assertProblem(res, 500);
      assert.deepStrictEqual(spy.mock.callCount(), 1);
    } finally {
      spy.mock.restore();
    }
  });
});
