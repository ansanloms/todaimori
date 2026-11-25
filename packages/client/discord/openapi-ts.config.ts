import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../../../docs/api/dist/api.json",
  output: {
    path: "./api/generated",
    module: { extension: ".ts" },
    postProcess: [],
  },
  plugins: ["@hey-api/typescript"],
});
