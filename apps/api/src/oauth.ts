import { and, eq, gt, isNull } from "drizzle-orm";
import {
  type Database,
  oauthAccessTokens,
  oauthAuthorizationCodes,
  oauthAuthorizationRequests,
  oauthClients,
  oauthRefreshTokens,
} from "@mcp-wallet/db";
import { MCP_SCOPES } from "@mcp-wallet/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashToken, randomToken, verifyPkce } from "./crypto.js";
import type { DynamicIdentity } from "./dynamic-auth.js";
import type { Environment } from "./env.js";
import { getBearerToken, isAllowedRedirectUri } from "./http.js";
import { upsertIdentity } from "./identity.js";

const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(200).default("MCP client"),
  redirect_uris: z.array(z.string()).min(1).max(20),
  token_endpoint_auth_method: z.literal("none").default("none"),
});

const authorizeSchema = z.object({
  client_id: z.string().min(1),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  redirect_uri: z.string().min(1),
  response_type: z.literal("code"),
  scope: z.string().default(MCP_SCOPES.join(" ")),
  state: z.string().optional(),
});

const completeSchema = z.object({
  request_id: z.string().uuid(),
  wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const tokenSchema = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    client_id: z.string().min(1),
    code: z.string().min(1),
    code_verifier: z.string().min(43).max(128),
    redirect_uri: z.string().min(1),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    client_id: z.string().min(1),
    refresh_token: z.string().min(1),
    scope: z.string().optional(),
  }),
]);

function validateScope(scope: string): string {
  const requested = [...new Set(scope.split(" ").filter(Boolean))];
  if (requested.length === 0 || requested.some((item) => !MCP_SCOPES.includes(item as never))) {
    throw new Error("Unsupported OAuth scope");
  }
  return requested.join(" ");
}

function tokenResponse(accessToken: string, refreshToken: string, scope: string) {
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 900,
    refresh_token: refreshToken,
    scope,
  };
}

