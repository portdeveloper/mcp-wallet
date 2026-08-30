import { and, eq, gt } from "drizzle-orm";
import {
  oauthClients,
  transferRequests,
  users,
  wallets,
  type Database,
} from "@mcp-wallet/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DynamicIdentity } from "./dynamic-auth.js";
import type { Environment } from "./env.js";
import { getBearerToken } from "./http.js";
import { formatWeiAsMon, verifyMonadTransfer } from "./transfer.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const transactionHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

async function getTransfer(db: Database, id: string) {
  const [result] = await db
    .select({
      transfer: transferRequests,
      dynamicUserId: users.dynamicUserId,
      walletAddress: wallets.address,
      clientName: oauthClients.name,
    })
    .from(transferRequests)
    .innerJoin(users, eq(transferRequests.userId, users.id))
    .innerJoin(wallets, eq(transferRequests.walletId, wallets.id))
    .innerJoin(oauthClients, eq(transferRequests.clientId, oauthClients.id))
    .where(eq(transferRequests.id, id))
    .limit(1);
  return result;
}

async function authenticateOwner(
  verifyDynamicToken: (token: string, submittedWalletAddress?: string) => Promise<DynamicIdentity>,
  token: string | undefined,
  expectedDynamicUserId: string,
  walletAddress?: string,
) {
  if (!token) return false;
  try {
    const identity = await verifyDynamicToken(token, walletAddress);
    return identity.dynamicUserId === expectedDynamicUserId;
  } catch {
    return false;
  }
}

export async function registerTransferRoutes(
  app: FastifyInstance,
  dependencies: {
    db: Database;
    environment: Environment;
    verifyDynamicToken: (
      token: string,
      submittedWalletAddress?: string,
    ) => Promise<DynamicIdentity>;
  },
) {
  const { db, environment, verifyDynamicToken } = dependencies;

  app.get("/api/transfers/:id", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const result = await getTransfer(db, params.data.id);
    if (!result) return reply.code(404).send({ error: "transfer_not_found" });
    if (
      !(await authenticateOwner(
        verifyDynamicToken,
        getBearerToken(request),
        result.dynamicUserId,
      ))
    ) {
      return reply.code(401).send({ error: "invalid_dynamic_session" });
    }

    let status = result.transfer.status;
    if (status === "pending_approval" && result.transfer.expiresAt <= new Date()) {
      status = "expired";
      await db
        .update(transferRequests)
        .set({ status, resolvedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(transferRequests.id, result.transfer.id),
            eq(transferRequests.status, "pending_approval"),
          ),
        );
    }

    return {
      id: result.transfer.id,
      from_address: result.walletAddress,
      recipient_address: result.transfer.recipientAddress,
      amount: formatWeiAsMon(result.transfer.amountWei),
      symbol: "MON",
      network: "Monad Testnet",
      chain_id: 10_143,
      client_name: result.clientName,
      status,
      transaction_hash: result.transfer.transactionHash,
      expires_at: result.transfer.expiresAt.toISOString(),
    };
  });

  app.post("/api/transfers/:id/reject", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const result = await getTransfer(db, params.data.id);
    if (!result) return reply.code(404).send({ error: "transfer_not_found" });
    if (
      !(await authenticateOwner(
        verifyDynamicToken,
        getBearerToken(request),
        result.dynamicUserId,
      ))
    ) {
      return reply.code(401).send({ error: "invalid_dynamic_session" });
    }

    const [rejected] = await db
      .update(transferRequests)
      .set({ status: "rejected", resolvedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(transferRequests.id, result.transfer.id),
          eq(transferRequests.status, "pending_approval"),
          gt(transferRequests.expiresAt, new Date()),
        ),
      )
      .returning({ id: transferRequests.id });
    if (!rejected) return reply.code(409).send({ error: "transfer_not_pending" });
    return { status: "rejected" };
  });

  app.post("/api/transfers/:id/complete", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = z
      .object({
        wallet_address: walletAddressSchema,
        transaction_hash: transactionHashSchema,
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const result = await getTransfer(db, params.data.id);
    if (!result) return reply.code(404).send({ error: "transfer_not_found" });
    if (
      !(await authenticateOwner(
        verifyDynamicToken,
        getBearerToken(request),
        result.dynamicUserId,
        body.data.wallet_address,
      )) || result.walletAddress.toLowerCase() !== body.data.wallet_address.toLowerCase()
    ) {
      return reply.code(401).send({ error: "invalid_dynamic_session" });
    }
    if (
      result.transfer.status !== "pending_approval" ||
      result.transfer.expiresAt <= new Date()
    ) {
      return reply.code(409).send({ error: "transfer_not_pending" });
    }

    let verification: Awaited<ReturnType<typeof verifyMonadTransfer>>;
    try {
      verification = await verifyMonadTransfer(environment.MONAD_RPC_URL, {
        transactionHash: body.data.transaction_hash,
        senderAddress: result.walletAddress,
        recipientAddress: result.transfer.recipientAddress,
        amountWei: result.transfer.amountWei,
      });
    } catch (error) {
      request.log.warn({ err: error }, "Monad transfer verification failed");
      return reply.code(502).send({ error: "rpc_verification_failed" });
    }
    if (verification === "pending") {
      return reply.code(409).send({ error: "transaction_not_confirmed" });
    }
    if (verification === "mismatch") {
      return reply.code(400).send({ error: "transaction_does_not_match_request" });
    }

    const [completed] = await db
      .update(transferRequests)
      .set({
        status: "confirmed",
        transactionHash: body.data.transaction_hash.toLowerCase(),
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(transferRequests.id, result.transfer.id),
          eq(transferRequests.status, "pending_approval"),
          gt(transferRequests.expiresAt, new Date()),
        ),
      )
      .returning({ id: transferRequests.id });
    if (!completed) return reply.code(409).send({ error: "transfer_not_pending" });
    return { status: "confirmed", transaction_hash: body.data.transaction_hash };
  });
}
