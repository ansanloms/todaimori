import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parsePort } from "./port.ts";

describe("parsePort", () => {
  test("未設定なら 3000 を返すこと", () => {
    assert.deepStrictEqual(parsePort(undefined), 3000);
  });

  test("正常な値を数値で返すこと", () => {
    assert.deepStrictEqual(parsePort("1"), 1);
    assert.deepStrictEqual(parsePort("8080"), 8080);
    assert.deepStrictEqual(parsePort("65535"), 65535);
  });

  test("不正な値は例外を投げること", () => {
    for (const value of [
      "",
      "0",
      "65536",
      "0x10",
      "1e3",
      "abc",
      "-1",
      "3000.5",
      " 80",
    ]) {
      assert.throws(() => parsePort(value), /TODAIMORI_PORT/, value);
    }
  });
});
