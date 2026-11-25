import { Hono } from "hono";
import type { GetConnectionResponses } from "./generated/types/index.ts";
import type { TokenRegistry } from "../auth/tokens.ts";
import { assertValidSecurity, authorize } from "./auth.ts";
import { contract } from "./contract.ts";
import { loadDefinition } from "./definition.ts";
import type { Definition } from "./definition.ts";
import { handleError, problem, requirePrincipal, send } from "./reply.ts";
import type { AppEnv } from "./reply.ts";

/** server が実装する API の定義。 */
export const definition = loadDefinition(
  new URL("./openapi.gen.json", import.meta.url),
);

/**
 * `source` は route の定義。既定は server が実装する API の定義。
 * 定義の `security` が不正なら、起動時に例外を投げる。
 */
export function createApp(
  registry: TokenRegistry,
  source: Definition = definition,
): Hono<AppEnv> {
  assertValidSecurity(source);

  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.notFound((c) => problem(c, 404, "Not Found"));

  app.use("*", contract(source, { authorize: authorize(registry) }));

  app.get("/connection", (c) =>
    send<GetConnectionResponses>(c, {
      status: "200",
      body: { apiVersion: source.version, role: requirePrincipal(c).role },
    }),
  );

  return app;
}