async function issueTokens(
  db: Database,
  environment: Environment,
  input: { clientId: string; userId: string; scope: string },
) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  await db.transaction(async (tx) => {
    await tx.insert(oauthAccessTokens).values({
      tokenHash: hashToken(accessToken, environment.TOKEN_PEPPER),
      clientId: input.clientId,
      userId: input.userId,
      scope: input.scope,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    await tx.insert(oauthRefreshTokens).values({
      tokenHash: hashToken(refreshToken, environment.TOKEN_PEPPER),
      clientId: input.clientId,
      userId: input.userId,
      scope: input.scope,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  });
  return tokenResponse(accessToken, refreshToken, input.scope);
}

export interface OAuthDependencies {
  db: Database;
  environment: Environment;
  verifyDynamicToken: (
    token: string,
    submittedWalletAddress?: string,
  ) => Promise<DynamicIdentity>;
}

export async function registerOAuthRoutes(
  app: FastifyInstance,
  dependencies: OAuthDependencies,
) {
  const { db, environment, verifyDynamicToken } = dependencies;
  const protectedResourceMetadata = {
    resource: `${environment.API_URL}/mcp`,
    authorization_servers: [environment.API_URL],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
  };

  app.get("/.well-known/oauth-protected-resource", async () => protectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", async () =>
    protectedResourceMetadata,
  );

  app.get("/.well-known/oauth-authorization-server", async () => ({
    issuer: environment.API_URL,
    authorization_endpoint: `${environment.API_URL}/oauth/authorize`,
    token_endpoint: `${environment.API_URL}/oauth/token`,
    registration_endpoint: `${environment.API_URL}/oauth/register`,
    revocation_endpoint: `${environment.API_URL}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES],
  }));

  app.post("/oauth/register", async (request, reply) => {
    const parsed = registrationSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.redirect_uris.some((uri) => !isAllowedRedirectUri(uri))) {
      return reply.code(400).send({ error: "invalid_client_metadata" });
    }

    const clientId = randomToken(24);
    await db.insert(oauthClients).values({
      id: clientId,
      name: parsed.data.client_name,
      redirectUris: parsed.data.redirect_uris,
      tokenEndpointAuthMethod: parsed.data.token_endpoint_auth_method,
    });

    return reply.code(201).send({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: parsed.data.client_name,
      redirect_uris: parsed.data.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  app.get("/oauth/authorize", async (request, reply) => {
    const parsed = authorizeSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const [client] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, parsed.data.client_id))
      .limit(1);
    if (!client || !client.redirectUris.includes(parsed.data.redirect_uri)) {
      return reply.code(400).send({ error: "invalid_client" });
    }

    let scope: string;
    try {
      scope = validateScope(parsed.data.scope);
    } catch {
      return reply.code(400).send({ error: "invalid_scope" });
    }

    const [authorizationRequest] = await db
      .insert(oauthAuthorizationRequests)
      .values({
        clientId: client.id,
        redirectUri: parsed.data.redirect_uri,
        state: parsed.data.state,
        scope,
        codeChallenge: parsed.data.code_challenge,
        codeChallengeMethod: parsed.data.code_challenge_method,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      .returning();
    if (!authorizationRequest) {
      return reply.code(500).send({ error: "server_error" });
    }

    return reply.redirect(
      `${environment.WEB_URL}/authorize?request_id=${encodeURIComponent(authorizationRequest.id)}`,
    );
  });

  app.get("/oauth/authorize/requests/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const [authorizationRequest] = await db
      .select({
        clientName: oauthClients.name,
        scope: oauthAuthorizationRequests.scope,
        expiresAt: oauthAuthorizationRequests.expiresAt,
        consumedAt: oauthAuthorizationRequests.consumedAt,
      })
      .from(oauthAuthorizationRequests)
      .innerJoin(oauthClients, eq(oauthAuthorizationRequests.clientId, oauthClients.id))
      .where(eq(oauthAuthorizationRequests.id, params.data.id))
      .limit(1);
    if (
      !authorizationRequest ||
      authorizationRequest.consumedAt ||
      authorizationRequest.expiresAt <= new Date()
    ) {
      return reply.code(404).send({ error: "authorization_request_not_found" });
    }

    return {
      client_name: authorizationRequest.clientName,
      scopes: authorizationRequest.scope.split(" ").filter(Boolean),
      expires_at: authorizationRequest.expiresAt.toISOString(),
    };
  });

  app.post("/oauth/authorize/complete", async (request, reply) => {
    const bearerToken = getBearerToken(request);
    const parsed = completeSchema.safeParse(request.body);
    if (!bearerToken || !parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    let identity: DynamicIdentity;
    try {
      identity = await verifyDynamicToken(bearerToken, parsed.data.wallet_address);
    } catch (error) {
      request.log.warn({ err: error }, "Dynamic token validation failed");
      return reply.code(401).send({ error: "invalid_dynamic_session" });
    }

    const now = new Date();
    const [authorizationRequest] = await db
      .select()
      .from(oauthAuthorizationRequests)
      .where(
        and(
          eq(oauthAuthorizationRequests.id, parsed.data.request_id),
          isNull(oauthAuthorizationRequests.consumedAt),
          gt(oauthAuthorizationRequests.expiresAt, now),
        ),
      )
      .limit(1);
    if (!authorizationRequest) {
      return reply.code(400).send({ error: "invalid_or_expired_authorization_request" });
    }

    const { user } = await upsertIdentity(db, identity);
    const code = randomToken();
    const consumed = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(oauthAuthorizationRequests)
        .set({ consumedAt: now })
        .where(
          and(
            eq(oauthAuthorizationRequests.id, authorizationRequest.id),
            isNull(oauthAuthorizationRequests.consumedAt),
          ),
        )
        .returning();
      if (!updated) return false;
      await tx.insert(oauthAuthorizationCodes).values({
        codeHash: hashToken(code, environment.TOKEN_PEPPER),
        clientId: authorizationRequest.clientId,
        userId: user.id,
        redirectUri: authorizationRequest.redirectUri,
        scope: authorizationRequest.scope,
        codeChallenge: authorizationRequest.codeChallenge,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });
      return true;
    });
    if (!consumed) {
      return reply.code(409).send({ error: "authorization_request_already_used" });
    }

    const callback = new URL(authorizationRequest.redirectUri);
    callback.searchParams.set("code", code);
    if (authorizationRequest.state) {
      callback.searchParams.set("state", authorizationRequest.state);
    }
    return { redirect_uri: callback.toString() };
  });

  app.post("/oauth/token", async (request, reply) => {
    const parsed = tokenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    if (parsed.data.grant_type === "authorization_code") {
      const now = new Date();
      const codeHash = hashToken(parsed.data.code, environment.TOKEN_PEPPER);
      const [authorizationCode] = await db
        .select()
        .from(oauthAuthorizationCodes)
        .where(
          and(
            eq(oauthAuthorizationCodes.codeHash, codeHash),
            eq(oauthAuthorizationCodes.clientId, parsed.data.client_id),
            isNull(oauthAuthorizationCodes.consumedAt),
            gt(oauthAuthorizationCodes.expiresAt, now),
          ),
        )
        .limit(1);
      if (
        !authorizationCode ||
        authorizationCode.redirectUri !== parsed.data.redirect_uri ||
        !verifyPkce(parsed.data.code_verifier, authorizationCode.codeChallenge)
      ) {
        return reply.code(400).send({ error: "invalid_grant" });
      }

      const [consumed] = await db
        .update(oauthAuthorizationCodes)
        .set({ consumedAt: now })
        .where(
          and(
            eq(oauthAuthorizationCodes.id, authorizationCode.id),
            isNull(oauthAuthorizationCodes.consumedAt),
          ),
        )
        .returning();
      if (!consumed) {
        return reply.code(400).send({ error: "invalid_grant" });
      }

      return issueTokens(db, environment, {
        clientId: authorizationCode.clientId,
        userId: authorizationCode.userId,
        scope: authorizationCode.scope,
      });
    }

    const now = new Date();
    const refreshHash = hashToken(parsed.data.refresh_token, environment.TOKEN_PEPPER);
    const [storedRefreshToken] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.tokenHash, refreshHash),
          eq(oauthRefreshTokens.clientId, parsed.data.client_id),
          isNull(oauthRefreshTokens.consumedAt),
          isNull(oauthRefreshTokens.revokedAt),
          gt(oauthRefreshTokens.expiresAt, now),
        ),
      )
      .limit(1);
    if (!storedRefreshToken) {
      return reply.code(400).send({ error: "invalid_grant" });
    }
    if (parsed.data.scope && parsed.data.scope !== storedRefreshToken.scope) {
      return reply.code(400).send({ error: "invalid_scope" });
    }

    const [consumed] = await db
      .update(oauthRefreshTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(oauthRefreshTokens.id, storedRefreshToken.id),
          isNull(oauthRefreshTokens.consumedAt),
        ),
      )
      .returning();
    if (!consumed) {
      return reply.code(400).send({ error: "invalid_grant" });
    }
    return issueTokens(db, environment, {
      clientId: storedRefreshToken.clientId,
      userId: storedRefreshToken.userId,
      scope: storedRefreshToken.scope,
    });
  });

  app.post("/oauth/revoke", async (request, reply) => {
    const token = z.object({ token: z.string().min(1) }).safeParse(request.body);
    if (!token.success) return reply.code(200).send();
    const tokenHash = hashToken(token.data.token, environment.TOKEN_PEPPER);
    await Promise.all([
      db
        .update(oauthAccessTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthAccessTokens.tokenHash, tokenHash)),
      db
        .update(oauthRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthRefreshTokens.tokenHash, tokenHash)),
    ]);
    return reply.code(200).send();
  });
}

export async function authenticateMcpToken(
  db: Database,
  environment: Environment,
  token: string,
) {
  const [stored] = await db
    .select()
    .from(oauthAccessTokens)
    .where(
      and(
        eq(oauthAccessTokens.tokenHash, hashToken(token, environment.TOKEN_PEPPER)),
        isNull(oauthAccessTokens.revokedAt),
        gt(oauthAccessTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return stored;
}
