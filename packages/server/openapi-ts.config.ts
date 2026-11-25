import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./api/openapi.gen.json",
  output: {
    path: "./api/generated",
    module: { extension: ".ts" },
    postProcess: [],
  },
  plugins: ["@hey-api/typescript"],
});
