import type { Database } from "@mcp-wallet/db";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { Environment } from "./env.js";
import { registerTransferRoutes } from "./transfers.js";

const transferId = "00000000-0000-4000-8000-000000000001";
const walletAddress = "0x1111111111111111111111111111111111111111";

const environment: Environment = {
  API_URL: "http://localhost:3001",
  DATABASE_URL: "postgresql://unused",
  DYNAMIC_ENVIRONMENT_ID: "00000000-0000-4000-8000-000000000000",
  MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
  PORT: 3001,
  TOKEN_PEPPER: "test-token-pepper-at-least-24-characters",
  WEB_URL: "http://localhost:3000",
};

function createClaimDatabase() {
  const state = { status: "pending_approval" };
  const result = () => ({
    transfer: {
      id: transferId,
      status: state.status,
      expiresAt: new Date(Date.now() + 60_000),
    },
    dynamicUserId: "dynamic-user-1",
    walletAddress,
    clientName: "Test client",
  });

  const database = {
    select() {
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        limit: async () => [result()],
      };
      return query;
    },
    update() {
      let values: { status?: string } = {};
      const query = {
        set(nextValues: { status?: string }) {
          values = nextValues;
          return query;
        },
        where: () => query,
        async returning() {
          if (state.status !== "pending_approval") return [];
          state.status = values.status ?? state.status;
          return [{ id: transferId }];
        },
      };
      return query;
    },
  };

  return { database: database as unknown as Database, state };
}

describe("transfer approval claims", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("allows only one of two concurrent claims to reserve a transfer", async () => {
    const app = Fastify();
    apps.push(app);
    const { database, state } = createClaimDatabase();
    await registerTransferRoutes(app, {
      db: database,
      environment,
      verifyDynamicToken: async () => ({
        dynamicUserId: "dynamic-user-1",
        email: "owner@example.com",
        wallet: { address: walletAddress },
      }),
    });

    const request = () =>
      app.inject({
        method: "POST",
        url: `/api/transfers/${transferId}/claim`,
        headers: { authorization: "Bearer dynamic-token" },
        payload: { wallet_address: walletAddress },
      });
    const responses = await Promise.all([request(), request()]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.statusCode === 200)?.json()).toEqual({
      status: "approval_in_progress",
    });
    expect(state.status).toBe("approval_in_progress");
  });
});
