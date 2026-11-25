import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { Hono } from "hono";
import type { Authorize } from "./contract.ts";
import { checkImplemented, contract } from "./contract.ts";
import { parseDefinition } from "./definition.ts";
import type { Definition } from "./definition.ts";
import { errorWith } from "../test-helpers.ts";
import { handleError, input } from "./reply.ts";
import type { AppEnv } from "./reply.ts";

const problemSchema = {
  type: "object",
  required: ["type", "title", "status"],
  properties: {
    type: { type: "string" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
  },
};

function responses(omit: string[] = []): Record<string, unknown> {
  const all: Record<string, unknown> = {
    "200": {
      description: "ok",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Result" },
        },
      },
    },
    "400": {
      description: "bad",
      content: {
        "application/problem+json": {
          schema: { $ref: "#/components/schemas/Problem" },
        },
      },
    },
    "401": { description: "unauthorized" },
    "500": {
      description: "ng",
      content: {
        "application/problem+json": {
          schema: { $ref: "#/components/schemas/Problem" },
        },
      },
    },
  };
  return Object.fromEntries(
    Object.entries(all).filter(([status]) => !omit.includes(status)),
  );
}

/** `omit` の status を持たない応答で、定義を組む。 */
function buildDefinition(omit: string[] = []) {
  return {
    info: { version: "1.2.3" },
    security: [{ bearerAuth: ["user"] }],
    paths: {
      "/threads/{threadId}/turns": {
        parameters: [
          {
            name: "threadId",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 1 },
          },
        ],
        post: {
          security: [],
          parameters: [
            { name: "dryRun", in: "query", schema: { type: "boolean" } },
            {
              name: "limit",
              in: "query",
              required: true,
              schema: { type: "integer" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Turn" },
              },
            },
          },
          responses: responses(omit),
        },
      },
      "/ping": { get: { responses: responses(omit) } },
      "/stream": {
        get: {
          security: [],
          responses: {
            "200": {
              description: "sse",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
          },
        },
      },
      "/unimplemented": { get: { security: [], responses: responses(omit) } },
    },
    components: {
      schemas: {
        Problem: problemSchema,
        Result: {
          type: "object",
          required: ["ok"],
          properties: { ok: { type: "boolean" } },
        },
        Turn: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: { text: { type: "string" } },
        },
      },
    },
  };
}

const definition = parseDefinition(buildDefinition());

type Captured = { input?: unknown; security?: readonly unknown[] };

function createTestApp(
  authorize?: Authorize,
  def: Definition = definition,
): {
  app: Hono<AppEnv>;
  captured: Captured;
} {
  const captured: Captured = {};
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(
    "*",
    contract(def, {
      authorize:
        authorize ??
        ((_c, security) => {
          captured.security = security;
          return undefined;
        }),
    }),
  );
  app.post("/threads/:threadId/turns", async (c) => {
    captured.input = input(c);
    // body を handler 側でも読めること。
    const body: unknown = await c.req.json();
    return c.json({ ok: body !== undefined }, 200);
  });
  app.get("/ping", (c) => c.json({ ok: true }, 200));
  app.get("/stream", (c) =>
    c.body("data: 1\n\n", 200, { "Content-Type": "text/event-stream" }),
  );
  app.get("/undocumented-status", (c) => c.json({ ok: true }, 200));
  return { app, captured };
}

async function post(
  app: Hono<AppEnv>,
  path: string,
  body: string | undefined,
): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function silently<T>(run: () => Promise<T>): Promise<T> {
  const spy = mock.method(console, "error", () => {});
  try {
    return await run();
  } finally {
    spy.mock.restore();
  }
}

async function detailOf(res: Response): Promise<string> {
  const body: unknown = await res.json();
  assert.ok(typeof body === "object" && body !== null && "detail" in body);
  assert.ok(typeof body.detail === "string");
  return body.detail;
}

const GOOD = "/threads/3/turns?limit=10";

