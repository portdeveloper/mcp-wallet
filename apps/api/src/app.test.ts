import { afterEach, describe, expect, it } from "vitest";
import type { Environment } from "./env.js";
import { buildApp } from "./app.js";

const environment: Environment = {
  API_URL: "http://localhost:3001",
  DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
  DYNAMIC_ENVIRONMENT_ID: "00000000-0000-4000-8000-000000000000",
  MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
  PORT: 3001,
  TOKEN_PEPPER: "test-token-pepper-at-least-24-characters",
  WEB_URL: "http://localhost:3000",
};

describe("MCP OAuth discovery", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("challenges unauthenticated MCP requests with protected-resource metadata", async () => {
    const app = await buildApp(environment);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/mcp" });

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe(
      'Bearer resource_metadata="http://localhost:3001/.well-known/oauth-protected-resource", scope="wallet:read wallet:transfer"',
    );
  });

  it("publishes the OAuth endpoints a coding agent needs", async () => {
    const app = await buildApp(environment);
    apps.push(app);

    const [resource, authorizationServer] = await Promise.all([
      app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource" }),
      app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" }),
    ]);

    expect(resource.json()).toMatchObject({
      resource: "http://localhost:3001/mcp",
      authorization_servers: ["http://localhost:3001"],
      scopes_supported: ["wallet:read", "wallet:transfer"],
    });
    expect(authorizationServer.json()).toMatchObject({
      authorization_endpoint: "http://localhost:3001/oauth/authorize",
      token_endpoint: "http://localhost:3001/oauth/token",
      registration_endpoint: "http://localhost:3001/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
  });
});
