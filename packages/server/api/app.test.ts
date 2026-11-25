import assert from "node:assert/strict";
import { hash } from "node:crypto";
import { describe, test } from "node:test";
import { createTokenRegistry, parseUserTokens } from "../auth/tokens.ts";
import { createApp } from "./app.ts";
import { apiVersion } from "./openapi.ts";

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
    assert.deepStrictEqual(await res.json(), { apiVersion, role: "user" });
  });

  test("GET /connection が token 無しで 401 の problem を返すこと", async () => {
    const res = await app.request("/connection");
    assert.deepStrictEqual(res.status, 401);
    assert.match(
      res.headers.get("content-type") ?? "",
      /^application\/problem\+json/,
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
});
