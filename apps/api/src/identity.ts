import { eq } from "drizzle-orm";
import {
  type Database,
  users,
  wallets,
} from "@mcp-wallet/db";
import type { DynamicIdentity } from "./dynamic-auth.js";

export async function upsertIdentity(db: Database, identity: DynamicIdentity) {
  const [user] = await db
    .insert(users)
    .values({
      dynamicUserId: identity.dynamicUserId,
      email: identity.email,
    })
    .onConflictDoUpdate({
      target: users.dynamicUserId,
      set: {
        email: identity.email,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!user) {
    throw new Error("Unable to persist authenticated user");
  }

  const [wallet] = await db
    .insert(wallets)
    .values({
      userId: user.id,
      address: identity.wallet.address,
      dynamicWalletId: identity.wallet.dynamicWalletId,
    })
    .onConflictDoUpdate({
      target: wallets.userId,
      set: {
        address: identity.wallet.address,
        dynamicWalletId: identity.wallet.dynamicWalletId,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!wallet) {
    throw new Error("Unable to persist authenticated wallet");
  }

  return { user, wallet };
}

export async function getWalletForUser(db: Database, userId: string) {
  const [result] = await db
    .select({ id: wallets.id, address: wallets.address, chain: wallets.chain })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return result;
}