describe("parseDefinition", () => {
  test("info.version・paths・components が無いと例外を投げること", () => {
    for (const doc of [
      null,
      {},
      { info: { version: "1" }, paths: {} },
      { info: { version: "1" }, components: {} },
      { info: {}, paths: {}, components: {} },
    ]) {
      assert.throws(() => parseDefinition(doc), errorWith(Error, "定義に"));
    }
  });

  test("operation を「メソッド + Hono の path」で引けること", () => {
    assert.ok(definition.operations.has("POST /threads/:threadId/turns"));
    assert.ok(definition.operations.has("GET /ping"));
    assert.deepStrictEqual(definition.version, "1.2.3");
  });

  test("operation の security が無ければ root のものを使うこと", () => {
    assert.deepStrictEqual(definition.operations.get("GET /ping")?.security, [
      { bearerAuth: ["user"] },
    ]);
    assert.deepStrictEqual(
      definition.operations.get("POST /threads/:threadId/turns")?.security,
      [],
    );
  });
});

describe("contract (入力)", () => {
  test("正常な入力は検証・変換され、handler が input で読めること", async () => {
    const { app, captured } = createTestApp();
    const res = await post(
      app,
      "/threads/3/turns?limit=10&dryRun=true",
      JSON.stringify({ text: "hi" }),
    );
    assert.deepStrictEqual(res.status, 200);
    assert.deepStrictEqual(captured.input, {
      path: { threadId: 3 },
      query: { limit: 10, dryRun: true },
      body: { text: "hi" },
    });
  });

  test("query の true / false が真偽値に変換されること", async () => {
    for (const [raw, expected] of [
      ["true", true],
      ["false", false],
    ] as const) {
      const { app, captured } = createTestApp();
      const res = await post(
        app,
        `${GOOD}&dryRun=${raw}`,
        JSON.stringify({ text: "hi" }),
      );
      assert.deepStrictEqual(res.status, 200);
      assert.deepStrictEqual(
        (captured.input as { query: { dryRun: boolean } }).query.dryRun,
        expected,
      );
    }
  });

  test("boolean に変換できない query は 400 になること", async () => {
    const { app } = createTestApp();
    const res = await post(
      app,
      `${GOOD}&dryRun=yes`,
      JSON.stringify({ text: "hi" }),
    );
    assert.deepStrictEqual(res.status, 400);
    assert.match(await detailOf(res), /query dryRun/);
  });

  test("必須の query の欠落は 400 になること", async () => {
    const { app } = createTestApp();
    const res = await post(
      app,
      "/threads/3/turns",
      JSON.stringify({ text: "hi" }),
    );
    assert.deepStrictEqual(res.status, 400);
    assert.match(
      res.headers.get("content-type") ?? "",
      /^application\/problem\+json/,
    );
    assert.match(await detailOf(res), /query limit/);
  });

  test("型の合わない path の引数は 400 になること", async () => {
    const { app } = createTestApp();
    const res = await post(
      app,
      "/threads/abc/turns?limit=1",
      JSON.stringify({ text: "hi" }),
    );
    assert.deepStrictEqual(res.status, 400);
    assert.match(await detailOf(res), /path threadId/);
  });

  test("schema の制約に合わない path の引数は 400 になること", async () => {
    const { app } = createTestApp();
    const res = await post(
      app,
      "/threads/0/turns?limit=1",
      JSON.stringify({ text: "hi" }),
    );
    assert.deepStrictEqual(res.status, 400);
  });

  test("body の必須項目の欠落は 400 になること", async () => {
    const { app } = createTestApp();
    const res = await post(app, GOOD, JSON.stringify({}));
    assert.deepStrictEqual(res.status, 400);
    assert.match(await detailOf(res), /^body /);
  });

  test("body の型の不一致は 400 になること", async () => {
    const { app } = createTestApp();
    const res = await post(app, GOOD, JSON.stringify({ text: 1 }));
    assert.deepStrictEqual(res.status, 400);
    assert.match(await detailOf(res), /\/text/);
  });

  test("additionalProperties: false に反する body は 400 になること", async () => {
    const { app } = createTestApp();
    const res = await post(
      app,
      GOOD,
      JSON.stringify({ text: "hi", extra: true }),
    );
    assert.deepStrictEqual(res.status, 400);
  });

  test("壊れた JSON の body は 400 になること", async () => {
    const { app } = createTestApp();
    const res = await post(app, GOOD, "{not json");
    assert.deepStrictEqual(res.status, 400);
    assert.match(await detailOf(res), /JSON として不正/);
  });

  test("必須の body が無いと 400 になること", async () => {
    const { app } = createTestApp();
    const res = await post(app, GOOD, undefined);
    assert.deepStrictEqual(res.status, 400);
    assert.match(await detailOf(res), /body: 必須/);
  });

  test("integer の path・query は 10 進の表記だけを数値に変換すること", async () => {
    for (const raw of ["0x10", "1e3", "%20", "%205"]) {
      const { app } = createTestApp();
      const res = await post(
        app,
        `/threads/3/turns?limit=${raw}`,
        JSON.stringify({ text: "hi" }),
      );
      assert.deepStrictEqual(res.status, 400, raw);
    }
    for (const raw of ["5", "-5"]) {
      const { app, captured } = createTestApp();
      const res = await post(
        app,
        `/threads/3/turns?limit=${raw}`,
        JSON.stringify({ text: "hi" }),
      );
      assert.deepStrictEqual(res.status, 200, raw);
      assert.deepStrictEqual(
        (captured.input as { query: { limit: number } }).query.limit,
        Number(raw),
      );
    }
  });

  test("number の query は小数の 10 進表記を数値に変換し、16 進・指数・空白は 400 になること", async () => {
    const raw = buildDefinition();
    const op = (raw.paths["/ping"] as { get: { parameters?: unknown[] } }).get;
    op.parameters = [
      {
        name: "ratio",
        in: "query",
        required: true,
        schema: { type: "number" },
      },
    ];
    const def = parseDefinition(raw);
    const make = (): Hono<AppEnv> => {
      const app = new Hono<AppEnv>();
      app.onError(handleError);
      app.use("*", contract(def, { authorize: () => undefined }));
      app.get("/ping", (c) => c.json({ ok: true }, 200));
      return app;
    };
    for (const [value, status] of [
      ["1.5", 200],
      ["-5", 200],
      ["0x10", 400],
      ["1e3", 400],
      ["%20", 400],
      ["%201", 400],
    ] as const) {
      const res = await make().request(`/ping?ratio=${value}`);
      assert.deepStrictEqual(res.status, status, value);
    }
  });

  test("Content-Type が JSON でない body は 400 になること", async () => {
    const { app } = createTestApp();
    const res = await app.request(GOOD, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ text: "hi" }),
    });
    assert.deepStrictEqual(res.status, 400);
    assert.match(await detailOf(res), /Content-Type/);
  });

  test("パラメータ付き・大文字小文字違いの JSON の Content-Type は通ること", async () => {
    for (const type of [
      "application/json",
      "application/json; charset=utf-8",
      "Application/JSON",
    ]) {
      const { app } = createTestApp();
      const res = await app.request(GOOD, {
        method: "POST",
        headers: { "content-type": type },
        body: JSON.stringify({ text: "hi" }),
      });
      assert.deepStrictEqual(res.status, 200, type);
    }
  });

  test("定義に無い +json の Content-Type は 400 になること", async () => {
    const { app } = createTestApp();
    const res = await app.request(GOOD, {
      method: "POST",
      headers: { "content-type": "application/merge-patch+json" },
      body: JSON.stringify({ text: "hi" }),
    });
    assert.deepStrictEqual(res.status, 400);
    assert.match(await detailOf(res), /定義に無い media type/);
  });

  test("integer の query が安全な整数を超えると 400 になること", async () => {
    for (const [raw, status] of [
      ["9007199254740993", 400],
      ["9007199254740991", 200],
      ["1.5", 400],
    ] as const) {
      const { app } = createTestApp();
      const res = await post(
        app,
        `/threads/3/turns?limit=${raw}`,
        JSON.stringify({ text: "hi" }),
      );
      assert.deepStrictEqual(res.status, status, raw);
    }
  });

  test("定義に無い route は素通しになること", async () => {
    const { app } = createTestApp();
    const res = await app.request("/nope");
    assert.deepStrictEqual(res.status, 404);
    const undocumented = await app.request("/undocumented-status");
    assert.deepStrictEqual(undocumented.status, 200);
  });
});

