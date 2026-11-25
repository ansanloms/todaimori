import assert from "node:assert/strict";
import { hash } from "node:crypto";
import { describe, test } from "node:test";
import { createTokenRegistry, parseUserTokens } from "../auth/tokens.ts";
import { createApp, definition } from "./app.ts";
import { checkImplemented } from "./contract.ts";
import { parseDefinition } from "./definition.ts";
import { errorWith } from "../test-helpers.ts";

const TOKEN = "user-token";
const app = createApp(
  createTokenRegistry(parseUserTokens(`cli=${hash("sha256", TOKEN, "hex")}`)),
);

describe("createApp", () => {
  test("GET /connection が token 付きで 200 と { apiVersion, role } を返すこと", async () => {
    const res = await app.request("/connection", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.deepStrictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), {
      apiVersion: definition.version,
      role: "user",
    });
  });

  test("GET /connection が token 無しで 401 の problem を返すこと", async () => {
    const res = await app.request("/connection");
    assert.deepStrictEqual(res.status, 401);
    assert.match(
      res.headers.get("content-type") ?? "",
      /^application\/problem\+json/,
    );
  });

  test("HEAD /connection が token 無しで 401、token 付きで 200 を返すこと", async () => {
    const denied = await app.request("/connection", { method: "HEAD" });
    assert.deepStrictEqual(denied.status, 401);
    const ok = await app.request("/connection", {
      method: "HEAD",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.deepStrictEqual(ok.status, 200);
  });

  test("security が不正な定義では、app を作る時点で例外を投げること", () => {
    const broken = parseDefinition({
      info: { version: "1.0.0" },
      paths: {
        "/connection": {
          get: {
            security: [{ bearerAuth: ["admin"] }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
      components: {},
    });
    assert.throws(
      () => createApp(createTokenRegistry([]), broken),
      errorWith(Error, "GET /connection: "),
    );
  });

  test("定義に無いパスへの GET が 404 の problem を返すこと", async () => {
    const res = await app.request("/nope");
    assert.deepStrictEqual(res.status, 404);
    assert.match(
      res.headers.get("content-type") ?? "",
      /^application\/problem\+json/,
    );
    assert.deepStrictEqual(await res.json(), {
      type: "about:blank",
      title: "Not Found",
      status: 404,
    });
  });

  test("定義と実装が過不足なく揃っていること", () => {
    assert.deepStrictEqual(checkImplemented(app, definition), {
      missing: [],
      extra: [],
    });
  });
});
