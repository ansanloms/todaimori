import { serve } from "@hono/node-server";
import { createApp } from "./api/app.ts";
import { parsePort } from "./port.ts";
import { createTokenRegistry, parseUserTokens } from "./auth/tokens.ts";

const registry = createTokenRegistry(
  parseUserTokens(process.env.TODAIMORI_USER_TOKENS),
);
const port = parsePort(process.env.TODAIMORI_PORT);

const server = serve({
  fetch: createApp(registry).fetch,
  port,
  hostname: "127.0.0.1",
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
