import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ApiError, checkConnection } from "./connection.ts";

const BASE_URL = "http://127.0.0.1:3000";

describe("checkConnection", () => {
  test("200 のとき { apiVersion, role } を返し、Bearer token を送ること", async () => {
    let seen: { url: string; authorization: string | null } | undefined;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      seen = {
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      };
      return Response.json({ apiVersion: "0.0.1", role: "user" });
    };
    const result = await checkConnection({
      baseUrl: BASE_URL,
      token: "t",
      fetch,
    });
    assert.deepStrictEqual(result, { apiVersion: "0.0.1", role: "user" });
    assert.deepStrictEqual(seen, {
      url: `${BASE_URL}/connection`,
      authorization: "Bearer t",
    });
  });

  test("base の path を保って /connection を叩くこと", async () => {
    const cases: [string, string][] = [
      ["https://host/api", "https://host/api/connection"],
      ["https://host/api/", "https://host/api/connection"],
      ["http://127.0.0.1:3000", "http://127.0.0.1:3000/connection"],
    ];
    for (const [baseUrl, expected] of cases) {
      let seen: string | undefined;
      const fetch: typeof globalThis.fetch = async (input) => {
        seen = String(input);
        return Response.json({ apiVersion: "0.0.1", role: "user" });
      };
      await checkConnection({ baseUrl, token: "t", fetch });
      assert.deepStrictEqual(seen, expected);
    }
  });

  test("200 で body が JSON でない、または形が違うと ApiError を投げること", async () => {
    const bodies = [new Response("<html></html>"), Response.json({})];
    for (const res of bodies) {
      const fetch: typeof globalThis.fetch = async () => res;
      await assert.rejects(
        checkConnection({ baseUrl: BASE_URL, token: "t", fetch }),
        (e) =>
          e instanceof ApiError &&
          e.status === 200 &&
          e.problem === undefined &&
          e.message.includes("body が定義と違う"),
      );
    }
  });

  test("200 で role が定義に無い値だと ApiError を投げること", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      Response.json({ apiVersion: "0.0.1", role: "admin" });
    await assert.rejects(
      checkConnection({ baseUrl: BASE_URL, token: "t", fetch }),
      (e) =>
        e instanceof ApiError &&
        e.status === 200 &&
        e.message.includes("body が定義と違う"),
    );
  });

  test("401 のとき status と problem を持つ ApiError を投げること", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
        }),
        {
          status: 401,
          headers: { "content-type": "application/problem+json" },
        },
      );
    await assert.rejects(
      checkConnection({ baseUrl: BASE_URL, token: "t", fetch }),
      (e) =>
        e instanceof ApiError &&
        e.status === 401 &&
        e.problem?.title === "Unauthorized",
    );
  });
});
