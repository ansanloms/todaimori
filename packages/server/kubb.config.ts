import { defineConfig } from "kubb/config";
import { adapterOas } from "@kubb/adapter-oas";
import { parserTs } from "@kubb/parser-ts";
import { pluginTs } from "@kubb/plugin-ts";

// 定義の検証は docs/api の lint が担うので、Kubb 側の検証は切る (3.2 に未対応)。
export default defineConfig({
  input: "./api/openapi.gen.json",
  output: { path: "./api/generated", clean: true },
  adapter: adapterOas({ validate: false }),
  parsers: [parserTs({ extension: { ".ts": ".ts" } })],
  plugins: [pluginTs()],
});
