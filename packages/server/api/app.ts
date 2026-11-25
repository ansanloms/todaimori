import { Hono } from "hono";
import type { GetConnectionResponses } from "./generated/index.ts";
import type { TokenRegistry } from "../auth/tokens.ts";
import { apiVersion, handleError, problem, secured } from "./openapi.ts";
import type { AuthEnv } from "./openapi.ts";

export function createApp(registry: TokenRegistry): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.onError(handleError);

  app.get("/connection", secured(registry, "getConnection"), (c) => {
    const body: GetConnectionResponses[200] = {
      apiVersion,
      role: c.get("principal").role,
    };
    return c.json(body, 200);
  });

  app.notFound((c) => problem(c, 404, "Not Found"));

  return app;
}