describe("contract (認証)", () => {
  test("security が空でなければ authorize に有効な security を渡すこと", async () => {
    const { app, captured } = createTestApp();
    const res = await app.request("/ping");
    assert.deepStrictEqual(res.status, 200);
    assert.deepStrictEqual(captured.security, [{ bearerAuth: ["user"] }]);
  });

  test("security が空なら authorize を呼ばないこと", async () => {
    const calls: unknown[] = [];
    const { app } = createTestApp((_c, security) => {
      calls.push(security);
      return undefined;
    });
    await post(app, GOOD, JSON.stringify({ text: "hi" }));
    assert.deepStrictEqual(calls, []);
  });

  test("HEAD は GET の operation として認証と検証が掛かること", async () => {
    const { app, captured } = createTestApp();
    const res = await app.request("/ping", { method: "HEAD" });
    assert.deepStrictEqual(res.status, 200);
    assert.deepStrictEqual(captured.security, [{ bearerAuth: ["user"] }]);
    const denied = createTestApp((c) => c.body(null, 401) as Response).app;
    assert.deepStrictEqual(
      (await denied.request("/ping", { method: "HEAD" })).status,
      401,
    );
  });

  test("authorize が応答を返したら入力の検証と handler に進まないこと", async () => {
    const { app, captured } = createTestApp(
      (c) => c.body(null, 401) as Response,
    );
    const res = await app.request("/ping");
    assert.deepStrictEqual(res.status, 401);
    assert.deepStrictEqual(captured.input, undefined);
  });
});

