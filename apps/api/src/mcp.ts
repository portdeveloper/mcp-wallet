import { and, eq } from "drizzle-orm";
import { transferRequests, type Database } from "@mcp-wallet/db";
import { MCP_SCOPES, MONAD_TESTNET } from "@mcp-wallet/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Environment } from "./env.js";
import { getBearerToken } from "./http.js";
import { getWalletForUser } from "./identity.js";
import { authenticateMcpToken } from "./oauth.js";
import { formatWeiAsMon, parseMonAmount } from "./transfer.js";

function unauthorized(appUrl: string, reply: FastifyReply) {
  return reply
    .header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${appUrl}/.well-known/oauth-protected-resource", scope="${MCP_SCOPES.join(" ")}"`,
    )
    .code(401)
    .send({ error: "unauthorized" });
}

function createWalletServer(
  dependencies: { db: Database; environment: Environment },
  access: { clientId: string; scope: string; userId: string },
  wallet: { id: string; address: string; chain: string },
) {
  const server = new McpServer({
    name: "mcp-wallet",
    version: "0.1.0",
  });

  server.registerTool(
    "wallet_get_address",
    {
      description:
        "Return the authenticated developer's embedded wallet address on Monad testnet. This tool is read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const result = {
        address: wallet.address,
        chain: wallet.chain,
        chain_id: MONAD_TESTNET.id,
        network: MONAD_TESTNET.name,
      };
      return {
        content: [
          {
            type: "text" as const,
            text: `Your MCP wallet address is ${wallet.address} on ${MONAD_TESTNET.name} (chain ID ${MONAD_TESTNET.id}).`,
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "wallet_prepare_transfer",
    {
      description:
        "Prepare an exact native MON transfer on Monad testnet. This does not sign or send funds. It returns a short-lived browser approval URL that the wallet owner must review and approve.",
      inputSchema: {
        recipient_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        amount: z.string().min(1).max(80),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async ({ recipient_address, amount }) => {
      if (!access.scope.split(" ").includes("wallet:transfer")) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "This MCP connection does not have wallet:transfer permission. Reconnect it and approve the transfer scope.",
            },
          ],
        };
      }
      if (recipient_address.toLowerCase() === wallet.address.toLowerCase()) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "The recipient cannot be this wallet." }],
        };
      }

      let parsedAmount: ReturnType<typeof parseMonAmount>;
      try {
        parsedAmount = parseMonAmount(amount);
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "The transfer amount is invalid.",
            },
          ],
        };
      }

      const [transfer] = await dependencies.db
        .insert(transferRequests)
        .values({
          userId: access.userId,
          walletId: wallet.id,
          clientId: access.clientId,
          recipientAddress: recipient_address.toLowerCase(),
          amountWei: parsedAmount.amountWei,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        })
        .returning({ id: transferRequests.id, expiresAt: transferRequests.expiresAt });
      if (!transfer) throw new Error("Unable to create transfer request");

      const approvalUrl = `${dependencies.environment.WEB_URL}/transfer/${transfer.id}`;
      const result = {
        transfer_request_id: transfer.id,
        status: "pending_approval",
        from_address: wallet.address,
        recipient_address: recipient_address.toLowerCase(),
        amount: parsedAmount.amount,
        symbol: MONAD_TESTNET.nativeCurrency.symbol,
        network: MONAD_TESTNET.name,
        chain_id: MONAD_TESTNET.id,
        approval_url: approvalUrl,
        expires_at: transfer.expiresAt.toISOString(),
      };
      return {
        content: [
          {
            type: "text" as const,
            text: `Transfer prepared. Ask the wallet owner to review and approve ${parsedAmount.amount} MON to ${recipient_address} at ${approvalUrl}. No funds have moved yet.`,
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "wallet_get_transfer_status",
    {
      description: "Return the current status of a transfer request created by this MCP client.",
      inputSchema: { transfer_request_id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ transfer_request_id }) => {
      if (!access.scope.split(" ").includes("wallet:transfer")) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "This MCP connection does not have wallet:transfer permission.",
            },
          ],
        };
      }
      const [transfer] = await dependencies.db
        .select()
        .from(transferRequests)
        .where(
          and(
            eq(transferRequests.id, transfer_request_id),
            eq(transferRequests.userId, access.userId),
            eq(transferRequests.clientId, access.clientId),
          ),
        )
        .limit(1);
      if (!transfer) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Transfer request not found." }],
        };
      }

      let status = transfer.status;
      if (status === "pending_approval" && transfer.expiresAt <= new Date()) {
        status = "expired";
        await dependencies.db
          .update(transferRequests)
          .set({ status, resolvedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(transferRequests.id, transfer.id),
              eq(transferRequests.status, "pending_approval"),
            ),
          );
      }

      const result = {
        transfer_request_id: transfer.id,
        status,
        recipient_address: transfer.recipientAddress,
        amount: formatWeiAsMon(transfer.amountWei),
        symbol: MONAD_TESTNET.nativeCurrency.symbol,
        transaction_hash: transfer.transactionHash,
        ...(transfer.transactionHash
          ? { explorer_url: `${MONAD_TESTNET.blockExplorerUrl}/tx/${transfer.transactionHash}` }
          : {}),
      };
      return {
        content: [
          {
            type: "text" as const,
            text: transfer.transactionHash
              ? `Transfer is ${status}: ${transfer.transactionHash}`
              : `Transfer is ${status}.`,
          },
        ],
        structuredContent: result,
      };
    },
  );

  return server;
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  dependencies: { db: Database; environment: Environment },
) {
  app.all("/mcp", async (request, reply) => {
    const bearerToken = getBearerToken(request);
    if (!bearerToken) {
      return unauthorized(dependencies.environment.API_URL, reply);
    }

    const accessToken = await authenticateMcpToken(
      dependencies.db,
      dependencies.environment,
      bearerToken,
    );
    if (!accessToken || !accessToken.scope.split(" ").includes("wallet:read")) {
      return unauthorized(dependencies.environment.API_URL, reply);
    }

    if (request.method !== "POST") {
      return reply.header("Allow", "POST").code(405).send({
        jsonrpc: "2.0",
        error: { code: -32_000, message: "Method not allowed" },
        id: null,
      });
    }

    const wallet = await getWalletForUser(dependencies.db, accessToken.userId);
    if (!wallet) {
      return reply.code(409).send({
        jsonrpc: "2.0",
        error: { code: -32_000, message: "No wallet is linked to this user" },
        id: null,
      });
    }

    const server = createWalletServer(dependencies, accessToken, wallet);
    const transport = new StreamableHTTPServerTransport({
      // The SDK documents explicit undefined as the switch for stateless mode,
      // but its declaration is not exactOptionalPropertyTypes-compatible yet.
      sessionIdGenerator: undefined as never,
      enableJsonResponse: true,
    });

    reply.hijack();
    try {
      // SDK 1.30's transport accessor declarations conflict with its own
      // Transport interface when exactOptionalPropertyTypes is enabled.
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log.error({ err: error }, "MCP request failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32_603, message: "Internal server error" },
            id: null,
          }),
        );
      }
    } finally {
      await transport.close();
      await server.close();
    }
  });
}
