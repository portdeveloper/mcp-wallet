import type { Database } from "@mcp-wallet/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DynamicIdentity } from "./dynamic-auth.js";
import { getBearerToken } from "./http.js";
import { upsertIdentity } from "./identity.js";

export async function registerSessionRoutes(
  app: FastifyInstance,
  dependencies: {
    db: Database;
    verifyDynamicToken: (
      token: string,
      submittedWalletAddress?: string,
    ) => Promise<DynamicIdentity>;
  },
) {
  app.post("/api/session", async (request, reply) => {
    const token = getBearerToken(request);
    const body = z
      .object({ wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) })
      .safeParse(request.body);
    if (!token || !body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const identity = await dependencies.verifyDynamicToken(
        token,
        body.data.wallet_address,
      );
      const { user, wallet } = await upsertIdentity(dependencies.db, identity);
      return {
        user: { email: user.email },
        wallet: { address: wallet.address, chain: wallet.chain },
      };
    } catch (error) {
      request.log.warn({ err: error }, "Dynamic session sync failed");
      return reply.code(401).send({ error: "invalid_dynamic_session" });
    }
  });
}