describe("contract (応答)", () => {
  function appWith(
    handler: (c: import("hono").Context<AppEnv>) => Response,
  ): Hono<AppEnv> {
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.use("*", contract(definition, { authorize: () => undefined }));
    app.get("/ping", handler);
    app.get("/stream", handler);
    return app;
  }

  async function withSpy<T>(
    run: () => Promise<T>,
  ): Promise<{ result: T; calls: number }> {
    const spy = mock.method(console, "error", () => {});
    try {
      const result = await run();
      return { result, calls: spy.mock.callCount() };
    } finally {
      spy.mock.restore();
    }
  }

  test("定義に無い status は 500 の problem になり、ずれを出力すること", async () => {
    const app = appWith((c) => c.json({ ok: true }, 202));
    const { result: res, calls } = await withSpy(
      async () => await app.request("/ping"),
    );
    assert.deepStrictEqual(res.status, 500);
    assert.match(
      res.headers.get("content-type") ?? "",
      /^application\/problem\+json/,
    );
    assert.deepStrictEqual(await res.json(), {
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
    });
    assert.deepStrictEqual(calls, 1);
  });

  test("HEAD の応答が定義と合わないとき、ログに HEAD と GET の定義であることが出ること", async () => {
    const app = appWith((c) => c.json({ ok: true }, 202));
    const spy = mock.method(console, "error", () => {});
    try {
      const res = await app.request("/ping", { method: "HEAD" });
      assert.deepStrictEqual(res.status, 500);
      assert.deepStrictEqual(spy.mock.callCount(), 1);
      const message = String(spy.mock.calls[0]?.arguments[0]);
      assert.match(message, /^HEAD \/ping \(GET の定義\)/);
    } finally {
      spy.mock.restore();
    }
  });

  test("形の違う body は 500 の problem になること", async () => {
    const app = appWith((c) => c.json({ ok: "yes" }, 200));
    const { result: res, calls } = await withSpy(
      async () => await app.request("/ping"),
    );
    assert.deepStrictEqual(res.status, 500);
    assert.deepStrictEqual(calls, 1);
  });

  test("handler が例外を投げても、onError の 500 は定義と合って通ること", async () => {
    const app = appWith(() => {
      throw new Error("boom");
    });
    const { result: res } = await withSpy(
      async () => await app.request("/ping"),
    );
    assert.deepStrictEqual(res.status, 500);
    assert.deepStrictEqual(
      ((await res.json()) as { title: string }).title,
      "Internal Server Error",
    );
  });

  test("定義に合う応答はそのまま通ること", async () => {
    const app = appWith((c) => c.json({ ok: true }, 200));
    const res = await app.request("/ping");
    assert.deepStrictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true });
  });

  test("定義に無い media type は、status が合っても 500 になること", async () => {
    const app = appWith((c) =>
      c.body(JSON.stringify({ ok: true }), 200, {
        "Content-Type": "application/problem+json",
      }),
    );
    const { result: res, calls } = await withSpy(
      async () => await app.request("/ping"),
    );
    assert.deepStrictEqual(res.status, 500);
    assert.deepStrictEqual(calls, 1);
  });

  test("定義にある JSON 以外の media type は、body を検証せず通ること", async () => {
    const app = appWith((c) =>
      c.body("data: 1\n\n", 200, { "Content-Type": "text/event-stream" }),
    );
    const res = await app.request("/stream");
    assert.deepStrictEqual(res.status, 200);
    assert.deepStrictEqual(await res.text(), "data: 1\n\n");
  });
});

