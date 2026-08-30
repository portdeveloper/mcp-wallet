import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { createDatabase } from "@mcp-wallet/db";
import Fastify from "fastify";
import { createDynamicTokenVerifier } from "./dynamic-auth.js";
import type { Environment } from "./env.js";
import { registerMcpRoutes } from "./mcp.js";
import { registerOAuthRoutes } from "./oauth.js";
import { registerSessionRoutes } from "./session.js";
import { registerTransferRoutes } from "./transfers.js";

export async function buildApp(environment: Environment) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "body.code",
        "body.code_verifier",
        "body.refresh_token",
        "body.token",
      ],
    },
  });
  const database = createDatabase(environment.DATABASE_URL);
  const verifyDynamicToken = createDynamicTokenVerifier(environment);

  await app.register(cors, {
    origin: environment.WEB_URL,
    credentials: true,
    allowedHeaders: ["authorization", "content-type", "mcp-protocol-version"],
    exposedHeaders: ["mcp-session-id", "www-authenticate"],
  });
  await app.register(formbody);

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await database.client`select 1`;
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  await registerOAuthRoutes(app, {
    db: database.db,
    environment,
    verifyDynamicToken,
  });
  await registerSessionRoutes(app, { db: database.db, verifyDynamicToken });
  await registerTransferRoutes(app, {
    db: database.db,
    environment,
    verifyDynamicToken,
  });
  await registerMcpRoutes(app, { db: database.db, environment });

  app.addHook("onClose", async () => {
    await database.close();
  });

  return app;
}