describe("contract (middleware の応答の検証)", () => {
  const unauthorized: Authorize = (c) => c.body(null, 401) as Response;

  test("入力の定義に 400 が無ければ、不正な入力は 500 になること", async () => {
    const { app } = createTestApp(
      undefined,
      parseDefinition(buildDefinition(["400"])),
    );
    const res = await silently(
      async () => await post(app, "/threads/3/turns", JSON.stringify({})),
    );
    assert.deepStrictEqual(res.status, 500);
  });

  test("入力の定義に 400 があれば、400 のまま返ること", async () => {
    const { app } = createTestApp();
    const res = await post(app, "/threads/3/turns", JSON.stringify({}));
    assert.deepStrictEqual(res.status, 400);
  });

  test("認証の 401 が定義にあればそのまま返り、無ければ 500 になること", async () => {
    const ok = createTestApp(unauthorized).app;
    assert.deepStrictEqual((await ok.request("/ping")).status, 401);
    const ng = createTestApp(
      unauthorized,
      parseDefinition(buildDefinition(["401"])),
    ).app;
    const res = await silently(async () => await ng.request("/ping"));
    assert.deepStrictEqual(res.status, 500);
  });

  test("500 が定義に無くても、差し替えを繰り返さず 500 を返し、出力は 1 回であること", async () => {
    const { app } = createTestApp(
      undefined,
      parseDefinition(buildDefinition(["400", "500"])),
    );
    const spy = mock.method(console, "error", () => {});
    try {
      const res = await post(app, "/threads/3/turns", JSON.stringify({}));
      assert.deepStrictEqual(res.status, 500);
      assert.deepStrictEqual(spy.mock.callCount(), 1);
    } finally {
      spy.mock.restore();
    }
  });
});

describe("checkImplemented", () => {
  test("未実装の operation と、定義に無い route の両方を検出すること", () => {
    const { app } = createTestApp();
    assert.deepStrictEqual(checkImplemented(app, definition), {
      missing: ["GET /unimplemented"],
      extra: ["GET /undocumented-status"],
    });
  });

  test("middleware (ALL) は突き合わせの対象にしないこと", () => {
    const app = new Hono();
    app.use("*", async (_c, next) => {
      await next();
    });
    const result = checkImplemented(app, definition);
    assert.deepStrictEqual(result.extra, []);
  });
});
